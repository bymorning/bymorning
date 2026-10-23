export * as LLMGateway from "./llm-gateway.js"

import { Schema } from "effect"

/** Provider-native request format accepted by LLM Gateway. */
export const Protocol = Schema.Literals(["openai-chat", "openai-responses", "anthropic-messages", "google-generate"])
/** Provider-native request format accepted by LLM Gateway. */
export type Protocol = typeof Protocol.Type

/** Provider-native JSON body retained without format translation. */
export const Body = Schema.Record(Schema.String, Schema.Unknown)
/** Provider-native JSON body retained without format translation. */
export type Body = typeof Body.Type

/** Parsed Provider-native invocation request. */
export const Request = Schema.Struct({
  protocol: Protocol,
  model: Schema.String,
  stream: Schema.Boolean,
  action: Schema.optionalKey(Schema.Literals(["generateContent", "streamGenerateContent"])),
  body: Body,
})
/** Parsed Provider-native invocation request. */
export interface Request extends Schema.Schema.Type<typeof Request> {}

/** Public Model exposed by LLM Gateway. */
export const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})
/** Public Model exposed by LLM Gateway. */
export interface Entry extends Schema.Schema.Type<typeof Entry> {}
