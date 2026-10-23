import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import type { Tokens } from "@bymorning/schema/usage"
import { Effect, Schema } from "effect"
import type { GatewayRequest } from "@bymorning/plugin/gateway-hooks"
import type { Sse } from "./sse.js"
import { HttpServerRequest, type Headers } from "effect/unstable/http"
import { UnavailableError } from "./failure.js"
import type { Failure, InputError } from "./failure.js"
import { anthropic } from "./protocol/anthropic.js"
import { google } from "./protocol/google.js"
import { openAIChat } from "./protocol/openai-chat.js"
import { openAIResponses } from "./protocol/openai-responses.js"

/** One rendered Provider-native JSON reply. */
export interface Rendered {
  readonly status: number
  readonly headers: Headers.Headers
  readonly body: LLMGateway.Body
}

/** Private adapter owning both directions of one Provider-native inference format. */
export interface Adapter {
  /** Protocols whose public Models this format's discovery envelope lists. */
  readonly discovery: ReadonlyArray<LLMGateway.Protocol>
  /** Parse one native invocation request. */
  readonly parse: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<LLMGateway.Request, InputError>
  /** Render the native Model discovery envelope. */
  readonly models: (entries: ReadonlyArray<LLMGateway.Entry>, now: number) => LLMGateway.Body
  /** Render one typed failure in the native error envelope. */
  readonly error: (failure: Failure) => Rendered
  readonly rewrite: (body: LLMGateway.Body, apiID: string, stream: boolean) => LLMGateway.Body
  readonly url: (baseURL: string, apiID: string, stream: boolean) => string
  readonly usage: (json: unknown) => Tokens | undefined
  readonly parser: () => {
    /** Observe one parsed SSE event without changing the forwarded byte stream. */
    readonly parse: (event: Pick<Sse.Event, "event" | "data">) => void
    readonly retrieve: () => Tokens | undefined
  }
}

/** Provider-native adapters keyed by ingress format. */
export const adapters = {
  "openai-chat": openAIChat,
  "openai-responses": openAIResponses,
  "anthropic-messages": anthropic,
  "google-generate": google,
} satisfies Record<LLMGateway.Protocol, Adapter>

const Draft = Schema.Struct({
  protocol: Schema.Literals(["openai-chat", "openai-responses", "anthropic-messages", "google-generate"]),
  requestedModel: Schema.String,
  stream: Schema.Boolean,
  model: Schema.NonEmptyString,
  body: Schema.Record(Schema.String, Schema.Unknown),
})

/** Reparse Plugin output through the owning native adapter before resolving its destination. */
export const reparse = Effect.fn("LLMGateway.reparse")(
  function* (original: LLMGateway.Request, draft: GatewayRequest) {
    const parsed = yield* Schema.decodeUnknownEffect(Draft)(draft)
    if (
      parsed.protocol !== original.protocol ||
      parsed.stream !== original.stream ||
      parsed.requestedModel !== original.model
    )
      return yield* new UnavailableError({ reason: "Inference Plugin changed immutable request facts" })
    const adapter = adapters[original.protocol]
    const body = original.protocol === "google-generate" ? parsed.body : { ...parsed.body, model: parsed.model }
    if (body.stream !== undefined && typeof body.stream !== "boolean")
      return yield* new UnavailableError({ reason: "Inference Plugin produced invalid stream selection" })
    const request = yield* Effect.try(() =>
      HttpServerRequest.fromWeb(
        new Request(adapter.url("http://localhost", encodeURIComponent(parsed.model), original.stream), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    )
    const result = yield* adapter.parse(request)
    if (
      result.stream !== original.stream ||
      (original.protocol === "google-generate" && body.stream !== undefined && body.stream !== original.stream)
    )
      return yield* new UnavailableError({ reason: "Inference Plugin changed stream selection" })
    return result
  },
  Effect.mapError(() => new UnavailableError({ reason: "Inference Plugin produced an invalid native request" })),
)
