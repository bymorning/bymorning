export * as ConfigMCP from "./mcp.js"

import { Schema } from "effect"
import { PositiveInt, optional } from "../schema.js"

export const Timeout = Schema.Struct({
  startup: PositiveInt.pipe(optional).annotate({
    description: "Maximum time in milliseconds to establish and initialize the MCP server. Defaults to 30000.",
  }),
  catalog: PositiveInt.pipe(optional).annotate({
    description: "Maximum time in milliseconds for each tools/list request. Defaults to 30000.",
  }),
  execution: PositiveInt.pipe(optional).annotate({
    description: "Maximum time in milliseconds for a tool call. Defaults to 43200000 (12 hours).",
  }),
})
export interface Timeout extends Schema.Schema.Type<typeof Timeout> {}

export const OAuth = Schema.Union([
  Schema.Literal(false),
  Schema.Struct({
    client_id: Schema.String.pipe(optional),
    scope: Schema.String.pipe(optional),
  }),
])
export type OAuth = typeof OAuth.Type

/** Workspace override for one outbound MCP server's participation. */
export const Activation = Schema.Literals(["enabled", "disabled"])
export type Activation = typeof Activation.Type

export const Remote = Schema.Struct({
  type: Schema.Literal("remote"),
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  disabled: Schema.Boolean.pipe(optional),
  enabled: Schema.Boolean.pipe(optional),
  codemode: Schema.Boolean.pipe(optional),
  timeout: Timeout.pipe(optional),
  /** OAuth is enabled by default. Set false for servers with another authentication policy. */
  oauth: OAuth.pipe(optional),
})
export interface Remote extends Schema.Schema.Type<typeof Remote> {}

/** Values ByMorning supplies from the member's own account. */
export const builtins = ["member.email"] as const
export type Builtin = (typeof builtins)[number]

/** One parsed piece of a header value: literal text or a placeholder reference. */
export type Segment =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "member"; readonly name: string }
  | { readonly type: "builtin"; readonly name: Builtin }

const memberName = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Parse one header value. `${NAME}` refers to a Member Value, `${member.email}`
 * to a value ByMorning supplies, and `$${` is a literal `${`.
 */
export const parseHeader = (value: string): { readonly segments: Segment[] } | { readonly error: string } => {
  const segments: Segment[] = []
  let text = ""
  let index = 0
  while (index < value.length) {
    if (value.startsWith("$${", index)) {
      text += "${"
      index += 3
      continue
    }
    if (!value.startsWith("${", index)) {
      text += value[index]
      index += 1
      continue
    }
    const end = value.indexOf("}", index + 2)
    if (end === -1) return { error: `Unclosed placeholder in header value: ${value.slice(index)}` }
    const name = value.slice(index + 2, end)
    if (text) segments.push({ type: "text", text })
    text = ""
    if (name.startsWith("member.")) {
      if (!(builtins as readonly string[]).includes(name))
        return { error: `Unknown ByMorning value \${${name}}. Supported: ${builtins.map((item) => `\${${item}}`).join(", ")}` }
      segments.push({ type: "builtin", name: name as Builtin })
    } else {
      if (!memberName.test(name))
        return { error: `Invalid placeholder \${${name}}: use letters, numbers, and underscores` }
      segments.push({ type: "member", name })
    }
    index = end + 1
  }
  if (text) segments.push({ type: "text", text })
  return { segments }
}

/** Member Value and ByMorning value names referenced by a server's headers, or the first parse error. */
export const placeholders = (
  headers: Record<string, string> | undefined,
): { readonly member: string[]; readonly builtin: Builtin[]; readonly error?: string } => {
  const member = new Set<string>()
  const builtin = new Set<Builtin>()
  for (const value of Object.values(headers ?? {})) {
    const parsed = parseHeader(value)
    if ("error" in parsed) return { member: [], builtin: [], error: parsed.error }
    for (const segment of parsed.segments) {
      if (segment.type === "member") member.add(segment.name)
      if (segment.type === "builtin") builtin.add(segment.name)
    }
  }
  return { member: [...member], builtin: [...builtin] }
}

/** Whether a server's headers refer to any per-member value. */
export const personal = (headers: Record<string, string> | undefined) => {
  const found = placeholders(headers)
  return found.error === undefined && (found.member.length > 0 || found.builtin.length > 0)
}

/** Shown instead of a shared header value to callers who may not read it. */
export const redacted = "[redacted]"

type HeaderSource = { readonly mcp?: { readonly servers?: Readonly<Record<string, Remote>> } | undefined }

const mapHeaders = <T extends HeaderSource>(
  config: T,
  map: (server: string, header: string, value: string) => string,
): T => {
  const servers = config.mcp?.servers
  if (servers === undefined || Object.values(servers).every((server) => server.headers === undefined)) return config
  return {
    ...config,
    mcp: {
      ...config.mcp,
      servers: Object.fromEntries(
        Object.entries(servers).map(([name, server]) => [
          name,
          server.headers === undefined
            ? server
            : {
                ...server,
                headers: Object.fromEntries(
                  Object.entries(server.headers).map(([header, value]) => [header, map(name, header, value)]),
                ),
              },
        ]),
      ),
    },
  }
}

/**
 * Hide shared header values from callers who may not read them. A value that
 * refers to Member Values (`${NAME}`, `${member.email}`) is an administrator's
 * template, not a secret, and stays visible so the configuration still explains
 * what each member supplies; keep secrets out of text written beside a placeholder.
 */
export const redact = <T extends HeaderSource>(config: T): T =>
  mapHeaders(config, (_server, _header, value) => {
    const parsed = parseHeader(value)
    return "segments" in parsed && parsed.segments.some((segment) => segment.type !== "text") ? value : redacted
  })

/**
 * Put back stored values where a caller returned the redacted marker unchanged,
 * so a round trip of a redacted document does not read as an edit.
 */
export const restore = <T extends HeaderSource>(config: T, stored: HeaderSource): T =>
  mapHeaders(config, (server, header, value) =>
    value === redacted ? (stored.mcp?.servers?.[server]?.headers?.[header] ?? value) : value,
  )

export const Info = Schema.Struct({
  servers: Schema.Record(Schema.String, Remote).pipe(optional),
  activation: Schema.Record(Schema.String, Activation).pipe(optional),
})
export interface Info extends Schema.Schema.Type<typeof Info> {}
