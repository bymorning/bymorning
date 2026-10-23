import { describe, expect, it } from "@effect/vitest"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Layer, Ref, Schema, Stream } from "effect"
import * as RateLimiter from "effect/unstable/persistence/RateLimiter"
import { Config } from "../src/config.js"
import { Limiter } from "../src/limiter.js"

const unused = () => Effect.die("unused")
const workspaceID = Workspace.ID.make("wrk_limiter")

const fixture = (input: {
  readonly gateway?: unknown
  readonly failStore?: boolean
  readonly state?: Layer.Layer<RateLimiter.RateLimiterStore>
}) =>
  Effect.gen(function* () {
    const config = yield* Schema.decodeUnknownEffect(ConfigSchema.Info)({ gateway: input.gateway })
    const workspace = Config.Service.of({
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Effect.succeed(config),
      update: unused,
      refresh: Effect.die("unused"),
      modelPolicy: { reconcile: unused, toggle: unused, setDefault: unused },
      mcp: { update: () => Effect.die("unused"), put: unused, remove: unused },
      plugin: { configure: unused },
      entries: unused,
      changes: () => Stream.empty,
    })
    const state = input.failStore
      ? Layer.succeed(
          Limiter.State,
          Limiter.State.of({
            fixedWindow: () =>
              Effect.fail(
                new RateLimiter.RateLimiterError({
                  reason: new RateLimiter.RateLimitStoreError({ message: "offline" }),
                }),
              ),
            tokenBucket: unused,
            adaptiveConsume: unused,
            adaptiveFeedback: unused,
          }),
        )
      : (input.state ?? Limiter.stateMemory)
    return {
      layer: Limiter.sharedLayer.pipe(
        Layer.provideMerge(Layer.mergeAll(Layer.succeed(Config.Service, workspace), state)),
      ),
    }
  })

const resettableState = Effect.gen(function* () {
  const counters = yield* Ref.make(new Map<string, number>())
  return {
    layer: Layer.succeed(
      Limiter.State,
      Limiter.State.of({
        fixedWindow: ({ key, tokens }) =>
          Ref.modify(counters, (current) => {
            const count = (current.get(key) ?? 0) + tokens
            return [[count, 60_000] as const, new Map(current).set(key, count)]
          }),
        tokenBucket: unused,
        adaptiveConsume: unused,
        adaptiveFeedback: unused,
      }),
    ),
    reset: Ref.set(counters, new Map()),
  }
})

describe("Limiter", () => {
  it.effect("admits only provider-qualified models from the Workspace allowlist", () =>
    Effect.gen(function* () {
      const current = yield* fixture({ gateway: { models: ["openai/gpt-5"] } })
      yield* Limiter.Service.use((limiter) => limiter.consume({ workspaceID, model: "openai/gpt-5" })).pipe(
        Effect.provide(current.layer),
      )
      const error = yield* Limiter.Service.use((limiter) =>
        limiter.consume({ workspaceID, model: "anthropic/gpt-5" }),
      ).pipe(Effect.flip, Effect.provide(current.layer))
      expect(error).toMatchObject({ _tag: "Limiter.LimitError", limit: "model", scope: "workspace" })
    }),
  )

  it.effect("uses the Workspace allowlist as the authoritative model policy", () =>
    Effect.gen(function* () {
      const current = yield* fixture({ gateway: { models: ["anthropic/claude"] } })
      yield* Limiter.Service.use((limiter) => limiter.consume({ workspaceID, model: "anthropic/claude" })).pipe(
        Effect.provide(current.layer),
      )
      const error = yield* Limiter.Service.use((limiter) =>
        limiter.consume({ workspaceID, model: "openai/gpt-5" }),
      ).pipe(Effect.flip, Effect.provide(current.layer))
      expect(error).toMatchObject({ _tag: "Limiter.LimitError", limit: "model", scope: "workspace" })
    }),
  )

  it.effect("refuses the request after RPM is exhausted and resets on the test clock", () =>
    Effect.gen(function* () {
      const state = yield* resettableState
      const current = yield* fixture({ gateway: { limits: { rpm: 2 } }, state: state.layer })
      const { error } = yield* Effect.gen(function* () {
        const limiter = yield* Limiter.Service
        yield* limiter.consume({ workspaceID, model: "openai/gpt-5" })
        yield* limiter.consume({ workspaceID, model: "openai/gpt-5" })
        const error = yield* limiter.consume({ workspaceID, model: "openai/gpt-5" }).pipe(Effect.flip)
        yield* state.reset
        yield* limiter.consume({ workspaceID, model: "openai/gpt-5" })
        return { error }
      }).pipe(Effect.provide(current.layer))
      expect(error).toMatchObject({ _tag: "Limiter.LimitError", limit: "request", retryAfter: expect.any(Number) })
      if (error._tag === "Limiter.LimitError") expect(error.retryAfter).toBeGreaterThan(0)
    }),
  )

  it.effect("charges TPM by the supplied normalized token total", () =>
    Effect.gen(function* () {
      const current = yield* fixture({ gateway: { limits: { tpm: 5 } } })
      const error = yield* Effect.gen(function* () {
        const limiter = yield* Limiter.Service
        yield* limiter.charge({ workspaceID, tokens: 5 })
        return yield* limiter.charge({ workspaceID, tokens: 1 }).pipe(Effect.flip)
      }).pipe(Effect.provide(current.layer))
      expect(error).toMatchObject({ _tag: "Limiter.LimitError", limit: "token", scope: "workspace" })
    }),
  )

  it.effect("shares counters between separately constructed Limiter services using one State", () =>
    Effect.gen(function* () {
      const state = yield* resettableState
      const first = yield* fixture({ gateway: { limits: { rpm: 1 } }, state: state.layer })
      const second = yield* fixture({ gateway: { limits: { rpm: 1 } }, state: state.layer })
      yield* Limiter.Service.use((limiter) => limiter.consume({ workspaceID, model: "openai/gpt-5" })).pipe(
        Effect.provide(first.layer),
      )
      const error = yield* Limiter.Service.use((limiter) =>
        limiter.consume({ workspaceID, model: "openai/gpt-5" }),
      ).pipe(Effect.flip, Effect.provide(second.layer))
      expect(error).toMatchObject({ _tag: "Limiter.LimitError", limit: "request" })
    }),
  )

  it.effect("surfaces backing-store failure distinctly from a limit refusal", () =>
    Effect.gen(function* () {
      const current = yield* fixture({ gateway: { limits: { rpm: 1 } }, failStore: true })
      const error = yield* Limiter.Service.use((limiter) =>
        limiter.consume({ workspaceID, model: "openai/gpt-5" }),
      ).pipe(Effect.flip, Effect.provide(current.layer))
      expect(error._tag).toBe("Limiter.StoreError")
    }),
  )
})
