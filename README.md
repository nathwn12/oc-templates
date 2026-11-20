<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="oc-template icon" />
</p>
<h1 align="center">oc-template</h1>
<p align="center"><strong>A working OpenCode v2 plugin and a dependency-free MCP server in one small repo you copy and rename.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-windows%20linux-blue" alt="platform">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

## Why

This is a scaffold, not a library. The plugin registers a slash command and an `execute.before` hook. The MCP server speaks both protocol eras the specification defines, and the tests drive both. Set the identity, then write the tool you wanted.

## Install

Clone it under the name your project will carry, then build and test:

```sh
git clone https://github.com/nathwn12/oc-templates my-plugin
cd my-plugin
npm install
npm run check
```

`npm run check` builds with `tsc` and runs the suite, so a fresh clone needs no other step. A git-URL dependency installs the source without `dist/`; to use the package itself, build the clone or install the packed tarball (`npm pack`).

The MCP server runs from the built entry, and the plugin is loaded by package name:

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

## Configure it

**Protocol era.** The server is dual-era and needs no configuration for either. `2025-11-25` is the last handshake revision and the one `initialize` answers; `2026-07-28` declares its version per request in `_meta` and is served statelessly. OpenCode's optional `protocol` key selects the era, defaulting to `legacy`:

| `protocol` | What OpenCode does | Against this server |
| --- | --- | --- |
| `legacy` (default) | opens with `initialize` | negotiated to `2025-11-25` |
| `auto` | probes `server/discover`, falls back | stays on `2026-07-28` |
| `2026-07-28` | requires the current revision | works |

A version the server does not implement is never echoed: the handshake reply carries `2025-11-25`, and a per-request version is refused with `-32022` plus `data.supported` and `data.requested` for the client to retry against.

**Renaming.** Edit `src/identity.ts` and the `name`, `version` and `bin` fields in `package.json`. `tests/identity.test.mjs` fails when the two disagree, and checks that `package.json` still ships `src` and a `bin` named `<name>-mcp`. Storage keys are namespaced by `STORAGE_PREFIX`, so two copies of the scaffold in one OpenCode profile cannot overwrite each other.

**Adding code.** Append to `TOOLS` and add its branch to `dispatch` in `src/mcp.ts`; the modern and legacy reply shapes are applied for you. Follow the two functions in `src/plugin.ts` for a command or hook — every hook is `context.tool.hook(name, callback)`, and each returns a registration whose `dispose` runs on unload.

## Requirements

- Node.js 26 or newer (`engines`) and TypeScript 7 for the build.
- OpenCode 2.x for `plugins` and `mcp.servers`.
- `@opencode/plugin` is the only runtime dependency; the MCP server has none.

## Development

```sh
npm run build   # tsc -p tsconfig.json, src/ to dist/
npm run check   # build, then node --test tests/*.test.mjs
```

```
oc-template/
├── src/       plugin.ts, mcp.ts, identity.ts
├── tests/     protocol, plugin and identity suites
├── assets/    icon.svg
├── .github/   ci.yml
└── package.json
```

## Status

**Experimental** - pre-release; interfaces may change.

## Links

- [Issues](https://github.com/nathwn12/oc-templates/issues)
- [Changelog](CHANGELOG.md)
- [MIT](LICENSE)

<p align="center"><sub>Built by nathwn12</sub></p>
