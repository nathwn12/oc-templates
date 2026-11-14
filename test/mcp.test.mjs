import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  LEGACY_PROTOCOL_VERSION,
  MODERN_PROTOCOL_VERSION,
  SERVER_INFO_KEY,
  SERVER_NAME,
  SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOLS,
  respond,
  serve,
} from "../dist/mcp.js";

const SERVER_ENTRY = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));

const MODERN = {
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "0.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  },
};

/** A modern-era request: every request carries the protocol version in `_meta`. */
function modern(id, method, params = {}) {
  return { jsonrpc: "2.0", id, method, params: { ...MODERN, ...params } };
}

describe("protocol negotiation", () => {
  it("echoes a handshake version it implements", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    assert.equal(reply.result.protocolVersion, "2025-11-25");
    assert.equal(reply.result.serverInfo.name, SERVER_NAME);
    assert.equal(reply.result.serverInfo.version, SERVER_VERSION);
  });

  it("answers an unimplemented handshake version with the one it supports", () => {
    for (const requested of ["2026-07-28", "2025-06-18", "1900-01-01"]) {
      const reply = respond({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: requested },
      });
      assert.equal(
        reply.result.protocolVersion,
        LEGACY_PROTOCOL_VERSION,
        `requested ${requested} must not be echoed back`,
      );
    }
  });

  it("answers a handshake with no version request with the supported default", () => {
    const reply = respond({ jsonrpc: "2.0", id: 3, method: "initialize" });
    assert.equal(reply.result.protocolVersion, LEGACY_PROTOCOL_VERSION);
  });

  it("rejects an unsupported per-request version with UnsupportedProtocolVersion", () => {
    const reply = respond(
      modern(4, "tools/list", {
        _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" },
      }),
    );
    assert.equal(reply.error.code, -32022);
    assert.equal(reply.error.message, "Unsupported protocol version");
    assert.deepEqual(reply.error.data, {
      supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      requested: "1900-01-01",
    });
  });

  it("serves a modern request that declares the current version", () => {
    const reply = respond(modern(5, "tools/list"));
    assert.equal(reply.result.resultType, "complete");
    assert.deepEqual(
      reply.result._meta[SERVER_INFO_KEY],
      { name: SERVER_NAME, version: SERVER_VERSION },
    );
  });
});

describe("server/discover", () => {
  it("reports versions, capabilities and identity", () => {
    const reply = respond(modern(6, "server/discover"));
    const result = reply.result;
    assert.equal(result.resultType, "complete");
    assert.deepEqual(result.supportedVersions, [...SUPPORTED_PROTOCOL_VERSIONS]);
    assert.ok(result.supportedVersions.includes(MODERN_PROTOCOL_VERSION));
    assert.ok(result.supportedVersions.includes(LEGACY_PROTOCOL_VERSION));
    assert.equal(typeof result.capabilities.tools, "object");
    assert.deepEqual(result._meta[SERVER_INFO_KEY], {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
  });

  it("is unknown to a legacy client, so a probe falls back cleanly", () => {
    const reply = respond({ jsonrpc: "2.0", id: 7, method: "server/discover", params: {} });
    assert.equal(reply.error.code, -32601);
  });
});

describe("tools", () => {
  it("lists the echo tool", () => {
    const reply = respond({ jsonrpc: "2.0", id: 8, method: "tools/list" });
    assert.deepEqual(reply.result.tools, [...TOOLS]);
    assert.equal(reply.result.resultType, undefined, "legacy results carry no resultType");
  });

  it("echoes text back on the legacy path", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });
    assert.deepEqual(reply.result, {
      content: [{ type: "text", text: "hello" }],
      isError: false,
    });
  });

  it("echoes text back on the modern path", () => {
    const reply = respond(modern(10, "tools/call", { name: "echo", arguments: { text: "hello" } }));
    assert.equal(reply.result.resultType, "complete");
    assert.deepEqual(reply.result.content, [{ type: "text", text: "hello" }]);
    assert.equal(reply.result.isError, false);
  });

  it("rejects an unknown tool", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    });
    assert.equal(reply.error.code, -32602);
    assert.match(reply.error.message, /unknown tool: nope/);
  });

  it("rejects a non-string echo argument", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "echo", arguments: { text: 42 } },
    });
    assert.equal(reply.error.code, -32602);
  });
});

describe("transport framing", () => {
  async function exchange(lines) {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];
    output.on("data", (chunk) => chunks.push(chunk.toString()));
    serve(input, output);
    const arrived = once(output, "data");
    for (const line of lines) input.write(`${line}\n`);
    await arrived;
    input.end();
    await new Promise((resolve) => setImmediate(resolve));
    return chunks.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  it("answers requests and stays silent on notifications", async () => {
    const replies = await exchange([
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "",
      JSON.stringify({ jsonrpc: "2.0", id: "a", method: "ping" }),
    ]);
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0], { jsonrpc: "2.0", id: "a", result: {} });
  });

  it("reports malformed JSON as a parse error", async () => {
    const replies = await exchange(["{not json"]);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].error.code, -32700);
    assert.equal(replies[0].id, null);
  });
});

describe("invalid requests", () => {
  it("refuses a message that is not a JSON-RPC request object", () => {
    for (const message of [null, undefined, "text", 5, true, [], ["a"]]) {
      const reply = respond(message);
      assert.equal(reply?.error.code, -32600, `expected Invalid Request for ${JSON.stringify(message)}`);
      assert.equal(reply?.error.message, "invalid request");
      assert.equal(reply?.id, null);
    }
  });

  it("refuses a request with a wrong envelope, method or id", () => {
    const invalid = [
      { jsonrpc: "1.0", id: 1, method: "ping" },
      { id: 2, method: "ping" },
      { jsonrpc: "2.0", id: 3 },
      { jsonrpc: "2.0", id: 4, method: 7 },
      { jsonrpc: "2.0", id: null, method: "ping" },
      { jsonrpc: "2.0", id: {}, method: "ping" },
    ];
    for (const message of invalid) {
      const reply = respond(message);
      assert.equal(reply?.error.code, -32600, `expected Invalid Request for ${JSON.stringify(message)}`);
      assert.equal(reply?.id, null);
    }
  });

  it("keeps the server alive across invalid frames", async () => {
    const child = spawn(process.execPath, [SERVER_ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    const frames = [
      "null",
      "[]",
      "5",
      JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    ];
    for (const frame of frames) child.stdin.write(`${frame}\n`);
    child.stdin.end();

    const [code] = await once(child, "close");
    const replies = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

    assert.equal(code, 0, `server exited ${code}: ${stderr}`);
    assert.equal(replies.length, frames.length);
    for (const reply of replies.slice(0, -1)) {
      assert.equal(reply.error.code, -32600);
      assert.equal(reply.id, null);
    }
    assert.deepEqual(replies.at(-1), { jsonrpc: "2.0", id: 2, result: {} });
  });
});
