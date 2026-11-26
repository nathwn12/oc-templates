<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="oc-template icon" />
</p>
<h1 align="center">oc-template</h1>
<p align="center"><strong>A working OpenCode v2 plugin and a dependency-free MCP server in one small repo you copy and rename.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-windows%20linux-blue" alt="platform">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

## Install

Clone it under the name your project will carry, then build and test:

```sh
git clone https://github.com/nathwn12/oc-templates my-plugin
cd my-plugin
npm install
npm run check
```

`npm run check` builds with `tsc` and runs the suite, so a fresh clone needs no other step. Load the plugin and MCP server by adding this to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "servers": { "oc-template": { "type": "local", "command": ["node", "dist/mcp.js"] } } },
  "plugins": ["oc-template"]
}
```

`type` is required and `command` is an array of arguments, never a string. `dist/mcp.js` is also published as a `bin`, so an installed copy can use `"command": ["oc-template-mcp"]`.

## Use it

Drive the MCP server by hand to see the wire:

```sh
npm run mcp
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

It prints one JSON-RPC reply per line and stays silent on notifications. Its one tool is `echo`, which returns the `text` argument unchanged. The plugin ships a `template-status` command and one tool hook.

| File | What it is |
| --- | --- |
| `src/identity.ts` | Name, version, command name and storage prefix — the only identity file |
| `src/plugin.ts` | Plugin entry: the command plus an `execute.before` tool hook |
| `src/mcp.ts` | stdio MCP server: `initialize`, `server/discover`, `ping`, `tools/list`, `tools/call` |
| `tests/` | Protocol negotiation, transport framing, plugin registration and identity drift |

## Requirements

- Node.js 26 or newer (`engines`) and TypeScript 7 for the build.
- OpenCode 2.x for `plugins` and `mcp.servers`.
- `@opencode/plugin` is the only runtime dependency; the MCP server has none.

## Status

**Experimental** - pre-release; interfaces may change.

## Links

- [Issues](https://github.com/nathwn12/oc-templates/issues)
- [Changelog](CHANGELOG.md)
- [MIT](LICENSE)
