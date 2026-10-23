import { LLMGateway } from "@bymorning/schema/llm-gateway"
import type { Tokens } from "@bymorning/schema/usage"
import { Effect, Option, Schema } from "effect"
import type { HttpServerRequest } from "effect/unstable/http"
import { type Failure, InputError, message, retryAfter, status } from "../failure.js"
import type { Adapter } from "../protocol.js"
import { body, jsonHeaders } from "./body.js"

const GenerateUsage = Schema.Struct({
  promptTokenCount: Schema.optionalKey(Schema.Finite),
  candidatesTokenCount: Schema.optionalKey(Schema.Finite),
  cachedContentTokenCount: Schema.optionalKey(Schema.Finite),
  thoughtsTokenCount: Schema.optionalKey(Schema.Finite),
})
type GenerateUsage = typeof GenerateUsage.Type

const GenerateReply = Schema.Struct({ usageMetadata: Schema.optionalKey(GenerateUsage) })

/** `candidatesTokenCount` excludes thoughts; Tokens categories are disjoint. */
const normalize = (usage: GenerateUsage): Tokens => {
  const reasoning = usage.thoughtsTokenCount ?? 0
  const cacheRead = usage.cachedContentTokenCount ?? 0
  return {
    input: (usage.promptTokenCount ?? 0) - cacheRead,
    output: usage.candidatesTokenCount ?? 0,
    reasoning,
    cacheRead,
    cacheWrite: 0,
  }
}

const extract = (json: unknown) => {
  const reply = Option.getOrUndefined(Schema.decodeUnknownOption(GenerateReply)(json))
  return reply?.usageMetadata === undefined ? undefined : normalize(reply.usageMetadata)
}

/** Google addresses the Model and action in the path: `models/{model}:{generateContent|streamGenerateContent}`. */
const action = /\/models\/([^/]+):(streamGenerateContent|generateContent)$/

const parse = Effect.fn("LLMGateway.Google.parse")(function* (request: HttpServerRequest.HttpServerRequest) {
  const match = new URL(request.url, "http://localhost").pathname.match(action)
  if (match === null || match[1] === undefined || match[2] === undefined)
    return yield* new InputError({ reason: "Invalid Google model action" })
  const encoded = match[1]
  const model = yield* Effect.try({
    try: () => decodeURIComponent(encoded),
    catch: () => new InputError({ reason: "Invalid Google model action" }),
  })
  const parsed = yield* body(request)
  return yield* Schema.decodeUnknownEffect(LLMGateway.Request)({
    protocol: "google-generate",
    model,
    stream: match[2] === "streamGenerateContent",
    action: match[2],
    body: parsed,
  }).pipe(Effect.mapError(() => new InputError({ reason: "Invalid request" })))
})

const nativeStatus = (code: number) =>
  code === 401
    ? "UNAUTHENTICATED"
    : code === 404
      ? "NOT_FOUND"
      : code === 403
        ? "PERMISSION_DENIED"
        : code === 429
          ? "RESOURCE_EXHAUSTED"
          : code === 503
            ? "UNAVAILABLE"
            : code >= 500
              ? "INTERNAL"
              : "INVALID_ARGUMENT"

export const google = {
  discovery: ["google-generate"],
  parse,
  models: (entries, _now) => ({
    models: entries.map((entry) => ({ name: `models/${entry.id}`, displayName: entry.name })),
  }),
  error: (failure: Failure) => {
    const code = status(failure)
    return {
      status: code,
      headers: jsonHeaders(code, retryAfter(failure)),
      body: { error: { code, message: message(failure), status: nativeStatus(code) } },
    }
  },
  rewrite: (body, _apiID, _stream) => body,
  url: (baseURL, apiID, stream) =>
    `${baseURL}/models/${apiID}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
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
