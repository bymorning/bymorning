export * as Limiter from "./limiter.js"

import { Context, Duration, Effect, Layer, Metric, Schema } from "effect"
import { RateLimiter } from "./effect-rate-limiter.js"
import { Workspace } from "@bymorning/schema/workspace"
import { Config } from "./config.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

/** An activity limit prevented an inference invocation. */
export class LimitError extends Schema.TaggedError<LimitError>()("Limiter.LimitError", {
  limit: Schema.Literals(["model", "request", "token"]),
  scope: Schema.Literals(["workspace", "service_account"]),
  retryAfter: Schema.optional(Schema.Number),
}) {}

/** The rate-limit store could not make a limit decision. */
export class StoreError extends Schema.TaggedError<StoreError>()("Limiter.StoreError", {}) {}

export interface Interface {
  readonly consume: (input: {
    readonly workspaceID: Workspace.ID
    readonly model: string
  }) => Effect.Effect<void, LimitError | StoreError, Config.Service>
  readonly charge: (input: {
    readonly workspaceID: Workspace.ID
    readonly tokens: number
  }) => Effect.Effect<void, LimitError | StoreError, Config.Service>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Limiter") {}

/** Private state store for the process-local Effect RateLimiter. */
export const State = RateLimiter.RateLimiterStore
export const stateMemory = RateLimiter.layerStoreMemory

/** Application-owned rate-limit store. All Limiter instances share it. */
export const stateNode = makeGlobalNode({ service: State, layer: stateMemory, deps: [] })

const consumeMetric = Metric.counter("bymorning_limiter_consume_total", { incremental: true })
const chargeMetric = Metric.counter("bymorning_limiter_charge_total", { incremental: true })

export const sharedLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const rate = yield* RateLimiter.RateLimiter
    const policy = Effect.fn("Limiter.policy")(function* () {
      const config = yield* Config.Service
      return (yield* config.get).gateway
    })
    const use = (
      key: string,
      limit: number | undefined,
      tokens: number,
      kind: "request" | "token",
      operation: "consume" | "charge",
    ) =>
      limit === undefined
        ? Effect.void
        : rate.consume({ key, limit, tokens, window: "60 seconds" }).pipe(
            Effect.asVoid,
            Effect.mapError((error) =>
              error.reason._tag === "RateLimitExceeded"
                ? new LimitError({
                    limit: kind,
                    scope: "workspace",
                    retryAfter: Duration.toMillis(error.reason.retryAfter),
                  })
                : new StoreError(),
            ),
            Effect.tap(() =>
              Metric.update(
                Metric.withAttributes(operation === "consume" ? consumeMetric : chargeMetric, {
                  limit: kind,
                  scope: "workspace",
                  outcome: "accepted",
                }),
                1,
              ),
            ),
            Effect.tapError((error) =>
              Metric.update(
                Metric.withAttributes(operation === "consume" ? consumeMetric : chargeMetric, {
                  limit: kind,
                  scope: "workspace",
                  outcome: error._tag === "Limiter.LimitError" ? "refused" : "store_error",
                }),
                1,
              ),
            ),
          )
    return Service.of({
      consume: Effect.fn("Limiter.consume")(function* ({ workspaceID, model }) {
        const gateway = yield* policy()
        if (gateway?.models !== undefined && !gateway.models.includes(model)) {
          yield* Metric.update(
            Metric.withAttributes(consumeMetric, { limit: "model", scope: "workspace", outcome: "refused" }),
            1,
          )
          return yield* new LimitError({ limit: "model", scope: "workspace" })
        }
        yield* use(`workspace:${workspaceID}:request`, gateway?.limits?.rpm, 1, "request", "consume")
      }),
      charge: Effect.fn("Limiter.charge")(function* ({ workspaceID, tokens }) {
        const gateway = yield* policy()
        yield* use(`workspace:${workspaceID}:token`, gateway?.limits?.tpm, tokens, "token", "charge")
      }),
    })
  }),
).pipe(Layer.provide(RateLimiter.layer))

/** Isolated Limiter construction for focused graphs. Application graphs use `sharedLayer` with `stateNode`. */
export const layer = sharedLayer.pipe(Layer.provide(stateMemory))
