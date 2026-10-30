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

Add this package to your project, then reference it from your OpenCode config so its `template-status` command and `execute.before` hook load at startup.

### As a local MCP server

Build once (`npm run build`), then wire the stdio entry into your OpenCode MCP config:

```jsonc
{
  "mcp": {
    "oc-template": {
      "type": "local",
      "command": ["node", "dist/mcp.js"]
    }
  }
}
```

Run it directly to check stdio output:

```sh
npm run mcp
```

Tools served: `echo` (returns the supplied `text` unchanged).
