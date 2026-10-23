export * as Translation from "./exchange.js"

import { request } from "@opencode-ai/ai/llm"
import { LLMClient } from "@opencode-ai/ai/route/client"
import { AIError } from "@opencode-ai/ai/schema/errors"
import { Clock, Effect, Schema, Sink, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import type { ModelResolver } from "@bymorning/core/model-resolver"
import { Usage } from "@bymorning/core/usage"
import type { Reply } from "../../llm-gateway.js"
import type { Input as ExchangeInput } from "../exchange.js"
import { InputError, modelFailure, StreamError, UnavailableError, UpstreamError } from "../failure.js"
import { adapters } from "../protocol.js"
import type { Input as Canonical } from "./input.js"
import { Output } from "./output.js"

export interface Input extends Omit<ExchangeInput, "destination"> {
  readonly destination: ModelResolver.Resolved
  readonly canonical: Canonical
}

const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))
const bytes = (value: unknown) =>
  encode(value).pipe(
    Effect.map((text) => new TextEncoder().encode(text)),
    Effect.mapError(() => new UpstreamError({ phase: "read", cause: "Reply encoding failed" })),
  )

export const make = Effect.gen(function* () {
  const client = yield* LLMClient.Service
  return Effect.fn("LLMGateway.Translation.invoke")(function* (input: Input) {
    const usage = yield* Usage.Service
    const runtime = yield* Effect.context<Usage.Service>()
    const requestID = input.requestID
    const created = Math.floor((yield* Clock.currentTimeMillis) / 1000)
    const projection = Output.make(input.request.protocol, input.publicModel, requestID, created)
    const headers = Headers.fromInput({
      "content-type": input.request.stream ? "text/event-stream" : "application/json",
      "cache-control": "no-store",
      "x-bymorning-request-id": requestID,
      "x-bymorning-endpoint-id": input.endpointID,
      "x-bymorning-upstream-model-id": input.destination.selection.info.apiID,
    })
    const canonical = yield* Effect.try({
      try: () => request({ ...input.canonical, model: input.destination.runtimeModel }),
      catch: () => new InputError({ reason: "Request cannot be represented by the selected provider" }),
    })
    if (
      canonical.model.route.protocol === "openai-responses" &&
      (canonical.generation?.topK !== undefined || canonical.generation?.stop?.length)
    )
      return yield* new InputError({
        reason: "The selected Responses transport cannot represent topK or stop sequences",
      })
    // Validate lowering before opening a connection or committing a caller response.
    yield* canonical.model.route.body
      .from(canonical)
      .pipe(Effect.mapError(() => new InputError({ reason: "Request cannot be represented by the selected provider" })))
    let status: number | undefined
    let retry: string | undefined
    const upstream = client
      .stream(canonical, {
        http: (request, handler) =>
          input.destination.authentication(request, (authenticated) =>
            handler(authenticated).pipe(
              Effect.tap((response) =>
                Effect.sync(() => {
                  status = response.status
                  const value = response.headers["retry-after"]
                  if (value && /^\d{1,8}$/.test(value)) retry = value
                }),
              ),
            ),
          ),
      })
      .pipe(
        Stream.mapEffect((event) => {
          if (
            event.type === "provider-error" ||
            event.type === "tool-input-error" ||
            (event.type === "finish" && event.reason.normalized === "error")
          )
            return Effect.fail(new StreamError({ cause: "Provider stream failed" }))
          return Effect.succeed(event)
        }),
      )
    let recorded = false
    const record = Effect.fn("LLMGateway.Translation.record")(function* () {
      if (recorded) return
      recorded = true
      const observed = projection.usage()
      if (!observed) return
      const { cost } = yield* usage
        .record({
          requestID,
          model: input.publicModel,
          endpointID: input.endpointID,
          upstreamModel: input.destination.selection.info.apiID,
          selection: input.destination.selection.info,
          tokens: observed,
          occurredAt: new Date(yield* Clock.currentTimeMillis),
          principal: input.principal,
        })
        .pipe(Effect.mapError(() => new UnavailableError({ reason: "Usage persistence unavailable" })))
      yield* input.settle(cost)
      yield* input.invocation.usage(Object.freeze({ ...observed })).pipe(Effect.mapError(modelFailure))
    })
    const safe = (cause: unknown) =>
      cause instanceof AIError && cause.reason._tag === "InvalidRequest" && status === undefined
        ? new InputError({ reason: "Request cannot be represented by the selected provider" })
        : new UpstreamError({ phase: status === undefined ? "connect" : "read", cause: "Provider exchange failed" })
    const failure = (error: UpstreamError | InputError): Effect.Effect<Reply, UpstreamError | InputError> => {
      if (status === undefined || status < 400 || status > 599) return Effect.fail(error)
      const upstreamStatus = status
      const rendered = adapters[input.request.protocol].error(error)
      return bytes(rendered.body).pipe(
        Effect.map((body) => ({
          status: upstreamStatus,
          headers: Headers.fromInput({
            ...headers,
            "content-type": "application/json",
            ...(retry ? { "retry-after": retry } : {}),
          }),
          body: Stream.make(body),
        })),
      )
    }
    const consume = upstream.pipe(
      Stream.mapEffect(projection.push),
      Stream.flatMap(Stream.fromIterable),
      Stream.concat(
        Stream.fromEffect(
          Effect.suspend(() =>
            projection.complete()
              ? Effect.void
              : Effect.fail(new StreamError({ cause: "Provider stream ended before completion" })),
          ),
        ).pipe(Stream.drain),
      ),
    )
    if (!input.request.stream)
      return yield* Effect.gen(function* () {
        yield* Stream.runDrain(consume).pipe(Effect.mapError(safe))
        yield* record()
        return { status: 200, headers, body: Stream.make(yield* bytes(projection.value())) }
      }).pipe(Effect.catchIf((error) => error instanceof UpstreamError || error instanceof InputError, failure))

    // Peeling opens the physical exchange and exposes HTTP failures before caller headers commit.
    return yield* Effect.gen(function* () {
      const [head, tail] = yield* Stream.peel(consume, Sink.take<Uint8Array>(1)).pipe(Effect.mapError(safe))
      const body = Stream.fromIterable(head).pipe(
        Stream.concat(tail),
        Stream.concat(Stream.fromEffect(record()).pipe(Stream.drain)),
        Stream.catch(() =>
          Stream.fromEffect(bytes(projection.failure())).pipe(
            Stream.map((body) =>
              new TextEncoder().encode(
                `${input.request.protocol === "openai-responses" ? "event: response.failed\n" : input.request.protocol === "anthropic-messages" ? "event: error\n" : ""}data: ${new TextDecoder().decode(body)}\n\n`,
              ),
            ),
            Stream.mapError(() => new StreamError({ cause: "Stream failure could not be encoded" })),
          ),
        ),
        Stream.provideContext(runtime),
      )
      return { status: 200, headers, body }
    }).pipe(Effect.catch(failure))
  })
})
