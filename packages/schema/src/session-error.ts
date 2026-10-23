export * as SessionError from "./session-error.js"

import { Schema } from "effect"

export const Aborted = Schema.TaggedStruct("SessionError.AbortedError", { message: Schema.String })
export const Provider = Schema.TaggedStruct("SessionError.ProviderError", {
  message: Schema.String,
  category: Schema.optionalKey(
    Schema.Literals([
      "auth",
      "rate-limit",
      "quota",
      "content-filter",
      "transport",
      "internal",
      "invalid-request",
      "context-overflow",
      "unknown",
    ]),
  ),
  status: Schema.optionalKey(Schema.Number),
  provider: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  requestID: Schema.optionalKey(Schema.String),
  responseBody: Schema.optionalKey(Schema.String),
  bodyTruncated: Schema.optionalKey(Schema.Boolean),
})
export const Tool = Schema.TaggedStruct("SessionError.ToolError", {
  message: Schema.String,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
})
export const Internal = Schema.TaggedStruct("SessionError.InternalError", { message: Schema.String })
export const Error = Schema.Union([Aborted, Provider, Tool, Internal]).pipe(Schema.toTaggedUnion("_tag"))
export type Error = typeof Error.Type
