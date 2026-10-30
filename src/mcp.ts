/**
 * Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0, no dependencies).
 *
 * Wire it into opencode with an MCP entry of type "local", e.g.
 *   { "mcp": { "oc-template": { "type": "local", "command": ["node", "dist/mcp.js"] } } }
 *
 * `respond` is exported so the protocol can be driven in a test without a pipe.
 */
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import type { Readable, Writable } from "node:stream"

export const SERVER_NAME = "oc-template"
export const SERVER_VERSION = "0.1.0"
export const PROTOCOL_VERSION = "2025-06-18"

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
  error: { code: number; message: string }
}

/** Capability catalogue served by `tools/list`. */
export const TOOLS = [
  {
    name: "echo",
    description: "Return the supplied text unchanged (oc-template example tool).",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo back." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
] as const

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: string, isError = false) {
  return { content: [{ type: "text", text: value }], isError }
}

/**
 * Map one inbound message to its reply. Returns `null` for notifications
 * (no `id`), which the protocol requires to go unanswered.
 */
export function respond(message: RpcMessage): RpcSuccess | RpcFailure | null {
  if (message.id === undefined) return null
  const id = message.id

  switch (message.method) {
    case "initialize": {
      const params = asRecord(message.params)
      const requested = params["protocolVersion"]
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      }
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} }
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } }
    case "tools/call": {
      const params = asRecord(message.params)
      if (params["name"] !== "echo") {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `unknown tool: ${String(params["name"])}` },
        }
      }
      const args = asRecord(params["arguments"])
      const value = args["text"]
      if (typeof value !== "string") {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "echo requires a string `text` argument" },
        }
      }
      return { jsonrpc: "2.0", id, result: text(value) }
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${String(message.method)}` },
      }
  }
}

/** Serve newline-delimited JSON-RPC until the input stream ends. */
export function serve(input: Readable, output: Writable): void {
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on("line", (line) => {
    const trimmed = line.trim()
    if (trimmed === "") return

    let message: RpcMessage
    try {
      message = JSON.parse(trimmed) as RpcMessage
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
