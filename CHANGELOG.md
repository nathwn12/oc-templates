# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Server-side MCP Skills (SEP-2640): `skills/list`, `skills/get`, `resources/read` for `skill://` URIs, capability declaration, and a seed skill under `skills/example/`.

### Changed

- The suite lives in `tests/` instead of `test/`, matching the repository layout; `npm test`, the identity doc comment and the README point there.
- `README.md` follows the house README model: the seven fixed sections in order, "What you get" folded into `## Use it`, `## Development` with the build and test commands and the repo tree, the Status label verbatim, and Links ordered Issues, docs, licence.

## [0.2.0] - 2026-11-14

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

### Fixed

- A frame that is not a well-formed JSON-RPC 2.0 request — `null`, a primitive, an array, a wrong `jsonrpc` value, a missing or non-string `method`, a `null` id, or an object with no `id` at all — is answered with `-32600` Invalid Request and `id: null`. The server previously threw on the first such frame and exited, taking every later request with it; an id-less object was then discarded as a notification before any validation.
- The stdio entry starts when invoked through a link, which is what an `npm` `bin` is on Unix. The entry check compared `argv[1]` to the module URL as strings, so the symlinked command started nothing and exited 0. Paths are now compared after resolving links.
- `npm pack` builds first (`prepack`), so the tarball carries `dist/`. Packing a clean clone used to produce a package whose `main`, `bin` and `exports` pointed at files that were not in it.
- The suite derives the example command name from `identity.ts` instead of pinning it, so renaming `COMMAND_NAME` no longer fails two tests.

## [0.1.0] - 2026-10-30

### Added

- Initial `oc-template` scaffold: OpenCode v2 plugin entry (`template-status` command + `execute.before` hook) and dependency-free stdio MCP server with `echo` tool.
