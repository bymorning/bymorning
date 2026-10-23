import { LLMGateway } from "@bymorning/schema/llm-gateway"
import { Effect, Schema } from "effect"
import type { HttpServerRequest } from "effect/unstable/http"
import { Headers } from "effect/unstable/http"
import { InputError } from "../failure.js"

/** Decode the JSON object body of one Provider-native request. */
export const body = Effect.fn("LLMGateway.Ingress.body")(function* (request: HttpServerRequest.HttpServerRequest) {
  const json = yield* request.json.pipe(
    Effect.mapError((cause) => new InputError({ reason: "Invalid JSON body", cause })),
  )
  return yield* Schema.decodeUnknownEffect(LLMGateway.Body)(json).pipe(
    Effect.mapError(() => new InputError({ reason: "Invalid JSON body" })),
  )
})

/** Parse a body-addressed request whose `model` and `stream` fields select the destination. */
export const modelInBody = Effect.fn("LLMGateway.Ingress.modelInBody")(function* (
  protocol: LLMGateway.Protocol,
  request: HttpServerRequest.HttpServerRequest,
) {
  const parsed = yield* body(request)
  const model = parsed.model
  if (typeof model !== "string") return yield* new InputError({ reason: "model required" })
  return yield* Schema.decodeUnknownEffect(LLMGateway.Request)({
    protocol,
    model,
    stream: parsed.stream === true,
    body: parsed,
  }).pipe(Effect.mapError(() => new InputError({ reason: "Invalid request" })))
})

/** Native `Content-Type: application/json` reply headers. */
export const jsonHeaders = (status: number, retryAfter?: string): Headers.Headers =>
  Headers.fromInput({
    "content-type": "application/json",
    ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
    ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
  })
