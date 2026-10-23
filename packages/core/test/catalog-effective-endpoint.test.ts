import { describe, expect, it } from "@effect/vitest"
import { ConfigSchema } from "@bymorning/schema/config"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Effect, Exit, Layer, Scope, Stream } from "effect"
import { Catalog } from "../src/catalog.js"
import { Model } from "../src/model.js"
import { Provider } from "../src/provider.js"
import { Integration } from "../src/integration.js"
import { Config } from "../src/config.js"
import { configService } from "./service-fixtures.js"

const provider = ProviderSchema.Info.make({
  name: ProviderSchema.Name.make("test"),
  displayName: "Test",
  api: ProviderSchema.API.make("https://example.com"),
  format: "oa-compat",
  status: "enabled",
  execution: { authentication: { type: "key", integration: "test", header: "authorization", prefix: "Bearer " } },
})

const model = ModelSchema.Info.make({
  id: "base",
  provider: provider.name,
  apiID: "base",
  name: "Base",
  description: "",
  status: "active",
  releaseDate: "2026-01-01",
  lastUpdated: "2026-01-01",
  openWeights: false,
  capabilities: { temperature: true, reasoning: false, attachment: false, tools: true, input: [], output: [] },
  variants: [],
  limit: { context: 1, output: 1 },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
})

const dependencies = Layer.merge(
  Layer.succeed(
    Provider.Service,
    Provider.Service.of({
      get: () => Effect.succeed(provider),
      list: Effect.succeed([provider]),
      stream: () => Stream.die("unused"),
    }),
  ),
  Layer.succeed(
    Model.Service,
    Model.Service.of({
      get: () =>
        Effect.succeed({
          info: model,
          format: "oa-compat" as const,
          options: {},
          package: "@opencode-ai/ai/providers/openai-compatible",
          settings: {},
        }),
      list: Effect.succeed([model]),
    }),
  ),
)

const harness = Catalog.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      dependencies,
      Layer.succeed(
        Integration.Service,
        Integration.Service.of({
          get: (id: Integration.ID) => Effect.succeed({ id, name: id, connections: [{}] }),
        } as unknown as Integration.Interface),
      ),
      Layer.succeed(
        Config.Service,
        configService(
          ConfigSchema.Info.make({
            permissions: [],
            compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
            model_policy: { disabled: [], seen: [], initialized: [] },
          }),
        ),
      ),
    ),
  ),
)

describe("Catalog effective endpoint", () => {
  it.effect("carries the shared provider api in fixed executions", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const initial = yield* catalog.model.requireExecution({ provider: provider.name, id: model.id })
      expect(initial.routing).toEqual({ type: "fixed", baseURL: new URL("https://example.com") })
    }).pipe(Effect.provide(harness)),
  )

  it.effect("replays a Plugin nativeAPI transform and restores on disposal", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const scope = yield* Scope.make()
      yield* catalog
        .transform((editor) => {
          editor.provider.update("test", (value) => {
            value.api = ProviderSchema.API.make("http://127.0.0.1:9999/v1")
          })
        })
        .pipe(Scope.provide(scope))

      const transformed = yield* catalog.model.requireExecution({ provider: provider.name, id: model.id })
      expect(transformed.routing).toEqual({ type: "fixed", baseURL: new URL("http://127.0.0.1:9999/v1") })

      yield* Scope.close(scope, Exit.void)
      const restored = yield* catalog.model.requireExecution({ provider: provider.name, id: model.id })
      expect(restored.routing).toEqual({ type: "fixed", baseURL: new URL("https://example.com") })
    }).pipe(Effect.provide(harness)),
  )

  it.effect("fails closed when the effective api is missing or invalid", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const missingScope = yield* Scope.make()
      yield* catalog
        .transform((editor) => {
          editor.provider.update("test", (value) => {
            delete value.api
          })
        })
        .pipe(Scope.provide(missingScope))
      const missing = yield* catalog.model
        .requireExecution({ provider: provider.name, id: model.id })
        .pipe(Effect.flip)
      expect(missing._tag).toBe("Catalog.ModelUnavailableError")
      expect(missing.reason).toBe("transport-unsupported")
      yield* Scope.close(missingScope, Exit.void)

      const invalidScope = yield* Scope.make()
      yield* catalog
        .transform((editor) => {
          editor.provider.update("test", (value) => {
            value.api = ProviderSchema.API.make("not a url")
          })
        })
        .pipe(Scope.provide(invalidScope))
      const invalid = yield* catalog.model
        .requireExecution({ provider: provider.name, id: model.id })
        .pipe(Effect.flip)
      expect(invalid._tag).toBe("Catalog.ModelUnavailableError")
      expect(invalid.reason).toBe("transport-unsupported")
    }).pipe(Effect.provide(harness)),
  )
})
