import { describe, it } from "node:test";
import assert from "node:assert/strict";

import plugin, { PLUGIN_ID, PLUGIN_VERSION } from "../dist/plugin.js";
import { COMMAND_NAME } from "../dist/identity.js";

function fakeContext() {
  const commands = [];
  const hooks = [];
  const writes = [];
  const disposed = [];
  const registration = (name) => ({
    dispose: async () => {
      disposed.push(name);
    },
  });

  const context = {
    command: {
      transform: async (callback) => {
        callback({ add: (definition) => commands.push(definition) });
        return registration("command");
      },
    },
    tool: {
      hook: async (name, callback) => {
        hooks.push({ name, callback });
        return registration("tool");
      },
    },
    storage: {
      set: async (key, value) => {
        writes.push({ key, value });
      },
    },
  };

  return { context, commands, hooks, writes, disposed };
}

describe("plugin entry", () => {
  it("exposes the identity OpenCode loads", () => {
    assert.equal(plugin.id, PLUGIN_ID);
    assert.equal(typeof plugin.id, "string");
    assert.equal(typeof plugin.setup, "function");
    assert.match(PLUGIN_VERSION, /^\d+\.\d+\.\d+/);
  });

  it("registers the status command and the tool hook, then releases both", async () => {
    const { context, commands, hooks, disposed } = fakeContext();
    const cleanup = await plugin.setup(context);

    assert.equal(commands.length, 1);
    assert.equal(commands[0].name, COMMAND_NAME);
    assert.equal(typeof commands[0].execute, "function");

    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].name, "execute.before");

    await cleanup();
    assert.deepEqual(disposed.sort(), ["command", "tool"]);
  });

  it("namespaces storage under the plugin id so copies do not collide", async () => {
    const { context, commands, hooks, writes } = fakeContext();
    await plugin.setup(context);

    await commands[0].execute({});
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, `${PLUGIN_ID}:last-command`);
    assert.ok(!Number.isNaN(Date.parse(writes[0].value)), "stores an ISO timestamp");

    await hooks[0].callback({ tool: "read" });
    assert.deepEqual(writes[1], { key: `${PLUGIN_ID}:last-tool`, value: "read" });
  });
});
