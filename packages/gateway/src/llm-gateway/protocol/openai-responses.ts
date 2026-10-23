import type { Tokens } from "@bymorning/schema/usage"
import { Option, Schema } from "effect"
import type { Adapter } from "../protocol.js"
import { modelInBody } from "./body.js"
import { openAI } from "./openai.js"

const ResponsesUsage = Schema.Struct({
  input_tokens: Schema.optionalKey(Schema.Finite),
  input_tokens_details: Schema.optionalKey(
    Schema.Struct({
      cached_tokens: Schema.optionalKey(Schema.Finite),
      cache_write_tokens: Schema.optionalKey(Schema.Finite),
    }),
  ),
  output_tokens: Schema.optionalKey(Schema.Finite),
  output_tokens_details: Schema.optionalKey(Schema.Struct({ reasoning_tokens: Schema.optionalKey(Schema.Finite) })),
})
type ResponsesUsage = typeof ResponsesUsage.Type

const ResponsesReply = Schema.Struct({
  usage: Schema.optionalKey(ResponsesUsage),
  response: Schema.optionalKey(Schema.Struct({ usage: Schema.optionalKey(ResponsesUsage) })),
})

/** `output_tokens` includes reasoning; Tokens categories are disjoint. */
const normalize = (usage: ResponsesUsage): Tokens => {
  const cacheRead = usage.input_tokens_details?.cached_tokens ?? 0
  const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0
  return {
    input: (usage.input_tokens ?? 0) - cacheRead,
    output: (usage.output_tokens ?? 0) - reasoning,
    reasoning,
    cacheRead,
    cacheWrite: usage.input_tokens_details?.cache_write_tokens ?? 0,
  }
}

const extract = (json: unknown) => {
  const reply = Option.getOrUndefined(Schema.decodeUnknownOption(ResponsesReply)(json))
  const usage = reply?.usage ?? reply?.response?.usage
  return usage === undefined ? undefined : normalize(usage)
}

export const openAIResponses = {
  ...openAI,
  parse: (request) => modelInBody("openai-responses", request),
  rewrite: (body, apiID, _stream) => ({ ...body, model: apiID }),
  url: (baseURL, _apiID, _stream) => `${baseURL}/responses`,
  usage: extract,
  parser: () => {
    let usage: Tokens | undefined
    return {
      parse: (event) => {
        if (event.event !== "response.completed") return
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
