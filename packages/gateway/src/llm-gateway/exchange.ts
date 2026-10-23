import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import { Tokens } from "@bymorning/schema/usage"
import type { Principal } from "@bymorning/schema/usage"
import type { Workspace } from "@bymorning/schema/workspace"
import { Context, Effect, Layer, Option, Redacted, Schema, type Scope, Stream } from "effect"
import { Sse } from "./sse.js"
import { Headers, HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { ModelResolver } from "@bymorning/core/model-resolver"
import { Usage } from "@bymorning/core/usage"
import type { Reply } from "../llm-gateway.js"
import {
  modelFailure,
  StreamError,
  UnavailableError,
  UpstreamError,
  type DeniedError,
  type InputError,
} from "./failure.js"
import { adapters } from "./protocol.js"
import type { Plugin } from "@bymorning/core/plugin"
import { LLMClient } from "@opencode-ai/ai/route/client"
import { RequestExecutor } from "@opencode-ai/ai/route/executor"
import { Translation } from "./translation/exchange.js"
import { Output } from "./translation/output.js"
import { request } from "@opencode-ai/ai/llm"
import { Message } from "@opencode-ai/ai/schema/messages"

const maximumEventBytes = 16 * 1024 * 1024

/** Provider usage JSON is untrusted; counts outside the Tokens schema are treated as unobserved. */
const isTokens = Schema.is(Tokens)

/** Private Provider exchange input. */
export interface Input {
  readonly request: LLMGateway.Request
  readonly headers: Headers.Headers
  readonly destination: ModelResolver.Native
  readonly workspaceID: Workspace.ID
  /** Caller principal authenticated at the edge; the usage row is attributed to it. */
  readonly principal: Principal
  readonly endpointID: string
  readonly publicModel: string
  readonly requestID: string
  readonly invocation: Plugin.Hooks.Invocation
  /** Edge-supplied settlement of the priced cost. */
  readonly settle: (amount: number) => Effect.Effect<void>
}

/** One Routing judge inference: a short, tool-free, non-streamed completion. */
export interface JudgeInput {
  readonly destination: ModelResolver.Resolved
  readonly system: string
  readonly prompt: string
}

/** Private Provider exchange authority. */
export interface Interface {
  /** Run one Routing judge inference and report its text and observed tokens. */
  readonly judge: (
    input: JudgeInput,
  ) => Effect.Effect<{ readonly text: string; readonly tokens?: Tokens }, UpstreamError>
  readonly translate: (
    input: Translation.Input,
  ) => Effect.Effect<Reply, UpstreamError | InputError | DeniedError | UnavailableError, Usage.Service | Scope.Scope>
  readonly invoke: (
    input: Input,
  ) => Effect.Effect<Reply, UpstreamError | DeniedError | UnavailableError, Usage.Service | Scope.Scope>
}

/** Private Provider exchange authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/gateway/LLMGateway/Exchange") {}

/** Provider exchange implementation over the selected HTTP adapter. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const translate = yield* Translation.make
    const client = yield* LLMClient.Service
    return Service.of({
      judge: Effect.fn("LLMGateway.Exchange.judge")(function* (input) {
        let text = ""
        let usage: Parameters<typeof Output.tokens>[0]
        yield* client
          .stream(
            request({
              model: input.destination.runtimeModel,
              system: input.system,
              messages: [Message.user(input.prompt)],
              toolChoice: "none",
            }),
            { http: (outgoing, handler) => input.destination.authentication(outgoing, handler) },
          )
          .pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "text-delta") text += event.text
                if ((event.type === "step-finish" || event.type === "finish") && event.usage !== undefined)
                  usage = event.usage
              }),
            ),
            // Keep the real error for fallback logs, as invoke does; typed AI errors carry the
            // upstream status and response text, never the injected destination credentials.
            Effect.mapError((cause) => new UpstreamError({ phase: "read", cause })),
          )
        const tokens = Output.tokens(usage)
        return tokens === undefined ? { text } : { text, tokens }
      }),
      translate,
      invoke: Effect.fn("LLMGateway.Exchange.invoke")(function* (input) {
        const usage = yield* Usage.Service
        const runtime = yield* Effect.context<Usage.Service>()
        const adapter = adapters[input.request.protocol]
        const url = adapter.url(
          input.destination.baseURL.toString().replace(/\/$/, ""),
          input.destination.model.apiID,
          input.request.stream,
        )
        let headers = Headers.removeMany(input.headers, [
          "host",
          "content-length",
          "authorization",
          "proxy-authorization",
          "x-api-key",
          "x-goog-api-key",
          "cookie",
        ])
        for (const [name, value] of Object.entries(Redacted.value(input.destination.headers)))
          headers = Headers.set(headers, name, value)
        if (input.request.protocol === "anthropic-messages" && headers["anthropic-version"] === undefined)
          headers = Headers.set(headers, "anthropic-version", "2023-06-01")
        const request = yield* HttpClientRequest.bodyJson(
          HttpClientRequest.setHeaders(HttpClientRequest.post(url), headers),
          adapter.rewrite(
            { ...input.destination.defaults, ...input.request.body },
            input.destination.model.apiID,
            input.request.stream,
          ),
        ).pipe(Effect.mapError((cause) => new UpstreamError({ phase: "connect", cause })))
        const upstream = yield* http
          .execute(request)
          .pipe(Effect.mapError((cause) => new UpstreamError({ phase: "connect", cause })))
        const requestID = input.requestID
        const credentials = Object.values(Redacted.value(input.destination.headers))
        const status = upstream.status
        const replyHeaders = responseHeaders(
          upstream.headers,
          input.endpointID,
          input.destination.model.apiID,
          requestID,
        )
        if (status < 200 || status >= 300) {
          // Reflected Provider error bodies are untrusted caller text and must
          // not disclose the injected destination credentials.
          const text = yield* upstream.text.pipe(
            Effect.mapError((cause) => new UpstreamError({ phase: "read", cause })),
          )
          return {
            status,
            headers: replyHeaders,
            body: Stream.make(new TextEncoder().encode(redact(text, credentials))),
          }
        }

        let recorded = false
        const record = Effect.fn("LLMGateway.Exchange.record")(function* (observed: Tokens | undefined) {
          if (recorded) return
          recorded = true
          const tokens = observed !== undefined && isTokens(observed) ? observed : undefined
          if (tokens === undefined) return
          const { cost } = yield* usage
            .record({
              requestID,
              model: input.publicModel,
              endpointID: input.endpointID,
              upstreamModel: input.destination.model.apiID,
              selection: input.destination.model,
              tokens,
              occurredAt: new Date(yield* Effect.sync(Date.now)),
              principal: input.principal,
            })
            .pipe(Effect.mapError(() => new UnavailableError({ reason: "Usage persistence unavailable" })))
          yield* input.settle(cost)
          yield* input.invocation.usage(Object.freeze({ ...tokens })).pipe(Effect.mapError(modelFailure))
        })

        if (!input.request.stream) {
          const text = yield* upstream.text.pipe(
            Effect.mapError((cause) => new UpstreamError({ phase: "read", cause })),
          )
          const json = Option.getOrUndefined(Option.liftThrowable((value: string): unknown => JSON.parse(value))(text))
          yield* record(json === undefined ? undefined : adapter.usage(json))
          return {
            status,
            headers: replyHeaders,
            body: Stream.make(new TextEncoder().encode(redact(text, credentials))),
          }
        }

        const adapterUsage = adapter.parser()
        const parser = Sse.makeParser((event) => {
          if (event._tag === "Event") adapterUsage.parse(event)
        })
        const decoder = new TextDecoder()
        const encoder = new TextEncoder()
        let buffer = ""
        const forwarded = upstream.stream.pipe(
          Stream.tap((bytes) =>
            Effect.suspend(() => {
              const text = decoder.decode(bytes, { stream: true })
              buffer += text
              const parts = buffer.split(/\r\n\r\n|\n\n|\r\r/)
              buffer = parts.pop() ?? ""
              // Sse.makeParser buffers decoded UTF-16 code units. Bound that buffer as
              // well as the original byte contract; the code-unit check is conservative
              // for UTF-8 and prevents an unbounded parser buffer for ASCII input.
              if (encoder.encode(buffer).byteLength > maximumEventBytes || buffer.length > maximumEventBytes)
                return Effect.fail(new StreamError({ cause: new Error("Provider SSE event exceeded the size limit") }))
              parser.feed(text)
              return Effect.void
            }),
          ),
          Stream.mapError((cause) => (cause instanceof StreamError ? cause : new StreamError({ cause }))),
        )
        const completion = Effect.gen(function* () {
          const tail = decoder.decode()
          buffer += tail
          parser.feed(tail)
          if (encoder.encode(buffer).byteLength > maximumEventBytes || buffer.length > maximumEventBytes)
            return yield* new StreamError({ cause: new Error("Provider SSE event exceeded the size limit") })
          // Complete a final unterminated event for usage observation without changing forwarded bytes.
          if (buffer.length > 0) parser.feed("\n\n")
          yield* record(adapterUsage.retrieve())
        })
        return {
          status,
          headers: replyHeaders,
          body: forwarded.pipe(
            Stream.concat(
              Stream.fromEffect(completion).pipe(
                Stream.drain,
                Stream.mapError((cause) => (cause instanceof StreamError ? cause : new StreamError({ cause }))),
              ),
            ),
            Stream.provideContext(runtime),
          ),
        }
      }),
    })
  }),
).pipe(Layer.provide(Layer.fresh(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer)))))

const responseHeaders = (upstream: Headers.Headers, endpointID: string, model: string, requestID: string) => {
  let headers = Headers.empty
  for (const name of ["content-type", "cache-control"]) {
    const value = upstream[name]
    if (value !== undefined) headers = Headers.set(headers, name, value)
  }
  return Headers.fromInput({
    ...headers,
    "x-bymorning-endpoint-id": endpointID,
    "x-bymorning-upstream-model-id": model,
    "x-bymorning-request-id": requestID,
  })
}

export * as Exchange from "./exchange.js"

/**
 * Replace injected destination credential values inside reflected Provider
 * text. Victim bytes stay truthful in Provider format; only our secrets are
 * removed. Streaming bodies cannot be redacted without breaking the tested
 * byte-forwarding contract, so callers see Provider bytes live.
 */
const redact = (text: string, credentials: ReadonlyArray<string>): string => {
  let redacted = text
  for (const credential of credentials)
    if (credential.length > 0 && redacted.includes(credential)) redacted = redacted.replaceAll(credential, "[redacted]")
  return redacted
}
