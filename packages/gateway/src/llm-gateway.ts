export * as LLMGateway from "./llm-gateway.js"
export * as Lease from "./llm-gateway/lease.js"
export { StreamError, UnavailableError } from "./llm-gateway/failure.js"

import type { Provider as ProviderSchema } from "@bymorning/schema/provider"
import type { Model as ModelSchema } from "@bymorning/schema/model"
import type { Principal } from "@bymorning/schema/usage"
import { Message } from "@opencode-ai/ai/schema/messages"
import type { Workspace } from "@bymorning/schema/workspace"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { Context, Crypto, Effect, Exit, Layer, Option, Scope, Stream } from "effect"
import { Headers, HttpClient, HttpServerRequest } from "effect/unstable/http"
import { Plugin } from "@bymorning/core/plugin"
import { ModelResolver } from "@bymorning/core/model-resolver"
import { KV } from "@bymorning/core/kv"
import { Routing } from "@bymorning/core/routing"
import { Catalog } from "./llm-gateway/catalog.js"
import { Exchange } from "./llm-gateway/exchange.js"
import { modelFailure, type Failure, NotFoundError, type StreamError, UnavailableError } from "./llm-gateway/failure.js"
import { Lease } from "./llm-gateway/lease.js"
import { adapters, reparse, type Rendered } from "./llm-gateway/protocol.js"
import { Translation } from "./llm-gateway/translation/input.js"
import * as Route from "./llm-gateway/route.js"

import { Protocol, type Entry } from "@bymorning/schema/llm-gateway"
import type { Capabilities } from "./llm-gateway/lease.js"
/** Provider-native request format accepted by LLM Gateway. */
export { Protocol, type Entry }
/** Workspace-bound authorities one retained lease supplies. */
export type { Capabilities }

export interface ListInput {
  readonly protocol: Protocol
  readonly workspaceID: Workspace.ID
}

export interface InvokeInput extends ListInput {
  readonly request: HttpServerRequest.HttpServerRequest
  /** The caller principal authenticated at the edge; Gateway usage rows are attributed to it. */
  readonly principal: Principal
  /** Report the priced cost once usage is observed. Supplied by the edge; the Gateway does not know Budget. */
  readonly settle: (amount: number) => Effect.Effect<void>
  /**
   * Reserve spend for an additional inference on behalf of the same Holders, such as a Routing judge.
   * Absent reservations disable judging; matched Tier rules then use their default Tier.
   */
  readonly reserve?: (
    estimate?: number,
  ) => Effect.Effect<{ readonly settle: (amount: number) => Effect.Effect<void, unknown> }, unknown, Scope.Scope>
}

/** A sample request an administrator routes without running the chosen Model. */
export interface PreviewInput {
  readonly workspaceID: Workspace.ID
  readonly model: ModelSchema.Ref
  readonly prompt: string
  readonly purpose?: Routing.ResolveInput["purpose"]
  /** The administrator the Routing judge inference is attributed to. */
  readonly principal: Principal
  /** Reserve spend for the judge inference; absent reservations use the default Tier without judging. */
  readonly reserve?: InvokeInput["reserve"]
}

/** Provider-native reply: safe HTTP metadata and body. */
export interface Reply {
  readonly status: number
  readonly headers: Headers.Headers
  readonly body: Stream.Stream<Uint8Array, StreamError>
}

/** Provider-native Model discovery and invocation authority. */
export interface Interface {
  readonly list: (input: ListInput) => Effect.Effect<Reply, never, Scope.Scope>
  readonly invoke: (input: InvokeInput) => Effect.Effect<Reply, never, Scope.Scope>
  /**
   * Route a sample participant ask as LLM Gateway would, including a real judge inference, without
   * running the chosen Model. The judge is charged and recorded like any Gateway judge.
   */
  readonly preview: (
    input: PreviewInput,
  ) => Effect.Effect<
    Routing.Decision,
    Routing.UnresolvedError | Routing.UnavailableError | UnavailableError,
    Scope.Scope
  >
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/gateway/LLMGateway") {}

/** Canonical lease declaration; the host binds it while composing the process graph. */
export { node as lease } from "./llm-gateway/lease.js"

/** Gateway implementation. Its process authorities are explicit; Exchange remains private. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const exchange = yield* Exchange.Service
    const retained = yield* Lease.Service
    // Routing pins judged Tiers across a caller's Tool steps in the shared KV; graphs without KV never pin.
    const kv = yield* Effect.serviceOption(KV.Service)
    const routingLayer = Option.isSome(kv)
      ? Routing.layer.pipe(Layer.provide(Layer.succeed(KV.Service, kv.value)))
      : Routing.layer
    const withRuntime = <A, E, R>(workspaceID: Workspace.ID, effect: Effect.Effect<A, E, R | Capabilities>) =>
      Effect.gen(function* () {
        const runtime = yield* retained.acquire(workspaceID)
        return yield* effect.pipe(Effect.provide(Catalog.layer), Effect.provideContext(runtime))
      })
    const rendered = (protocol: Protocol, failure: Failure) => json(adapters[protocol].error(failure))

    return Service.of({
      list: Effect.fn("LLMGateway.list")(function* (input) {
        const adapter = adapters[input.protocol]
        return yield* Effect.gen(function* () {
          const entries = yield* withRuntime(
            input.workspaceID,
            Catalog.Service.use((catalog) =>
              Effect.forEach(adapter.discovery, (protocol) =>
                Effect.all([catalog.list(protocol), Route.auto(protocol)]).pipe(
                  Effect.map(([models, auto]) => [...auto, ...models]),
                ),
              ).pipe(
                Effect.map((groups) => [...new Map(groups.flat().map((entry) => [entry.id, entry])).values()]),
                Effect.provide(routingLayer),
              ),
            ),
          )
          const now = yield* Effect.sync(Date.now)
          return json({
            status: 200,
            headers: Headers.fromInput({ "content-type": "application/json" }),
            body: adapter.models(entries, now),
          })
        }).pipe(Effect.catch((failure) => Effect.succeed(rendered(input.protocol, failure))))
      }),
      preview: Effect.fn("LLMGateway.preview")(function* (input) {
        const runtime = yield* retained.acquire(input.workspaceID)
        return yield* Effect.gen(function* () {
          const routing = yield* Routing.Service
          const hooks = yield* Plugin.Hooks.Service
          const reserve = input.reserve
          return yield* routing.resolve({
            requestedModel: input.model,
            purpose: input.purpose ?? "assistant",
            digest: Routing.digest([Message.user(input.prompt)]),
            ...(reserve === undefined
              ? {}
              : {
                  judge: (judged: Routing.JudgeRequest) =>
                    Route.judge({
                      exchange,
                      hooks,
                      workspaceID: input.workspaceID,
                      principal: input.principal,
                      protocol: "openai-chat",
                      requestID: () => crypto.randomUUIDv4.pipe(Effect.orDie),
                      reserve,
                    })(judged).pipe(Effect.provideContext(runtime)),
                }),
          })
        }).pipe(Effect.provide(routingLayer), Effect.provideContext(runtime))
      }),
      invoke: Effect.fn("LLMGateway.invoke")(function* (input) {
        const adapter = adapters[input.protocol]
        const scope = yield* Scope.fork(yield* Scope.Scope)
        const reply = yield* Effect.gen(function* () {
          const original = yield* adapter.parse(input.request)
          const runtime = yield* retained.acquire(input.workspaceID)
          const response = yield* Effect.gen(function* () {
            const hooks = yield* Plugin.Hooks.Service
            const catalog = yield* Catalog.Service
            // Routing runs before Plugin hooks so they observe, and may still override, the routed Model.
            const requestedRef = yield* Route.requested(original.model)
            const routing = yield* Routing.Service
            const reserve = input.reserve
            const decision =
              requestedRef === undefined
                ? undefined
                : yield* routing
                    .resolve({
                      requestedModel: requestedRef,
                      purpose: "assistant",
                      digest: Route.digest(original),
                      ...(reserve === undefined
                        ? {}
                        : {
                            judge: (judged: Routing.JudgeRequest) =>
                              Route.judge({
                                exchange,
                                hooks,
                                workspaceID: input.workspaceID,
                                principal: input.principal,
                                protocol: original.protocol,
                                requestID: () => crypto.randomUUIDv4.pipe(Effect.orDie),
                                reserve,
                              })(judged).pipe(Effect.provideContext(runtime)),
                          }),
                      admits: (model) =>
                        catalog.resolve(Route.name(model), original.protocol).pipe(
                          Effect.as(true),
                          Effect.orElseSucceed(() => false),
                        ),
                      pin: { workspaceID: input.workspaceID },
                    })
                    .pipe(
                      Effect.mapError((error) =>
                        error._tag === "Routing.UnresolvedError"
                          ? new NotFoundError({ model: original.model })
                          : new UnavailableError({ reason: "No routing Tier can serve this request" }),
                      ),
                    )
            const routedModel =
              decision === undefined || decision.route.cause === "none" ? original.model : Route.name(decision.model)
            const draft = yield* hooks
              .trigger("gateway", "model.request", {
                protocol: original.protocol,
                requestedModel: original.model,
                stream: original.stream,
                model: routedModel,
                body: original.body,
              })
              .pipe(Effect.mapError(modelFailure))
            const request = yield* reparse(original, draft)
            if (request.model.startsWith(`${Routing.auto}/`)) return yield* new NotFoundError({ model: request.model })
            const resolver = yield* ModelResolver.Service
            const resolved = yield* catalog.resolve(request.model, request.protocol)
            const target =
              resolved.execution.routing.type === "aws-bedrock"
                ? {
                    type: "translated" as const,
                    canonical: yield* Translation.parse(request),
                    destination: yield* resolver
                      .prepare({ execution: resolved.execution, headers: {} })
                      .pipe(Effect.mapError(() => new UnavailableError({ reason: "Provider execution unavailable" }))),
                  }
                : {
                    type: "native" as const,
                    destination: yield* resolver
                      .native(resolved.execution)
                      .pipe(Effect.mapError(() => new NotFoundError({ model: request.model }))),
                  }
            if (target.type === "native" && !compatible(request.protocol, target.destination.format))
              return yield* new NotFoundError({ model: request.model })
            const requestID = yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(() => new UnavailableError({ reason: "Request ID unavailable" })),
            )
            const invocation = yield* hooks
              .open({
                domain: "gateway",
                event: Object.freeze({
                  id: requestID,
                  workspaceID: input.workspaceID,
                  model: Object.freeze({
                    provider: resolved.execution.selection.info.provider,
                    id: resolved.execution.selection.info.id,
                  }),
                  publicModel: resolved.entry.id,
                  stream: request.stream,
                  protocol: request.protocol,
                }),
              })
              .pipe(Effect.mapError(modelFailure))
            const exchangeInput = {
              request,
              headers: input.request.headers,
              workspaceID: input.workspaceID,
              principal: input.principal,
              endpointID: resolved.endpoint.id,
              publicModel: resolved.entry.id,
              requestID,
              invocation,
              settle: input.settle,
            }
            const exchangeCall =
              target.type === "native"
                ? exchange.invoke({ ...exchangeInput, destination: target.destination })
                : exchange.translate({ ...exchangeInput, canonical: target.canonical, destination: target.destination })
            const exchanged = yield* exchangeCall
            const reply =
              decision === undefined || decision.route.cause === "none"
                ? exchanged
                : {
                    ...exchanged,
                    headers: Headers.setAll(exchanged.headers, {
                      "x-bymorning-route-cause": decision.route.cause,
                      ...(decision.route.tier === undefined ? {} : { "x-bymorning-route-tier": decision.route.tier }),
                      ...(decision.route.fallback === undefined
                        ? {}
                        : { "x-bymorning-route-fallback": decision.route.fallback }),
                    }),
                  }
            if (!request.stream) yield* Scope.close(scope, Exit.void)
            return reply
          }).pipe(Effect.provide(Layer.mergeAll(routingLayer, Catalog.layer)), Effect.provideContext(runtime))
          // Stream effects run after this operation returns, so retain the leased context for body observation too.
          return {
            ...response,
            body: response.body.pipe(
              Stream.provideContext(runtime),
              Stream.onExit((exit) => Scope.close(scope, exit)),
            ),
          }
        }).pipe(
          Scope.provide(scope),
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
          Effect.catch((failure) => Effect.succeed(rendered(input.protocol, failure))),
        )
        return reply
      }),
    })
  }),
).pipe(Layer.provide(Exchange.layer))

/** Canonical LLM Gateway node; Workspace Plugin authorities arrive through the retained lease. */
export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Lease.node, LayerNodePlatform.httpClient, LayerNodePlatform.crypto, KV.node],
})

const json = (rendered: Rendered): Reply => ({
  status: rendered.status,
  headers: rendered.headers,
  body: Stream.make(new TextEncoder().encode(JSON.stringify(rendered.body))),
})

const compatible = (protocol: Protocol, format: ProviderSchema.Format) =>
  (protocol === "openai-chat" && format === "oa-compat") ||
  (protocol === "openai-responses" && format === "openai") ||
  (protocol === "anthropic-messages" && format === "anthropic") ||
  (protocol === "google-generate" && format === "google")
