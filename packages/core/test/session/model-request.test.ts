import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Ref } from "effect"
import { Model } from "../../src/model.js"
import { PluginHooks } from "../../src/plugin/hooks.js"
import { Provider } from "../../src/provider.js"
import { SessionModelRequest } from "../../src/session/model-request.js"
import { ModelResolver } from "../../src/model-resolver.js"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import { Auth } from "@opencode-ai/ai/route/auth"
import type { HttpMiddleware } from "@opencode-ai/ai/route/executor"

const SOL = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-pro" })
const TERRA = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-flash" })
const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000901")
const agent = Agent.ID.make("build")
const resolver = Layer.effect(
  ModelResolver.Service,
  Effect.gen(function* () {
    const models = yield* Model.Service
    return ModelResolver.Service.of({
      native: () => Effect.die("unused"),
      prepare: () => Effect.die("unused"),
      resolve: (input) =>
        models.get(input.model).pipe(
          Effect.map((selection) => ({
            ref: input.model,
            selection,
            runtimeModel: configure({
              auth: Auth.none,
              baseURL: "https://example.com",
              provider: input.model.provider,
            }).model(selection.info.apiID),
            authentication: ((request, handler) => handler(request)) satisfies HttpMiddleware,
          })),
          Effect.mapError(() => new ModelResolver.ResolutionError({ model: input.model, reason: "unknown-model" })),
        ),
    })
  }),
).pipe(Layer.provide(Model.layer))
const dependencies = Layer.mergeAll(
  PluginHooks.layer,
  Model.layer,
  Provider.layer,
  resolver,
)
const input = (requestedModel = SOL): SessionModelRequest.Input => ({
  purpose: "assistant",
  sessionID,
  agent,
  requestedModel,
})

describe("SessionModelRequest", () => {
  it.effect("routes in registration order and resolves the final executable model", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const observed = yield* Ref.make<string[]>([])
        yield* hooks.register("session", "model.request", (event) =>
          Ref.update(observed, (items) => [...items, `${event.requestedModel.id}:${event.model.id}`]).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                event.model = TERRA
              }),
            ),
          ),
        )
        yield* hooks.register("session", "model.request", (event) =>
          Ref.update(observed, (items) => [...items, `${event.requestedModel.id}:${event.model.id}`]).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                event.headers["x-policy"] = "routed"
              }),
            ),
          ),
        )

        const result = yield* SessionModelRequest.plan(input())

        expect(yield* Ref.get(observed)).toEqual(["deepseek-v4-pro:deepseek-v4-pro", "deepseek-v4-pro:deepseek-v4-flash"])
        expect(result.requestedModel).toEqual(SOL)
        expect(result.model).toEqual(TERRA)
        expect(result.resolved.selection.info.id).toBe("deepseek-v4-flash")
        expect(result.headers).toEqual({ "x-policy": "routed" })
        expect(result.requestedModel).not.toBe(result.model)
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("copies mutable hook output and leaves the caller's requested model unchanged", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const original = { ...SOL }
        let retainedHeaders: Record<string, string> | undefined
        yield* hooks.register("session", "model.request", (event) =>
          Effect.sync(() => {
            retainedHeaders = event.headers
            Object.assign(event.model, { id: TERRA.id })
            event.headers.policy = "initial"
          }),
        )
        const result = yield* SessionModelRequest.plan(input(original))
        if (retainedHeaders === undefined) return yield* Effect.die(new Error("Hook was not called"))
        retainedHeaders.policy = "late"
        expect(original).toEqual(SOL)
        expect(result.model).toEqual(TERRA)
        expect(result.headers).toEqual({ policy: "initial" })
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("rejects malformed and missing routed destinations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        yield* hooks.register("session", "model.request", (event) =>
          Effect.sync(() => {
            event.model = { provider: 42, id: null } as never
          }),
        )
        expect((yield* SessionModelRequest.plan(input()).pipe(Effect.flip))._tag).toBe("SessionModelRequest.Failure")
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("rejects a catalog-only destination that is not executable", () =>
    SessionModelRequest.plan(
      input(ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "catalog-only" })),
    ).pipe(
      Effect.flip,
      Effect.tap((failure) =>
        Effect.sync(() =>
          expect(failure).toMatchObject({
            message: "Routed model deepseek/catalog-only cannot run: model is not registered.",
          }),
        ),
      ),
      Effect.provide(dependencies),
    ),
  )

  it.effect("lets the last hook route win while earlier hooks still observe the original request", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const observed = yield* Ref.make<string[]>([])
        yield* hooks.register("session", "model.request", (event) =>
          Ref.update(observed, (items) => [...items, event.model.id]).pipe(
            Effect.tap(() => Effect.sync(() => {
              event.model = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "not-executable" })
            })),
          ),
        )
        yield* hooks.register("session", "model.request", (event) =>
          Ref.update(observed, (items) => [...items, event.model.id]).pipe(
            Effect.tap(() => Effect.sync(() => {
              event.model = TERRA
            })),
          ),
        )
        expect((yield* SessionModelRequest.plan(input())).model).toEqual(TERRA)
        expect(yield* Ref.get(observed)).toEqual(["deepseek-v4-pro", "not-executable"])
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("routes with the full originally requested model available to hooks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const seen = yield* Ref.make<ReadonlyArray<ModelSchema.Ref>>([])
        yield* hooks.register("session", "model.request", (event) =>
          Ref.update(seen, (items) => [...items, { ...event.requestedModel }]).pipe(
            Effect.tap(() => Effect.sync(() => {
              event.model = TERRA
            })),
          ),
        )
        expect((yield* SessionModelRequest.plan(input())).model).toEqual(TERRA)
        expect(yield* Ref.get(seen)).toEqual([SOL])
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("rejects an unavailable hook-routed destination without provider resolution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        yield* hooks.register("session", "model.request", (event) =>
          Effect.sync(() => {
            event.model = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "not-executable" })
          }),
        )
        expect(yield* SessionModelRequest.plan(input()).pipe(Effect.flip)).toMatchObject({
          message: "Routed model deepseek/not-executable cannot run: model is not registered.",
        })
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("merges hook transport policy into the resolved destination", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const modelResolver = yield* ModelResolver.Service
        const observed = yield* Ref.make<ModelResolver.ResolveInput | undefined>(undefined)
        yield* hooks.register("session", "model.request", (event) =>
          Effect.sync(() => {
            event.baseURL = "https://hook.example/v1"
            event.headers["x-a"] = "hook"
          }),
        )
        yield* hooks.register("session", "model.request", (event) =>
          Effect.sync(() => {
            event.headers["x-b"] = "hook"
          }),
        )

        yield* SessionModelRequest.plan(input()).pipe(
          Effect.provideService(ModelResolver.Service, {
            native: modelResolver.native,
            prepare: modelResolver.prepare,
            resolve: (request) => Ref.set(observed, request).pipe(Effect.andThen(modelResolver.resolve(request))),
          }),
        )
        expect(yield* Ref.get(observed)).toMatchObject({
          baseURL: "https://hook.example/v1",
          headers: { "x-a": "hook", "x-b": "hook" },
        })
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("normalizes callback defects but preserves interruption", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        yield* hooks.register("session", "model.request", () => Effect.die(new Error("plugin exploded")))
        expect(yield* SessionModelRequest.plan(input()).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionModelRequest.Failure",
        })
      }),
    ).pipe(Effect.provide(dependencies)),
  )

  it.effect("interrupts an active routing callback", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const hooks = yield* PluginHooks.Service
        const started = yield* Deferred.make<void>()
        yield* hooks.register("session", "model.request", () =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        )
        const fiber = yield* SessionModelRequest.plan(input()).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      }),
    ).pipe(Effect.provide(dependencies)),
  )
})
