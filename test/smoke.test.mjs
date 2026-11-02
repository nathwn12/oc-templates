import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { respond } from "../dist/mcp.js";

describe("mcp smoke", () => {
  it("answers initialize with the current default protocol", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    assert.equal(reply?.jsonrpc, "2.0");
    assert.equal(reply?.id, 1);
    assert.ok("result" in (reply ?? {}));
    const result = reply.result;
    assert.equal(result.protocolVersion, "2025-11-25");
    assert.equal(result.serverInfo.name, "oc-template");
  });

  it("lists the echo tool", () => {
    const reply = respond({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.equal(reply?.id, 2);
    const result = reply.result;
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "echo");
  });

  it("echo round-trip via tools/call", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });
    assert.deepEqual(reply, {
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: "hello" }], isError: false },
    });
  });

  it("echoes a client-requested 2026-07-28 instead of downgrading it", () => {
    const reply = respond({
      jsonrpc: "2.0",
      id: 4,
      method: "initialize",
      params: { protocolVersion: "2026-07-28" },
    });
    assert.equal(reply?.result.protocolVersion, "2026-07-28");
  });
});
