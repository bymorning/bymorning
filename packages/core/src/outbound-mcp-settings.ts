/** Workspace MCP settings application boundary. */
export * as OutboundMCPSettings from "./outbound-mcp-settings.js"

import { ConfigMCP } from "@bymorning/schema/config/mcp"
import { Effect, Option, Schema } from "effect"
import type { Actor } from "./actor.js"
import type { Config } from "./config.js"
import type { Credential } from "./credential.js"
import { Integration } from "./integration.js"
import { Mcp } from "./mcp.js"

const NameSchema = Schema.Trim.check(
  Schema.makeFilter((name) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
      ? undefined
      : "MCP server name must be 1-64 letters, numbers, dots, underscores, or hyphens",
  ),
)

/** A normalized MCP server settings key. */
export const Name = NameSchema

/** MCP settings input could not be normalized. */
export class InvalidInputError extends Schema.TaggedError<InvalidInputError>()(
  "OutboundMCPSettings.InvalidInputError",
  { message: Schema.String },
) {}

/** Values accepted by the shared MCP settings put operation. */
export interface PutInput {
  readonly name: string
  readonly url: string
  readonly oauth?: ConfigMCP.OAuth
  readonly codemode?: boolean
  readonly disabled?: boolean
  /**
   * Request headers. Values may refer to Member Values as `${NAME}` and to the
   * member's verified email as `${member.email}`; `$${` is a literal `${`.
   */
  readonly headers?: Readonly<Record<string, string>>
}

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const control = /[\u0000-\u001f\u007f]/

/** Why a server's headers cannot be saved, if they cannot. */
const headersProblem = (headers: Readonly<Record<string, string>> | undefined, oauth: ConfigMCP.OAuth | undefined) => {
  if (headers === undefined) return undefined
  for (const [name, value] of Object.entries(headers)) {
    if (!headerName.test(name)) return `Invalid header name: ${name}`
    if (control.test(value)) return `Header ${name} contains a line break or control character`
  }
  const found = ConfigMCP.placeholders({ ...headers })
  if (found.error !== undefined) return found.error
  if ((found.member.length > 0 || found.builtin.length > 0) && oauth !== false)
    return "A server cannot combine OAuth with member values; choose member values or OAuth"
  return undefined
}

/** Normalize and transactionally persist a remote MCP server. */
export const put = Effect.fn("OutboundMCPSettings.put")(function* (
  config: Config.Interface,
  input: PutInput,
  actor: Actor.Info,
) {
  const decoded = Schema.decodeUnknownOption(Name)(input.name)
  if (Option.isNone(decoded)) {
    return yield* new InvalidInputError({
      message: "MCP server name must be 1-64 letters, numbers, dots, underscores, or hyphens",
    })
  }
  const url = URL.parse(input.url)
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return yield* new InvalidInputError({ message: "MCP server URL must be an absolute HTTP(S) URL" })
  }
  const problem = headersProblem(input.headers, input.oauth)
  if (problem !== undefined) return yield* new InvalidInputError({ message: problem })
  const server = {
    type: "remote",
    url: url.href,
    ...(input.headers === undefined || Object.keys(input.headers).length === 0 ? {} : { headers: { ...input.headers } }),
    ...(input.oauth === undefined ? {} : { oauth: input.oauth }),
    ...(input.codemode === undefined ? {} : { codemode: input.codemode }),
    ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
  } satisfies ConfigMCP.Remote
  yield* config.mcp.put(decoded.value, server, actor)
  return { name: decoded.value, server }
})

/**
 * Discard every member's saved authentication for servers that were removed or
 * moved to another address: those Credentials were entrusted to the previous
 * address and are never sent anywhere else. Callers authorize the change first.
 */
export const prune = Effect.fn("OutboundMCPSettings.prune")(function* (
  credential: Credential.Interface,
  before: ConfigMCP.Info | undefined,
  after: ConfigMCP.Info | undefined,
) {
  for (const [name, server] of Object.entries(before?.servers ?? {})) {
    const next = after?.servers?.[name]
    if (next !== undefined && next.url === server.url) continue
    yield* credential.discard(Integration.ID.make(Mcp.identity(name, server.url)))
  }
})
