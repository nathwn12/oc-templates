<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="oc-template icon" />
</p>
<h1 align="center">oc-template</h1>
<p align="center"><strong>A working OpenCode v2 plugin and a dependency-free MCP server in one small TypeScript repo you copy and rename.</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/nathwn12/oc-templates" alt="License" /></a>
  <img src="https://img.shields.io/github/languages/top/nathwn12/oc-templates" alt="Language" />
</p>

This is a scaffold, not a library. The plugin registers a slash command and an `execute.before` hook; the MCP server speaks both protocol eras the specification defines; the tests drive both. Rename it in one file, then write the tool you actually wanted.

## Install

Clone it under the name your project will carry, then build and test:

```sh
git clone https://github.com/nathwn12/oc-templates my-plugin
cd my-plugin
npm install
npm run check
```

`npm run check` builds with `tsc` and runs the suite, so a fresh clone needs no other step. Both halves are plain ESM in `dist/`; nothing else is required at runtime.

A git-URL dependency installs the source without `dist/`. When something needs the package itself rather than a copied tree, build the clone first or install the packed tarball (`npm pack`).

### Wire it yourself

The MCP server runs from the built entry. Point `opencode.json(c)` at it:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "oc-template": {
        "type": "local",
        "command": ["node", "dist/mcp.js"]
      }
    }
  }
}
```

`type` is required and `command` is an array of arguments, never a string. `dist/mcp.js` is also published as a `bin`, so an installed copy can use `"command": ["oc-template-mcp"]` instead of a file path.

The plugin is listed under `plugins`, as a package string or in the object form that carries options:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["oc-template"]
}
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "oc-template", "options": {} }]
}
```

## Use it

After `npm run check`, drive the MCP server by hand to see the wire:

```sh
npm run mcp
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

It prints one JSON-RPC reply per line and stays silent on notifications. Its one tool is `echo`, which returns the `text` argument unchanged.

## What you get

| File | What it is |
|---|---|
| `src/identity.ts` | Name, version, command name and storage prefix — the only identity file |
| `src/plugin.ts` | Plugin entry: the `COMMAND_NAME` command (shipped as `template-status`) plus an `execute.before` tool hook |
| `src/mcp.ts` | stdio MCP server: `initialize`, `server/discover`, `ping`, `tools/list`, `tools/call` |
| `test/` | The suite: protocol negotiation, transport framing, plugin registration, identity drift |

## Configure it

**Protocol era.** The server is dual-era and needs no configuration for either. `2025-11-25` is the last handshake revision and the one `initialize` answers; `2026-07-28` declares its version per request in `_meta` and is served statelessly. OpenCode's optional `protocol` key selects which era a client speaks:

| `protocol` | What OpenCode does | Against this server |
|---|---|---|
| `legacy` (default) | opens with `initialize` | negotiated to `2025-11-25` |
| `auto` | probes `server/discover`, falls back | stays on `2026-07-28` |
| `2026-07-28` | requires the current revision | works |

A version the server does not implement is never echoed:

- handshake: the reply carries `2025-11-25`, the handshake revision the server implements;
- per-request: the request is refused with `-32022` (`UnsupportedProtocolVersionError`) and `data.supported` / `data.requested` for the client to retry against.

**Renaming.** Edit `src/identity.ts` and the `name`, `version` and `bin` fields in `package.json`. `test/identity.test.mjs` fails when the two disagree, and it also checks that `package.json` still ships `src` (the source maps in `dist` point there) and a `bin` named `<name>-mcp`.

```ts
// src/identity.ts
export const NAME = "my-plugin"
export const VERSION = "0.1.0"
export const COMMAND_NAME = "my-plugin-status"
export const STORAGE_PREFIX = `${NAME}:`
```

Storage keys are namespaced by `STORAGE_PREFIX`, so two copies of the scaffold in one OpenCode profile cannot overwrite each other.

**Adding a tool.** Append to `TOOLS` and add its branch to `dispatch` in `src/mcp.ts`; the modern and legacy reply shapes are applied for you. **Adding a command or hook.** Follow the two functions in `src/plugin.ts` — every hook is `context.tool.hook(name, callback)`, and each returns a registration whose `dispose` runs on unload.

## Requirements

Node.js 26 or newer (`engines`), TypeScript 7 for the build, and OpenCode 2.x for `plugins` and `mcp.servers`. `@opencode/plugin` is the only runtime dependency; the MCP server has none.

## Status

Experimental and still moving. It works today, but it is not a finished
product: interfaces may change, features may be improved or removed, and a
release can break the one before it. This is maintained by one person, not a
team. If it breaks, open an issue with the command you ran and what you saw.

## Links

- [Releases](https://github.com/nathwn12/oc-templates/releases)
- [Issues](https://github.com/nathwn12/oc-templates/issues)
- [MIT](LICENSE)
