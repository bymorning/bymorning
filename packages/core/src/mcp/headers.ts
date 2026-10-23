/**
 * Outbound MCP header authentication: how a server authenticates, the Member
 * Values its headers refer to, and the per-member resolution of those headers.
 * Private to the Mcp domain.
 */
export * as McpHeaders from "./headers.js"

import { ConfigMCP } from "@bymorning/schema/config/mcp"
import { AccountActor } from "@bymorning/schema/actor"
import type { Account as AccountSchema } from "@bymorning/schema/account"
import { Effect, Schema } from "effect"
import type { Account } from "../account.js"
import { Integration } from "../integration.js"
import { McpOAuth } from "./oauth.js"

/** How one configured server authenticates. */
export type Kind =
  | { readonly type: "oauth" }
  | { readonly type: "values"; readonly member: readonly string[]; readonly builtin: readonly ConfigMCP.Builtin[] }
  | { readonly type: "none" }
  | { readonly type: "invalid"; readonly message: string }

export const kind = (config: ConfigMCP.Remote): Kind => {
  const found = ConfigMCP.placeholders(config.headers)
  if (found.error !== undefined) return { type: "invalid", message: found.error }
  const personal = found.member.length > 0 || found.builtin.length > 0
  if (config.oauth !== false)
    return personal
      ? { type: "invalid", message: "A server cannot combine OAuth with member values; set oauth to false" }
      : { type: "oauth" }
  return personal ? { type: "values", member: found.member, builtin: found.builtin } : { type: "none" }
}

/** The member-only Integration that carries a server's personal authentication, if any. */
export const integrationID = (name: string, config: ConfigMCP.Remote): string | undefined => {
  const current = kind(config).type
  return current === "oauth" || current === "values" ? McpOAuth.identity(name, config.url) : undefined
}

/** A server's member values could not be resolved or were refused by the server. */
export class ValuesError extends Schema.TaggedError<ValuesError>()("Mcp.ValuesError", {
  message: Schema.String,
}) {}

export const rejected = "Server rejected your values"

/** Register the member-only Integration through which members save a server's values. */
export const register = Effect.fn("McpHeaders.register")(function* (
  integration: Integration.Interface,
  name: string,
  config: ConfigMCP.Remote,
) {
  const current = kind(config)
  if (current.type !== "values") return
  const id = Integration.ID.make(McpOAuth.identity(name, config.url))
  const [first, ...rest] = current.member
  yield* integration.transform((editor) => {
    editor.update(id, (entry) => {
      entry.name = `${name} MCP`
      entry.connectionPolicy = "member-only"
    })
    if (first !== undefined)
      editor.method.update({
        integrationID: id,
        method: { type: "values", label: "Member values", fields: [first, ...rest] },
      })
  })
})

/**
 * Resolve a server's headers for the bound member. Literal and escaped text is
 * rendered for every server; placeholders are filled from the member's own
 * values and account. Missing member values fail with `missing` so the caller
 * reports the server as requiring authentication.
 */
export const resolve = Effect.fn("McpHeaders.resolve")(function* (input: {
  readonly name: string
  readonly config: ConfigMCP.Remote
  readonly integration: Integration.Interface
  readonly account: Account.Interface
  readonly accountID: AccountSchema.ID
}) {
  const current = kind(input.config)
  if (current.type === "invalid") return yield* new ValuesError({ message: current.message })
  if (input.config.headers === undefined) return { type: "ready" as const, headers: undefined }
  const values = yield* (current.type === "values" && current.member.length > 0
    ? memberValues(input.integration, Integration.ID.make(McpOAuth.identity(input.name, input.config.url)))
    : Effect.succeed<Readonly<Record<string, string>>>({}))
  const builtin: Partial<Record<ConfigMCP.Builtin, string>> = {}
  if (current.type === "values" && current.builtin.includes("member.email")) {
    const profile = yield* input.account
      .get(new AccountActor({ type: "account", properties: { accountID: input.accountID } }))
      .pipe(Effect.orElseSucceed(() => undefined))
    if (profile?.email) builtin["member.email"] = profile.email
    else return yield* new ValuesError({ message: "Your account has no verified email for ${member.email}" })
  }
  const missing = current.type === "values" ? current.member.filter((name) => values[name] === undefined) : []
  if (missing.length > 0) return { type: "missing" as const, names: missing }
  const headers: Record<string, string> = {}
  for (const [header, raw] of Object.entries(input.config.headers)) {
    const parsed = ConfigMCP.parseHeader(raw)
    if ("error" in parsed) return yield* new ValuesError({ message: parsed.error })
    headers[header] = parsed.segments
      .map((segment) =>
        segment.type === "text" ? segment.text : segment.type === "member" ? values[segment.name]! : builtin[segment.name]!,
      )
      .join("")
  }
  return { type: "ready" as const, headers }
})

const memberValues = (
  integration: Integration.Interface,
  id: Integration.ID,
): Effect.Effect<Readonly<Record<string, string>>> =>
  Effect.gen(function* () {
    const connection = yield* integration.connection.active(id)
    if (connection === undefined) return {}
    const value = yield* integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
    return value?.type === "values" ? value.values : {}
  })
