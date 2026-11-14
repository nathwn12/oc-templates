# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- MCP protocol negotiation follows the specification. An `initialize` request for a version the server does not implement is answered with `2025-11-25` instead of having the request echoed back, and the server now serves the current revision `2026-07-28` per request: version read from `_meta`, `server/discover` implemented, unsupported versions refused with `-32022` carrying `supported` and `requested`.
- Identity lives in `src/identity.ts`: name, version, command name and storage prefix are declared once and imported by both entry points. `test/identity.test.mjs` fails when `package.json` and the constants disagree.
- `npm test` builds first, so the suite passes from a clean checkout; `npm run check` is the same command.
- `README.md` documents the install routes that exist and the `protocol` key instead of an unpublished package.
- `engines` raised to Node.js 26, matching `@types/node` and the runtime the suite runs on. The previous `>=22` advertised a runtime the types did not describe.

### Added

- `test/mcp.test.mjs` and `test/plugin.test.mjs`: protocol negotiation and framing, and plugin registration, storage namespacing and cleanup.
- `assets/icon.svg`, `.github/workflows/ci.yml`.
- `repository`, `bugs`, `homepage` and a `<name>-mcp` `bin` in `package.json`; `src` now ships so the `dist` source maps resolve.

### Removed

- `test/smoke.test.mjs`, replaced by the two suites above.
- The exported `PROTOCOL_VERSION` constant, replaced by `LEGACY_PROTOCOL_VERSION`, `MODERN_PROTOCOL_VERSION` and `SUPPORTED_PROTOCOL_VERSIONS`.

## [0.1.0] - 2026-10-30

### Added

- Initial `oc-template` scaffold: OpenCode v2 plugin entry (`template-status` command + `execute.before` hook) and dependency-free stdio MCP server with `echo` tool.
