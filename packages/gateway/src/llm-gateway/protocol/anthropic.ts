import type { Tokens } from "@bymorning/schema/usage"
import { Option, Schema } from "effect"
import { type Failure, message, retryAfter, status } from "../failure.js"
import type { Adapter } from "../protocol.js"
import { jsonHeaders, modelInBody } from "./body.js"

const MessagesUsage = Schema.Struct({
  input_tokens: Schema.optionalKey(Schema.Finite),
  output_tokens: Schema.optionalKey(Schema.Finite),
  cache_read_input_tokens: Schema.optionalKey(Schema.Finite),
  cache_creation_input_tokens: Schema.optionalKey(Schema.Finite),
  cache_creation: Schema.optionalKey(
    Schema.Struct({
      ephemeral_5m_input_tokens: Schema.optionalKey(Schema.Finite),
      ephemeral_1h_input_tokens: Schema.optionalKey(Schema.Finite),
    }),
  ),
})
type MessagesUsage = typeof MessagesUsage.Type

const MessagesReply = Schema.Struct({
  usage: Schema.optionalKey(MessagesUsage),
  message: Schema.optionalKey(Schema.Struct({ usage: Schema.optionalKey(MessagesUsage) })),
})

const normalize = (usage: MessagesUsage): Tokens => ({
  input: usage.input_tokens ?? 0,
  output: usage.output_tokens ?? 0,
  reasoning: 0,
  cacheRead: usage.cache_read_input_tokens ?? 0,
  cacheWrite:
    usage.cache_creation_input_tokens ??
    (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0),
})

const extractRaw = (json: unknown) => {
  const reply = Option.getOrUndefined(Schema.decodeUnknownOption(MessagesReply)(json))
  return reply?.usage ?? reply?.message?.usage
}

const errorType = (code: number) =>
  code === 401
    ? "authentication_error"
    : code === 404
      ? "not_found_error"
      : code === 403
        ? "permission_error"
        : code === 429
          ? "rate_limit_error"
          : code === 503
            ? "overloaded_error"
            : code >= 500
              ? "api_error"
              : "invalid_request_error"

export const anthropic = {
  discovery: ["anthropic-messages"],
  parse: (request) => modelInBody("anthropic-messages", request),
  models: (entries, now) => {
    const created = new Date(now).toISOString()
    const first = entries[0]
    const last = entries[entries.length - 1]
    return {
      data: entries.map((entry) => ({ type: "model", id: entry.id, display_name: entry.name, created_at: created })),
      has_more: false,
      first_id: first?.id ?? null,
      last_id: last?.id ?? null,
    }
  },
  error: (failure: Failure) => {
    const code = status(failure)
    return {
      status: code,
      headers: jsonHeaders(code, retryAfter(failure)),
      body: { type: "error", error: { type: errorType(code), message: message(failure) } },
    }
  },
  rewrite: (body, apiID, _stream) => ({ ...body, model: apiID }),
  url: (baseURL, _apiID, _stream) => `${baseURL}/messages`,
  usage: (json) => {
    const usage = extractRaw(json)
    if (usage === undefined) return undefined
    return normalize(usage)
  },
  parser: () => {
    let usage: MessagesUsage | undefined
    return {
      parse: (event) => {
        let json: unknown
        try {
          json = JSON.parse(event.data)
        } catch {
          return
        }
        const update = extractRaw(json)
        if (update === undefined) return
        usage = {
          ...usage,
          ...update,
          cache_creation: { ...usage?.cache_creation, ...update.cache_creation },
        }
      },
      retrieve: () => (usage === undefined ? undefined : normalize(usage)),
    }
  },
} satisfies Adapter
