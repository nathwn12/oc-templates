<h1 align="center">oc-template</h1>
<p align="center">Scaffold for an OpenCode v2 plugin plus a dependency-free stdio MCP server.</p>

## Install

Requires Node.js >= 22:

```sh
npm install --no-audit --no-fund
npm run build
```

## Usage

### As a plugin

Add this package to your project, then list it in `plugins` in `opencode.json(c)` so its `template-status` command and `execute.before` hook load at startup:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["oc-template"]
}
```

### As a local MCP server

Build once (`npm run build`), then wire the stdio entry into your OpenCode MCP config under `mcp.servers`:

```jsonc
{
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

`type` is required and `command` is an array of arguments.

Run it directly to check stdio output:

```sh
npm run mcp
```

Tools served: `echo` (returns the supplied `text` unchanged).

The bundled server implements the MCP handshake revisions up to `2025-11-25`; supporting `2026-07-28` requires the v2 MCP SDK packages.

## Status

Experimental and still moving. It works today, but it is not a finished
product: interfaces may change, features may be improved or removed, and a
release can break the one before it. This is maintained by one person, not a
team. If it breaks, open an issue with the command you ran and what you saw.

## Links

- [Releases](https://github.com/nathwn12/oc-templates/releases)
- [MIT](LICENSE)
