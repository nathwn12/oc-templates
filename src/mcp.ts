#!/usr/bin/env node
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import path from "node:path"
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

export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills"

export const UNSUPPORTED_PROTOCOL_VERSION = -32022

export const INVALID_REQUEST = -32600

export const CAPABILITIES = {
  tools: { listChanged: false },
  resources: {},
  extensions: { [SKILLS_EXTENSION]: {} },
} as const

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

export interface SkillResource {
  uri: string
  digest: string
  size: number
}

export interface Skill {
  uri: string
  frontmatter: Record<string, unknown>
  resources: SkillResource[]
}

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

// --- Skills loading -------------------------------------------------------

export const SKILLS_ROOT = fileURLToPath(new URL("../skills", import.meta.url))

export const SKILLS: Skill[] = []

export const SKILL_ERRORS: string[] = []

const RESOURCE_BYTES = new Map<string, Buffer>()

function logSkillError(folder: string, reason: string): void {
  const message = `skill "${folder}" skipped: ${reason}`
  SKILL_ERRORS.push(message)
  console.error(`oc-template-mcp: ${message}`)
}

function validateName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === "") return null
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null" || value === "~") return null
  if (/^-?\d+$/.test(value)) return Number(value)
  if (/^-?\d+\.\d+$/.test(value)) return Number(value)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function firstNonEmpty(lines: string[]): string | undefined {
  return lines.find((line) => line.trim() !== "")
}

function minIndent(lines: string[]): number {
  let min = Infinity
  for (const line of lines) {
    if (line.trim() === "") continue
    const match = line.match(/^ */)
    const indent = match ? match[0].length : 0
    if (indent < min) min = indent
  }
  return min === Infinity ? 0 : min
}

function parseYamlNode(lines: string[]): unknown {
  const first = firstNonEmpty(lines)
  if (!first) return {}
  if (first.trim().startsWith("- ")) return parseYamlSequence(lines)
  return parseYamlMapping(lines)
}

function parseYamlMapping(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    if (lines[i]!.trim() === "") {
      i += 1
      continue
    }
    const match = lines[i]!.match(/^([^:]+):\s*(.*)$/)
    if (!match) {
      throw new Error(`invalid YAML mapping line: ${lines[i]!}`)
    }
    const key = match![1]!.trim()
    const rest = match![2]!.trim()
    if (rest !== "") {
      result[key] = parseScalar(rest)
      i += 1
    } else {
      const children: string[] = []
      i += 1
      while (i < lines.length) {
        if (lines[i]!.trim() === "") {
          children.push(lines[i]!)
          i += 1
          continue
        }
        if (/^\s/.test(lines[i]!)) {
          children.push(lines[i]!)
          i += 1
          continue
        }
        break
      }
      const indent = minIndent(children)
      const normalized = children.map((line) =>
        line.trim() === "" ? "" : line.slice(indent),
      )
      result[key] = parseYamlNode(normalized)
    }
  }
  return result
}

function parseYamlSequence(lines: string[]): unknown[] {
  const result: unknown[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i]!.trim() === "") {
      i += 1
      continue
    }
    const match = lines[i]!.match(/^(\s*)- (.*)$/)
    if (!match) {
      throw new Error(`invalid YAML sequence line: ${lines[i]!}`)
    }
    const itemIndent = match![1]!.length
    const rest = match![2]!.trim()
    if (rest === "") {
      const children: string[] = []
      i += 1
      while (i < lines.length) {
        if (lines[i]!.trim() === "") {
          children.push(lines[i]!)
          i += 1
          continue
        }
        const nextIndent = (lines[i]!.match(/^ */)?.[0].length ?? 0)
        if (nextIndent > itemIndent) {
          children.push(lines[i]!)
          i += 1
          continue
        }
        break
      }
      const indent = minIndent(children)
      const normalized = children.map((line) =>
        line.trim() === "" ? "" : line.slice(indent),
      )
      result.push(parseYamlNode(normalized))
    } else {
      result.push(parseScalar(rest))
      i += 1
    }
  }
  return result
}

function parseFrontmatter(text: string): Record<string, unknown> | null {
  // text already known to start with "---\n"
  const lines = text.split("\n")
  if (lines[0]!.trim() !== "---") return null
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]!.trim() === "---" || lines[i]!.trim() === "...") {
      end = i
      break
    }
  }
  if (end === -1) return null
  const yamlLines = lines.slice(1, end)
  try {
    const parsed = parseYamlNode(yamlLines)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function visit(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      throw new Error(`cannot read directory ${dir}`)
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const resolved = path.resolve(full)
      if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
        continue
      }
      if (entry.isDirectory()) {
        await visit(full)
      } else if (entry.isFile()) {
        out.push(full)
      }
    }
  }
  await visit(root)
  return out
}

async function loadSkill(folderName: string, folderPath: string): Promise<void> {
  const skillMdPath = path.join(folderPath, "SKILL.md")
  let bytes: Buffer
  try {
    bytes = await readFile(skillMdPath)
  } catch {
    logSkillError(folderName, "SKILL.md is missing or unreadable")
    return
  }

  // No BOM and must start with "---\n"
  if (bytes.length < 4 || bytes[0] === 0xef || bytes[1] === 0xbb || bytes[2] === 0xbf) {
    // only treat as BOM if first three bytes are EF BB BF
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    logSkillError(folderName, "SKILL.md has a BOM")
    return
  }
  if (bytes.toString("utf8", 0, 4) !== "---\n") {
    logSkillError(folderName, "SKILL.md does not start with \"---\\n\"")
    return
  }

  const text = bytes.toString("utf8")
  const frontmatter = parseFrontmatter(text)
  if (!frontmatter) {
    logSkillError(folderName, "SKILL.md frontmatter is missing or invalid")
    return
  }
  if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
    logSkillError(folderName, "frontmatter must contain string name and description")
    return
  }
  if (frontmatter.name !== folderName) {
    logSkillError(folderName, `frontmatter name "${frontmatter.name}" does not match folder name`)
    return
  }
  if (!validateName(frontmatter.name)) {
    logSkillError(folderName, "skill name fails the naming rules")
    return
  }
  if (frontmatter.description.length < 1 || frontmatter.description.length > 1024) {
    logSkillError(folderName, "description must be 1-1024 characters")
    return
  }

  let files: string[]
  try {
    files = await walkFiles(folderPath)
  } catch (error) {
    logSkillError(folderName, `cannot enumerate skill files: ${String(error)}`)
    return
  }

  if (files.length > 512) {
    logSkillError(folderName, `skill exceeds the 512-file limit (${files.length})`)
    return
  }

  const resources: SkillResource[] = []
  let totalSize = 0
  for (const file of files) {
    let fileBytes: Buffer
    try {
      fileBytes = await readFile(file)
    } catch {
      logSkillError(folderName, `cannot read ${path.relative(folderPath, file)}`)
      return
    }
    const relative = path.relative(folderPath, file).split(path.sep).join("/")
    const uri = `skill://${folderName}/${relative}`
    const digest = `sha256:${createHash("sha256").update(fileBytes).digest("hex")}`
    resources.push({ uri, digest, size: fileBytes.length })
    totalSize += fileBytes.length
    RESOURCE_BYTES.set(uri, fileBytes)
  }

  if (totalSize > 16 * 1024 * 1024) {
    logSkillError(folderName, `skill exceeds the 16 MiB total size limit (${totalSize})`)
    // remove cached bytes for this skill
    for (const resource of resources) RESOURCE_BYTES.delete(resource.uri)
    return
  }

  resources.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))

  const skillUri = `skill://${folderName}/SKILL.md`
  if (!resources.some((resource) => resource.uri === skillUri)) {
    logSkillError(folderName, "SKILL.md is missing from the resource list")
    return
  }

  SKILLS.push({ uri: skillUri, frontmatter, resources })
  SKILLS.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))
}

async function loadAllSkills(): Promise<void> {
  let entries
  try {
    entries = await readdir(SKILLS_ROOT, { withFileTypes: true })
  } catch {
    console.error(`oc-template-mcp: skills directory not found or unreadable: ${SKILLS_ROOT}`)
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folderPath = path.join(SKILLS_ROOT, entry.name)
    await loadSkill(entry.name, folderPath)
  }
}

await loadAllSkills()

export function listSkills(): Skill[] {
  return [...SKILLS]
}

export function getSkill(uri: string): Skill | undefined {
  return SKILLS.find((skill) => skill.uri === uri)
}

export function readSkillResource(uri: string): { contents: Array<{ uri: string; mimeType: string; text?: string; blob?: string }> } | null {
  const bytes = RESOURCE_BYTES.get(uri)
  if (!bytes) return null
  const text = bytes.toString("utf8")
  const isText = !bytes.includes(0) && Buffer.from(text, "utf8").equals(bytes)
  if (isText) {
    const mimeType = uri.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain"
    return { contents: [{ uri, mimeType, text }] }
  }
  return { contents: [{ uri, mimeType: "application/octet-stream", blob: bytes.toString("base64") }] }
}

// --- Dispatch -------------------------------------------------------------

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
    case "skills/list": {
      const skills = listSkills().map((skill) => ({
        uri: skill.uri,
        frontmatter: skill.frontmatter,
        resources: skill.resources.map((resource) => ({ ...resource })),
      }))
      return {
        kind: "result",
        result: { skills, ttlMs: 0, cacheScope: "private" },
      }
    }
    case "skills/get": {
      const uri = params["uri"]
      if (typeof uri !== "string") {
        return { kind: "error", code: -32602, message: "skills/get requires a string `uri`" }
      }
      const skill = getSkill(uri)
      if (!skill) {
        return { kind: "error", code: -32602, message: `unknown skill: ${uri}` }
      }
      return {
        kind: "result",
        result: {
          skill: {
            uri: skill.uri,
            frontmatter: skill.frontmatter,
            resources: skill.resources.map((resource) => ({ ...resource })),
          },
          ttlMs: 0,
          cacheScope: "private",
        },
      }
    }
    case "resources/read": {
      const uri = params["uri"]
      if (typeof uri !== "string") {
        return { kind: "error", code: -32602, message: "resources/read requires a string `uri`" }
      }
      const result = readSkillResource(uri)
      if (!result) {
        return { kind: "error", code: -32602, message: `unknown resource: ${uri}` }
      }
      return { kind: "result", result }
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
