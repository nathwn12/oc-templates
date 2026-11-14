#!/usr/bin/env node
/**
 * Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0, no dependencies.
 *
 * It speaks both protocol eras the specification defines:
 *
 * - **legacy** (`2025-11-25` and earlier): a client opens with the `initialize`
 *   handshake. The reply must carry a version the server implements, so a
 *   requested version this server does not serve is answered with the one it does.
 * - **modern** (`2026-07-28`): every request declares its version in
 *   `_meta["io.modelcontextprotocol/protocolVersion"]`. An unsupported version is
 *   refused with `-32022` (`UnsupportedProtocolVersionError`) carrying the
 *   supported list, and `server/discover` reports versions and capabilities up
 *   front.
 *
 * Wire it into opencode under the V2 `mcp.servers` map; `type` is required and
 * `command` is an array, never a string:
 *   { "mcp": { "servers": { "<name>": { "type": "local", "command": ["<name>-mcp"] } } } }
 *
 * `respond` and `serve` are exported so the protocol can be driven in a test
 * without a pipe.
 */
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import type { Readable, Writable } from "node:stream"

import { NAME, VERSION } from "./identity.js"

export const SERVER_NAME = NAME
export const SERVER_VERSION = VERSION

/** Current revision: per-request `_meta`, `server/discover`, no handshake. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28"

/** Last handshake revision, and the one this server implements. */
export const LEGACY_PROTOCOL_VERSION = "2025-11-25"

/** Every revision this server answers, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  MODERN_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSION,
]

/** Handshake revisions served by `initialize`. A client that asks for another one
 * is answered with the newest entry instead of having its request echoed back. */
const HANDSHAKE_PROTOCOL_VERSIONS: readonly string[] = [LEGACY_PROTOCOL_VERSION]

export const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
export const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"

/** `UnsupportedProtocolVersionError`, reserved for the specification. */
export const UNSUPPORTED_PROTOCOL_VERSION = -32022

/** `Invalid Request`: the message is not a well-formed JSON-RPC 2.0 request. */
export const INVALID_REQUEST = -32600

const CAPABILITIES = { tools: { listChanged: false } } as const

export type RpcId = string | number | null

export interface RpcMessage {
  jsonrpc: "2.0"
  id?: RpcId
  method?: string
  params?: unknown
}

export interface RpcSuccess {
  jsonrpc: "2.0"
  id: RpcId
  result: unknown
}

export interface RpcFailure {
  jsonrpc: "2.0"
  id: RpcId
  error: { code: number; message: string; data?: unknown }
}

/** Capability catalogue served by `tools/list`. */
export const TOOLS = [
  {
    name: "echo",
    description: `Return the supplied text unchanged (${NAME} example tool).`,
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo back." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
] as const

type Json = Record<string, unknown>

type Outcome =
  | { kind: "result"; result: Json }
  | { kind: "error"; code: number; message: string; data?: unknown }

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

/** A JSON-RPC message is an object; arrays and primitives are invalid requests. */
function isMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalidRequest(): RpcFailure {
  return { jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "invalid request" } }
}

function serverInfo() {
  return { name: SERVER_NAME, version: SERVER_VERSION }
}

function text(value: string, isError = false) {
  return { content: [{ type: "text", text: value }], isError }
}

/** The per-request version a modern client declares, or `undefined` for a legacy one. */
function requestedVersion(params: Record<string, unknown>): string | undefined {
  const version = asRecord(params["_meta"])[PROTOCOL_VERSION_KEY]
  return typeof version === "string" ? version : undefined
}

function dispatch(message: RpcMessage, params: Record<string, unknown>, modern: boolean): Outcome {
  switch (message.method) {
    case "server/discover": {
      if (!modern) {
        return { kind: "error", code: -32601, message: "method not found: server/discover" }
      }
      return {
        kind: "result",
        result: { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS], capabilities: CAPABILITIES },
      }
    }
    case "ping":
      return { kind: "result", result: {} }
    case "tools/list":
      return { kind: "result", result: { tools: TOOLS } }
    case "tools/call": {
      if (params["name"] !== "echo") {
        return {
          kind: "error",
          code: -32602,
          message: `unknown tool: ${String(params["name"])}`,
        }
      }
      const value = asRecord(params["arguments"])["text"]
      if (typeof value !== "string") {
        return {
          kind: "error",
          code: -32602,
          message: "echo requires a string `text` argument",
        }
      }
      return { kind: "result", result: text(value) }
    }
    default:
      return {
        kind: "error",
        code: -32601,
        message: `method not found: ${String(message.method)}`,
      }
  }
}

/**
 * Map one inbound message to its reply. Returns `null` for notifications
 * (no `id`), which the protocol requires to go unanswered, and an `-32600`
 * Invalid Request for anything that is not a well-formed JSON-RPC 2.0 request.
 */
export function respond(message: unknown): RpcSuccess | RpcFailure | null {
  if (!isMessage(message)) return invalidRequest()
  if (message["id"] === undefined) return null
  if (
    message["jsonrpc"] !== "2.0" ||
    typeof message["method"] !== "string" ||
    (typeof message["id"] !== "string" && typeof message["id"] !== "number")
  ) {
    return invalidRequest()
  }

  const request = message as unknown as RpcMessage
  const id = request.id as RpcId
  const params = asRecord(request.params)

  if (request.method === "initialize") {
    const requested = params["protocolVersion"]
    const negotiated =
      HANDSHAKE_PROTOCOL_VERSIONS.find((version) => version === requested) ??
      LEGACY_PROTOCOL_VERSION
    return {
      jsonrpc: "2.0",
      id,
      result: { protocolVersion: negotiated, capabilities: CAPABILITIES, serverInfo: serverInfo() },
    }
  }

  const requested = requestedVersion(params)
  const modern = requested !== undefined
  if (requested !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: UNSUPPORTED_PROTOCOL_VERSION,
        message: "Unsupported protocol version",
        data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested },
      },
    }
  }

  const outcome = dispatch(request, params, modern)
  if (outcome.kind === "error") {
    return {
      jsonrpc: "2.0",
      id,
      error:
        outcome.data === undefined
          ? { code: outcome.code, message: outcome.message }
          : { code: outcome.code, message: outcome.message, data: outcome.data },
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    result: modern
      ? { resultType: "complete", ...outcome.result, _meta: { [SERVER_INFO_KEY]: serverInfo() } }
      : outcome.result,
  }
}

/** Serve newline-delimited JSON-RPC until the input stream ends. */
export function serve(input: Readable, output: Writable): void {
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on("line", (line) => {
    const trimmed = line.trim()
    if (trimmed === "") return

    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`)
      return
    }

    const reply = respond(message)
    if (reply !== null) output.write(`${JSON.stringify(reply)}\n`)
  })
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  serve(process.stdin, process.stdout)
}
