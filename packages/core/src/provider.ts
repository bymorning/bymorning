export * as Provider from "./provider.js"

import { Provider } from "@bymorning/schema/provider"
import type { Agent } from "@bymorning/schema/agent"
import type { ID as MessageID } from "@bymorning/schema/message"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import type { Session } from "@bymorning/schema/session"
import type { ModelRequestPurpose } from "@bymorning/plugin/session-hooks"
import { isContextOverflowFailure } from "@opencode-ai/ai"
import type { Message } from "@opencode-ai/ai/schema/messages"
import type { RequestInput } from "@opencode-ai/ai/llm"
import { request } from "@opencode-ai/ai/llm"
import { LLMClient } from "@opencode-ai/ai/route/client"
import type { Service as LLMClientService } from "@opencode-ai/ai/route/client"
import { RequestExecutor } from "@opencode-ai/ai/route/executor"
import type { HttpHandler, HttpMiddleware } from "@opencode-ai/ai/route/executor"
import { LanguageModel } from "@opencode-ai/ai/schema/options"
import type { LLMEvent } from "@opencode-ai/ai/schema/events"
import { AIError } from "@opencode-ai/ai/schema/errors"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import type { HttpClientRequest } from "effect/unstable/http"
import type { Model } from "./model.js"
import { Integration } from "./integration.js"
import { nativeRegistry, registry } from "./provider/registry.js"
import { sourceProviders } from "./provider/source.js"
import { Diagnostics } from "./provider/diagnostics.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

/** A Provider does not exist in the code registry. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Provider.NotFoundError", {
  provider: Provider.Name,
}) {}

/** A physical Provider request or stream failed. */
export class FailureError extends Schema.TaggedError<FailureError>()("Provider.FailureError", {
  cause: Schema.Defect(),
  message: Schema.optionalKey(Schema.String),
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
}) {}

/** A Provider rejected the request because its context window was exceeded. */
export class ContextOverflowError extends Schema.TaggedError<ContextOverflowError>()("Provider.ContextOverflowError", {
  cause: Schema.Defect(),
}) {}

export interface RequestContext {
  readonly purpose: ModelRequestPurpose
  readonly sessionID: Session.ID
  readonly messageID?: MessageID
  readonly agent: Agent.ID
  readonly requestedModel: ModelSchema.Ref
  readonly model: ModelSchema.Ref
}

export interface StreamInput {
  readonly context: RequestContext
  readonly selection: Model.Selection
  readonly runtimeModel: LanguageModel
  readonly authentication: HttpMiddleware
  readonly messages: ReadonlyArray<Message>
  readonly system?: RequestInput["system"]
  readonly tools?: RequestInput["tools"]
  readonly toolChoice?: RequestInput["toolChoice"]
  readonly providerOptions?: RequestInput["providerOptions"]
  readonly http: HttpMiddleware
}

/** Code-backed Provider discovery and physical inference. */
export interface Interface {
  readonly get: (provider: Provider.Name) => Effect.Effect<Provider.Info, NotFoundError>
  readonly list: Effect.Effect<ReadonlyArray<Provider.Info>>
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, FailureError | ContextOverflowError>
}

/** Code-backed Provider discovery and physical inference. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Provider") {}

/** Register bundled Provider authentication methods with the current Integration authority. */
export const integrationLayer = Layer.effectDiscard(
  Integration.Service.use((service) => service.transform((editor) => {
    for (const definition of [...registry, ...nativeRegistry]) {
      const integrationID = Integration.ID.make(definition.info.name)
      editor.update(
        integrationID,
        (integration) => (integration.name = definition.info.displayName ?? definition.info.name),
      )
      for (const method of definition.integration.methods) {
        if (method.type === "key")
          editor.method.update({ integrationID, method: Integration.KeyMethod.make(method) })
        else if (method.type === "env")
          editor.method.update({
            integrationID,
            method: Integration.EnvMethod.make({ type: "env", names: [...method.names] }),
          })
        else if (method.type === "aws-sigv4") editor.method.update({ integrationID, method })
        else if (method.type === "command") editor.method.update({ integrationID, method })
        else if (method.type === "env-group") editor.method.update({ integrationID, method })
        else throw new Error("Bundled Provider integrations cannot register OAuth methods")
      }
    }
  })),
)

const serviceLayer = Layer.effect<Service, Interface, never, LLMClientService>(
  Service,
  Effect.gen(function* () {
    const client = yield* LLMClient.Service
    const bundled = [...registry, ...nativeRegistry].map((definition): Provider.Info => ({
      ...definition.info,
      execution: Schema.decodeUnknownSync(Provider.Execution)({
        package: definition.package,
        settings: Object.fromEntries(Object.entries(definition.settings).filter(([key]) => key !== "baseURL")),
        authentication: {
          type: "key",
          integration: definition.info.name,
          header: definition.authentication === "bearer" ? "authorization" : definition.authentication === "google-api-key" ? "x-goog-api-key" : "x-api-key",
          ...(definition.authentication === "bearer" ? { prefix: "Bearer " } : {}),
        },
      }),
    }))
    const infos = [...bundled, ...sourceProviders.filter((provider) => !bundled.some((entry) => entry.name === provider.name))]
    const get = Effect.fn("Provider.get")(function* (provider: Provider.Name) {
      const info = infos.find((candidate) => candidate.name === provider)
      if (!info) return yield* new NotFoundError({ provider })
      return info
    })
    const list = Effect.succeed(infos).pipe(Effect.withSpan("Provider.list"))
    const stream = (input: StreamInput) => Stream.suspend(() => {
      const diagnostics = Diagnostics.make()
      const runtimeModel = openAIChatCompatibility(input.runtimeModel)
      return Stream.unwrap(
        Effect.try({
          try: () => {
            const http = (request: HttpClientRequest.HttpClientRequest, handler: HttpHandler) =>
              input.http(request, (hooked) => input.authentication(hooked, (authenticated) => {
                diagnostics.capture(authenticated)
                return handler(authenticated)
              }))
            return client.stream(
              request({
                model: runtimeModel,
                messages: input.messages,
                ...(input.system === undefined ? {} : { system: input.system }),
                ...(input.tools === undefined ? {} : { tools: input.tools }),
                ...(input.toolChoice === undefined ? {} : { toolChoice: input.toolChoice }),
                ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
              }),
              { http },
            )
          },
          catch: () =>
            new FailureError({
              cause: "Provider request could not be constructed",
              message: "Provider request could not be constructed",
              category: "invalid-request",
              provider: input.selection.info.provider,
              model: input.selection.info.apiID,
            }),
        }),
      ).pipe(
        Stream.map((event): LLMEvent => normalizeFinish(event, runtimeModel)),
        Stream.mapEffect((event) => {
          if (event.type !== "provider-error") return Effect.succeed(event)
          const failure = { ...event, message: diagnostics.text(event.message) }
          const error = isContextOverflowFailure(failure)
            ? new ContextOverflowError({ cause: failure })
            : providerFailure(failure, input)
          return Effect.fail(error)
        }),
        Stream.mapError((cause) => {
          if (cause instanceof FailureError || cause instanceof ContextOverflowError) return cause
          const failure = cause instanceof AIError ? diagnostics.error(cause) : cause
          return isContextOverflowFailure(failure) ? new ContextOverflowError({ cause: failure }) : providerFailure(
            failure, input, cause instanceof AIError && diagnostics.truncated(cause),
          )
        }),
        Stream.tapError((cause) =>
          Effect.logError("Provider execution failed").pipe(
            Effect.annotateLogs(
              cause instanceof FailureError
                ? {
                    provider: cause.provider,
                    model: cause.model,
                    error: cause.category,
                    ...(cause.message === undefined ? {} : { message: cause.message }),
                    ...(cause.status === undefined ? {} : { status: cause.status }),
                    ...(cause.requestID === undefined ? {} : { requestID: cause.requestID }),
                  }
                : { provider: input.selection.info.provider, model: input.selection.info.apiID, error: "Unknown" },
            ),
          ),
        ),
      )
    })
    return Service.of({ get, list, stream })
  }),
)

const routedLayer = Layer.provide<LLMClientService, never, Service, RequestExecutor.Service, never, LLMClientService>(
  serviceLayer,
  LLMClient.layer,
)
const productionLayer = Layer.provide<RequestExecutor.Service, never, Service, never, never, RequestExecutor.Service>(
  routedLayer,
  RequestExecutor.fetchLayer,
)

/** Build Provider inference with an explicit client for request-parity tests. */
export const layerWith = (client: import("@opencode-ai/ai").LLMClientShape): Layer.Layer<Service, never, never> =>
  serviceLayer.pipe(Layer.provide(Layer.succeed(LLMClient.Service, LLMClient.Service.of(client))))

/** Build Provider inference with an explicit physical request executor. */
export const layerWithExecutor = (executor: RequestExecutor.Interface): Layer.Layer<Service, never, never> =>
  Layer.provide<RequestExecutor.Service, never, Service, never, never, RequestExecutor.Service>(
    routedLayer,
    Layer.succeed(RequestExecutor.Service, RequestExecutor.Service.of(executor)),
  )

/** Production Provider Layer. */
export const layer = ((value: Layer.Layer<Service, never, never>) => value)(productionLayer)

export const defaultLayer = layer

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

const categories = {
  Authentication: "auth",
  RateLimit: "rate-limit",
  QuotaExceeded: "quota",
  ContentPolicy: "content-filter",
  Transport: "transport",
  ProviderInternal: "internal",
  InvalidRequest: "invalid-request",
  InvalidProviderOutput: "unknown",
  NoRoute: "unknown",
  UnknownProvider: "unknown",
  UnsupportedOperation: "invalid-request",
} as const satisfies Record<AIError["reason"]["_tag"], typeof FailureError.fields.category.Type>

const ProviderErrorBody = Schema.fromJsonString(
  Schema.Struct({
    message: Schema.optionalKey(Schema.String),
    error: Schema.optionalKey(
      Schema.Union([Schema.String, Schema.Struct({ message: Schema.optionalKey(Schema.String) })]),
    ),
  }),
)

function providerFailure(cause: unknown, input: StreamInput, bodyTruncated = false) {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "type" in cause &&
    cause.type === "provider-error" &&
    "message" in cause &&
    typeof cause.message === "string"
  )
    return new FailureError({
      cause,
      message: cause.message,
      category:
        "classification" in cause && cause.classification === "payload-too-large" ? "invalid-request" : "unknown",
      provider: input.selection.info.provider,
      model: input.selection.info.apiID,
    })

  if (!(cause instanceof AIError))
    return new FailureError({
      cause,
      message: cause instanceof Error ? cause.message : String(cause),
      category: "unknown",
      provider: input.selection.info.provider,
      model: input.selection.info.apiID,
    })

  const http = cause.reason.http
  const body = cause.reason.body
  const decoded =
    body === undefined ? undefined : Option.getOrUndefined(Schema.decodeUnknownOption(ProviderErrorBody)(body))
  const extracted = typeof decoded?.error === "string" ? decoded.error : (decoded?.error?.message ?? decoded?.message)
  // Keep a local cap on persisted provider diagnostics.
  const responseBody = body === undefined ? undefined : body.slice(0, 16_384)
  const requestID = http === undefined ? undefined :
    http.headers["x-request-id"] ?? http.headers["request-id"] ?? http.headers["x-amzn-requestid"] ??
    http.headers["x-amz-request-id"] ?? http.headers["x-goog-request-id"] ?? http.headers["cf-ray"]
  return new FailureError({
    cause,
    message: extracted ?? cause.reason.message,
    category: categories[cause.reason._tag],
    provider: input.selection.info.provider,
    model: input.selection.info.apiID,
    ...(http === undefined ? {} : { status: http.status }),
    ...(requestID === undefined ? {} : { requestID }),
    ...(responseBody === undefined ? {} : { responseBody }),
    ...(bodyTruncated || (body !== undefined && body.length > 16_384) ? { bodyTruncated: true } : {}),
  })
}

/**
 * OpenAI Chat omits a finish reason on a truncated SSE response. The beta
 * mapper supplies its default `stop` in that case; retain the prior unknown
 * result, but only for that public route protocol and only when no raw reason
 * was supplied by the provider.
 */
function normalizeFinish(
  event: LLMEvent,
  model: LanguageModel,
): LLMEvent {
  if (model.route.protocol === "openai-chat" &&
    (event.type === "step-finish" || event.type === "finish") &&
    event.reason.normalized === "stop" &&
    event.reason.raw === undefined) {
    return { ...event, reason: { ...event.reason, normalized: "unknown" } }
  }
  return event
}

/** OpenAI Chat can legitimately close an SSE stream without a finish reason. */
function openAIChatCompatibility(model: LanguageModel) {
  if (model.route.protocol !== "openai-chat" || model.compatibility?.requireFinishReason === false) return model
  return LanguageModel.update(model, {
    compatibility: { ...model.compatibility, requireFinishReason: false },
  })
}
