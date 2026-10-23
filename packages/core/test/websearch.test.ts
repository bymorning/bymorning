import { describe, expect, it } from "@effect/vitest"
import { ConfigWebSearch } from "@bymorning/schema/config/websearch"
import { Event } from "@bymorning/schema/event"
import { WebSearch as WebSearchSchema } from "@bymorning/schema/websearch"
import { Effect, Exit, Layer, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "../src/bus.js"
import { Config } from "../src/config.js"
import { WebSearch } from "../src/websearch.js"
import { ConfigWebSearchPlugin } from "../src/config/plugin/websearch.js"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import { configFixture, configService, minimalConfig } from "./service-fixtures.js"

const bus = Layer.succeed(
  Bus.Service,
  Bus.Service.of({
    publish: ((definition: Event.Definition, data: unknown) =>
      Effect.succeed({
        id: Event.ID.make(crypto.randomUUID()),
        created: Date.now(),
        type: definition.type,
        data,
      })) as Bus.Interface["publish"],
        subscribe: (() => Effect.succeed(Stream.empty)) as Bus.Subscribe,
  }),
)
const baseConfig = minimalConfig
const layer = WebSearch.layer.pipe(Layer.provide(bus))

const register = (id: string) =>
  Effect.gen(function* () {
    const websearch = yield* WebSearch.Service
    const calls: WebSearchSchema.ProviderInput[] = []
    yield* websearch.transform((editor) => {
      editor.add({
        id,
        name: id.toUpperCase(),
        execute: (input) =>
          Effect.sync(() => {
            calls.push(input)
            return [{ url: `https://${id}.example.com`, content: input.query, time: {} }]
          }),
      })
    })
    return { id: WebSearchSchema.ID.make(id), calls }
  })

describe("WebSearch", () => {
  it.effect("executes registered providers through the same service", () =>
    Effect.gen(function* () {
      const provider = yield* register("test")
      const websearch = yield* WebSearch.Service

      expect(yield* websearch.providers()).toEqual([{ id: provider.id, name: "TEST" }])
      expect(yield* websearch.query(WebSearchSchema.Input.make({ query: "effect" }))).toEqual(
        new WebSearchSchema.Response({
          providerID: provider.id,
          results: [{ url: "https://test.example.com", content: "effect", time: {} }],
        }),
      )
      expect(provider.calls).toEqual([{ query: "effect" }])
    }).pipe(Effect.provide(layer), Effect.scoped),
  )

  it.effect("honors an explicit provider without changing the default", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service

      expect(
        (yield* websearch.query({ query: "layers", providerID: parallel.id })).providerID,
      ).toBe(parallel.id)
      expect(parallel.calls).toEqual([{ query: "layers" }])
    }).pipe(Effect.provide(layer), Effect.scoped),
  )

  it.effect("supports configured and disabled defaults", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((editor) => editor.default.set(exa.id))
      expect((yield* websearch.query({ query: "configured" })).providerID).toBe(exa.id)

      yield* websearch.transform((editor) => editor.default.set(false))
      expect((yield* websearch.query({ query: "disabled" }).pipe(Effect.flip))._tag).toBe("WebSearch.Disabled")
    }).pipe(Effect.provide(layer), Effect.scoped),
  )

  it.effect("requires a provider when none are registered", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      expect((yield* websearch.query({ query: "missing" }).pipe(Effect.flip))._tag).toBe(
        "WebSearch.ProviderRequired",
      )
    }).pipe(Effect.provide(layer), Effect.scoped),
  )

  it.effect("removes scoped provider registrations", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const provider = yield* register("temporary").pipe(Scope.provide(scope))
      expect(yield* websearch.providers()).toContainEqual({ id: provider.id, name: "TEMPORARY" })
      yield* Scope.close(scope, Exit.void)
      expect(yield* websearch.providers()).toEqual([])
    }).pipe(Effect.provide(layer), Effect.scoped),
  )

  it.effect("applies a persisted provider after plugin defaults", () => {
    const selected = WebSearchSchema.ID.make("tavily")
    const config = configService({
      ...baseConfig,
      websearch: ConfigWebSearch.Info.make({ provider: selected }),
    })
    return Effect.scoped(
      Effect.gen(function* () {
        const websearch = yield* WebSearch.Service
        const exa = yield* register("exa")
        const tavily = yield* register("tavily")
        yield* websearch.transform((editor) => editor.default.set(exa.id))
        yield* ConfigWebSearchPlugin.Plugin.effect({ websearch } as unknown as PluginContext)
        expect((yield* websearch.default())?.id).toBe(tavily.id)
      }).pipe(
        Effect.provide(Layer.mergeAll(Layer.succeed(Config.Service, config), WebSearch.layer.pipe(Layer.provide(bus)))),
      ),
    )
  })

  it.effect("activates a persisted disabled default", () => {
    const config = configService({ ...baseConfig, websearch: false })
    return Effect.scoped(
      Effect.gen(function* () {
        const websearch = yield* WebSearch.Service
        const exa = yield* register("exa")
        yield* websearch.transform((editor) => editor.default.set(exa.id))
        yield* ConfigWebSearchPlugin.Plugin.effect({ websearch } as unknown as PluginContext)
        expect(yield* websearch.default().pipe(Effect.flip)).toBeInstanceOf(WebSearch.DisabledError)
      }).pipe(
        Effect.provide(Layer.mergeAll(Layer.succeed(Config.Service, config), WebSearch.layer.pipe(Layer.provide(bus)))),
      ),
    )
  })

  it.effect("applies the configured selection as Config changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const config = yield* configFixture(baseConfig)
        return yield* Effect.gen(function* () {
          const websearch = yield* WebSearch.Service
          yield* ConfigWebSearchPlugin.Plugin.effect({ websearch } as unknown as PluginContext)
          const exa = yield* register("exa")
          const tavily = yield* register("tavily")

          const registered = new Set((yield* websearch.providers()).map((provider) => provider.id))
          expect(registered).toEqual(new Set([exa.id, tavily.id]))
          // No configured selection: the default is random across the registered providers.
          const initial = yield* websearch.default()
          expect(initial !== undefined && registered.has(initial.id)).toBe(true)

          yield* config.publish({
            ...baseConfig,
            websearch: ConfigWebSearch.Info.make({ provider: WebSearchSchema.ID.make("tavily") }),
          })
          yield* TestClock.adjust("1 second")
          expect((yield* websearch.default())?.id).toBe(WebSearchSchema.ID.make("tavily"))

          yield* config.publish({ ...baseConfig, websearch: false })
          yield* TestClock.adjust("1 second")
          expect(yield* websearch.default().pipe(Effect.flip)).toBeInstanceOf(WebSearch.DisabledError)

          yield* config.publish(baseConfig)
          yield* TestClock.adjust("1 second")
          const restored = yield* websearch.default()
          expect(restored !== undefined && registered.has(restored.id)).toBe(true)
        }).pipe(Effect.provide(Layer.merge(config.layer, WebSearch.layer.pipe(Layer.provide(bus)))))
      }),
    ),
  )

  it.effect("keeps the plugin-contributed default when Config omits a selection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const config = yield* configFixture(baseConfig)
        return yield* Effect.gen(function* () {
          const websearch = yield* WebSearch.Service
          yield* ConfigWebSearchPlugin.Plugin.effect({ websearch } as unknown as PluginContext)
          const exa = yield* register("exa")
          yield* websearch.transform((editor) => editor.default.set(exa.id))
          expect((yield* websearch.default())?.id).toBe(exa.id)

          yield* config.publish({ ...baseConfig, gateway: { limits: { rpm: 2_000 } } })
          yield* TestClock.adjust("1 second")
          expect((yield* websearch.default())?.id).toBe(exa.id)
        }).pipe(Effect.provide(Layer.merge(config.layer, WebSearch.layer.pipe(Layer.provide(bus)))))
      }),
    ),
  )
})
