#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type { Readable, Writable } from "node:stream"

import { NAME, VERSION } from "./identity.js"

export const SERVER_NAME = NAME
export const SERVER_VERSION = VERSION

export const MODERN_PROTOCOL_VERSION = "2026-07-28"

export const LEGACY_PROTOCOL_VERSION = "2025-11-25"

export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  MODERN_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSION,
]

const HANDSHAKE_PROTOCOL_VERSIONS: readonly string[] = [LEGACY_PROTOCOL_VERSION]

export const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
export const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"

export const UNSUPPORTED_PROTOCOL_VERSION = -32022

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
  if (message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    return invalidRequest()
  }
  if (message["id"] === undefined) return null
  if (typeof message["id"] !== "string" && typeof message["id"] !== "number") {
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

/**
 * True when this module is the entry the process was started with.
 *
 * The paths are compared after resolving links: `npm` installs a `bin` as a
 * symlink on Unix, so `argv[1]` names the same file as the module URL by a
 * different path, and a bare URL comparison leaves the documented
 * `"command": ["<name>-mcp"]` starting nothing at all.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  serve(process.stdin, process.stdout)
}
