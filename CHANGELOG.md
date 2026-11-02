# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- MCP config documented and typed for OpenCode V2: servers live under `mcp.servers` with `type: "local"` and an array `command`.
- Default MCP protocol version raised to `2025-11-25`; a client-requested version, including `2026-07-28`, is still echoed.
- `@opencode/plugin` moved to `dependencies` at `^2.2.5`; TypeScript and `@types/node` bumped.

### Added

- Initial `oc-template` scaffold: OpenCode v2 plugin entry (`template-status` command + `execute.before` hook) and dependency-free stdio MCP server with `echo` tool.
