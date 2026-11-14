import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NAME, VERSION, COMMAND_NAME, STORAGE_PREFIX } from "../dist/identity.js";
import { SERVER_NAME, SERVER_VERSION } from "../dist/mcp.js";
import { PLUGIN_ID, PLUGIN_VERSION } from "../dist/plugin.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

describe("identity", () => {
  it("keeps the package name in one place", () => {
    assert.equal(NAME, pkg.name);
    assert.equal(SERVER_NAME, NAME);
    assert.equal(PLUGIN_ID, NAME);
  });

  it("keeps the version in one place, matching package.json", () => {
    assert.equal(VERSION, pkg.version);
    assert.equal(SERVER_VERSION, VERSION);
    assert.equal(PLUGIN_VERSION, VERSION);
  });

  it("derives namespaced identifiers from the package name", () => {
    assert.equal(STORAGE_PREFIX, `${NAME}:`);
  });

  it("accepts any command name a copy chooses", () => {
    assert.match(COMMAND_NAME, /^[a-z][a-z0-9-]{1,40}$/, "COMMAND_NAME is a slash-command slug");
    assert.ok(
      pkg.files.includes("src"),
      "source maps in dist/ point at src; the package must ship it",
    );
    assert.ok(
      Object.keys(pkg.bin ?? {}).includes(`${NAME}-mcp`),
      "the MCP entry needs a bin name derived from the package name",
    );
  });

  it("builds before it packs, so the tarball carries dist", () => {
    assert.match(pkg.scripts.prepack ?? "", /build/, "npm pack must produce a usable package");
  });
});
