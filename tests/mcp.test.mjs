import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  SKILLS_ROOT,
} from "../dist/mcp.js";

const SERVER_ENTRY = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));

const MODERN = {
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "0.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  },
};

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

  it("refuses an id-less object that is not a valid notification", () => {
    const invalid = [
      {},
      { method: "ping" },
      { jsonrpc: "1.0", method: "ping" },
      { jsonrpc: "2.0" },
      { jsonrpc: "2.0", method: 7 },
    ];
    for (const message of invalid) {
      const reply = respond(message);
      assert.equal(reply?.error.code, -32600, `expected Invalid Request for ${JSON.stringify(message)}`);
      assert.equal(reply?.id, null);
    }
  });

  it("leaves a valid notification unanswered", () => {
    assert.equal(respond({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.equal(
      respond({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }),
      null,
    );
  });

  it("keeps the server alive across invalid frames", async () => {
    const child = spawn(process.execPath, [SERVER_ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    const invalidFrames = [
      "null",
      "[]",
      "5",
      "{}",
      JSON.stringify({ jsonrpc: "1.0", method: "ping" }),
    ];
    const ping = (id) => JSON.stringify({ jsonrpc: "2.0", id, method: "ping" });
    const frames = [
      ...invalidFrames,
      ping(1),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      ping(2),
    ];
    for (const frame of frames) child.stdin.write(`${frame}\n`);
    child.stdin.end();

    const [code] = await once(child, "close");
    const replies = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

    assert.equal(code, 0, `server exited ${code}: ${stderr}`);
    assert.equal(replies.length, frames.length - 1, "the notification must stay unanswered");
    for (const reply of replies.slice(0, invalidFrames.length)) {
      assert.equal(reply.error.code, -32600);
      assert.equal(reply.id, null);
    }
    assert.deepEqual(replies[0], { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
    assert.deepEqual(replies[invalidFrames.length], { jsonrpc: "2.0", id: 1, result: {} });
    assert.deepEqual(replies.at(-1), { jsonrpc: "2.0", id: 2, result: {} });
  });
});

describe("entry point", () => {
  /**
   * npm installs a `bin` as a link on Unix and resolves the package through it,
   * so argv[1] and the module URL name the same file by different paths. A host
   * that forbids file links gets a directory link, which exercises the same
   * resolution one level up.
   */
  function linkEntry(directory) {
    const link = join(directory, "oc-template-mcp");
    try {
      symlinkSync(SERVER_ENTRY, link, process.platform === "win32" ? "file" : undefined);
      return link;
    } catch (error) {
      if (process.platform !== "win32") throw error;
      symlinkSync(dirname(SERVER_ENTRY), join(directory, "dist"), "junction");
      return join(directory, "dist", "mcp.js");
    }
  }

  it("serves when started through a link to the entry", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "oc-template-entry-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));

    let entry;
    try {
      entry = linkEntry(directory);
    } catch (error) {
      t.skip(`host cannot create links: ${error.code}`);
      return;
    }
    assert.notEqual(entry, SERVER_ENTRY);

    const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.stdin.end(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: LEGACY_PROTOCOL_VERSION },
      })}\n`,
    );

    const [code] = await once(child, "close");
    assert.equal(code, 0, `server exited ${code}: ${stderr}`);
    assert.notEqual(stdout.trim(), "", "the entry started through a link answered nothing");

    const reply = JSON.parse(stdout.trim().split("\n")[0]);
    assert.equal(reply.result.protocolVersion, LEGACY_PROTOCOL_VERSION);
    assert.equal(reply.result.serverInfo.name, SERVER_NAME);
  });
});

describe("capabilities", () => {
  it("declares the resources capability and the skills extension", () => {
    const reply = respond({ jsonrpc: "2.0", id: 100, method: "initialize", params: {} });
    assert.equal(typeof reply.result.capabilities.resources, "object");
    assert.deepEqual(reply.result.capabilities.extensions, {
      "io.modelcontextprotocol/skills": {},
    });
  });
});

describe("skills", () => {
  function uriToPath(uri) {
    const withoutScheme = uri.replace(/^skill:\/\//, "");
    const parts = withoutScheme.split("/");
    return join(SKILLS_ROOT, ...parts);
  }

  it("lists at least one skill with valid entries", () => {
    const reply = respond({ jsonrpc: "2.0", id: 101, method: "skills/list", params: {} });
    assert.equal(reply.result.ttlMs, 0);
    assert.equal(reply.result.cacheScope, "private");
    assert.ok(Array.isArray(reply.result.skills));
    assert.ok(reply.result.skills.length >= 1);
    for (const skill of reply.result.skills) {
      assert.equal(typeof skill.uri, "string");
      assert.ok(skill.uri.endsWith("/SKILL.md"));
      assert.equal(typeof skill.frontmatter, "object");
      assert.equal(typeof skill.frontmatter.name, "string");
      assert.equal(typeof skill.frontmatter.description, "string");
      assert.ok(skill.frontmatter.description.length >= 1);
      assert.ok(skill.frontmatter.description.length <= 1024);
      assert.ok(Array.isArray(skill.resources));
      assert.ok(skill.resources.length >= 1);
      const uris = skill.resources.map((resource) => resource.uri);
      assert.deepEqual(uris, [...uris].sort());
      assert.ok(uris.includes(skill.uri));
      for (const resource of skill.resources) {
        assert.match(resource.digest, /^sha256:[0-9a-f]{64}$/);
        assert.equal(typeof resource.size, "number");
        assert.ok(resource.size >= 0);
      }
    }
  });

  it("matches a listed skill digest and size to its bytes", () => {
    const reply = respond({ jsonrpc: "2.0", id: 102, method: "skills/list", params: {} });
    const skill = reply.result.skills[0];
    const entry = skill.resources.find((resource) => resource.uri === skill.uri);
    const bytes = readFileSync(uriToPath(skill.uri));
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.equal(entry.digest, digest);
    assert.equal(entry.size, bytes.length);
  });

  it("reads a listed skill back through resources/read", () => {
    const reply = respond({ jsonrpc: "2.0", id: 103, method: "skills/list", params: {} });
    const skill = reply.result.skills[0];
    const bytes = readFileSync(uriToPath(skill.uri));
    const readReply = respond({
      jsonrpc: "2.0",
      id: 104,
      method: "resources/read",
      params: { uri: skill.uri },
    });
    assert.equal(readReply.result.contents[0].uri, skill.uri);
    assert.equal(readReply.result.contents[0].mimeType, "text/markdown");
    assert.equal(readReply.result.contents[0].text, bytes.toString("utf8"));
  });

  it("reads every listed resource", () => {
    const reply = respond({ jsonrpc: "2.0", id: 105, method: "skills/list", params: {} });
    const skill = reply.result.skills[0];
    for (const resource of skill.resources) {
      const readReply = respond({
        jsonrpc: "2.0",
        id: 106,
        method: "resources/read",
        params: { uri: resource.uri },
      });
      assert.equal(readReply.result.contents[0].uri, resource.uri);
      assert.ok(readReply.result.contents.length === 1);
    }
  });

  it("returns -32602 for an unknown skill uri", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 107,
      method: "skills/get",
      params: { uri: "skill://does-not-exist/SKILL.md" },
    });
    assert.equal(reply.error.code, -32602);
  });

  it("serves skills on the modern path", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 108,
      method: "skills/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "0.0.0" },
        },
      },
    });
    assert.equal(reply.result.resultType, "complete");
    assert.ok(Array.isArray(reply.result.skills));
  });
});
