import type { Tokens } from "@bymorning/schema/usage"
import { Option, Schema } from "effect"
import type { Adapter } from "../protocol.js"
import { modelInBody } from "./body.js"
import { openAI } from "./openai.js"

const ChatUsage = Schema.Struct({
  prompt_tokens: Schema.optionalKey(Schema.Finite),
  completion_tokens: Schema.optionalKey(Schema.Finite),
  cached_tokens: Schema.optionalKey(Schema.Finite),
  prompt_tokens_details: Schema.optionalKey(
    Schema.Struct({
      cached_tokens: Schema.optionalKey(Schema.Finite),
      cache_creation_input_tokens: Schema.optionalKey(Schema.Finite),
    }),
  ),
  completion_tokens_details: Schema.optionalKey(Schema.Struct({ reasoning_tokens: Schema.optionalKey(Schema.Finite) })),
})
type ChatUsage = typeof ChatUsage.Type

const ChatReply = Schema.Struct({ usage: Schema.optionalKey(ChatUsage) })

/** `completion_tokens` includes reasoning; Tokens categories are disjoint. */
const normalize = (usage: ChatUsage): Tokens => {
  const cacheRead = usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0
  return {
    input: (usage.prompt_tokens ?? 0) - cacheRead,
    output: (usage.completion_tokens ?? 0) - reasoning,
    reasoning,
    cacheRead,
    cacheWrite: usage.prompt_tokens_details?.cache_creation_input_tokens ?? 0,
  }
}

const extract = (json: unknown) => {
  const reply = Option.getOrUndefined(Schema.decodeUnknownOption(ChatReply)(json))
  return reply?.usage === undefined ? undefined : normalize(reply.usage)
}

export const openAIChat = {
  ...openAI,
  parse: (request) => modelInBody("openai-chat", request),
  rewrite: (body, apiID, stream) => ({
    ...body,
    model: apiID,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  }),
  url: (baseURL, _apiID, _stream) => `${baseURL}/chat/completions`,
  usage: extract,
  parser: () => {
    let usage: Tokens | undefined
    return {
      parse: (event) => {
        let json: unknown
        try {
          json = JSON.parse(event.data)
        } catch {
          return
        }
        usage = extract(json) ?? usage
      },
      retrieve: () => usage,
    }
  },
} satisfies Adapter
