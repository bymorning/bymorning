import { describe, expect, it } from "@effect/vitest"
import { Catalog as CoreCatalog } from "@bymorning/core/catalog"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Effect, Layer } from "effect"
import { Catalog } from "../../src/llm-gateway/catalog.js"
import * as Compatible from "@opencode-ai/ai/providers/openai-compatible"

const model = ModelSchema.Info.make({
  id: "custom-model",
  provider: ProviderSchema.Name.make("custom"),
  apiID: "upstream-custom",
  name: "Custom",
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

const execution: CoreCatalog.Execution = {
  implementation: { model: (id, settings) => Compatible.model(id, { ...settings, baseURL: String(settings.baseURL) }) },
  authentication: { type: "none" },
  selection: {
    info: model,
    format: "oa-compat",
    options: {},
    package: "@opencode-ai/ai/providers/openai-compatible",
    settings: {},
  },
  package: "@opencode-ai/ai/providers/openai-compatible",
  settings: {},
  routing: { type: "fixed", baseURL: new URL("http://127.0.0.1:9999/v1") },
}

const unused = () => Effect.die("unused") as never

const catalog = Layer.succeed(
  CoreCatalog.Service,
  CoreCatalog.Service.of({
    transform: unused,
    reload: unused,
    provider: { get: unused, all: unused, available: unused, directory: unused, update: unused },
    model: {
      get: unused,
      all: () => Effect.succeed([model]),
      available: unused,
      visible: unused,
      requireAvailable: unused,
      requireExecution: (ref: ModelSchema.Ref) =>
        ref.provider === model.provider && ref.id === model.id
          ? Effect.succeed(execution)
          : Effect.fail(
            new CoreCatalog.ModelUnavailableError({ model: ref, reason: "unavailable" }),
          ),
      toggle: unused,
      setDefault: unused,
      create: unused,
      update: unused,
      delete: unused,
      default: unused,
    },
  }),
)

const luna = ModelSchema.Info.make({
  ...model,
  id: "gpt-5.6-luna",
  provider: ProviderSchema.Bymorning,
  apiID: "upstream-luna",
  name: "Luna",
})

const lunaExecution: CoreCatalog.Execution = {
  ...execution,
  selection: { ...execution.selection, info: luna },
}

const lunaCatalog = Layer.succeed(
  CoreCatalog.Service,
  CoreCatalog.Service.of({
    transform: unused,
    reload: unused,
    provider: { get: unused, all: unused, available: unused, directory: unused, update: unused },
    model: {
      get: unused,
      all: () => Effect.succeed([luna]),
      available: unused,
      visible: unused,
      requireAvailable: unused,
      requireExecution: (ref: ModelSchema.Ref) =>
        ref.provider === luna.provider && ref.id === luna.id
          ? Effect.succeed(lunaExecution)
          : Effect.fail(
            new CoreCatalog.ModelUnavailableError({ model: ref, reason: "unavailable" }),
          ),
      toggle: unused,
      setDefault: unused,
      create: unused,
      update: unused,
      delete: unused,
      default: unused,
    },
  }),
)

describe("LLM Gateway Catalog effective resolution", () => {
  it.effect("resolves a qualified custom Model without a bundled definition", () =>
    Effect.gen(function* () {
      const gateway = yield* Catalog.Service
      const resolved = yield* gateway.resolve("custom/custom-model", "openai-chat")
      expect(resolved.entry).toMatchObject({ id: "custom/custom-model", name: "Custom" })
      expect(resolved.endpoint).toMatchObject({
        id: "custom/custom-model",
        protocol: "openai-chat",
        model: { provider: model.provider, id: model.id },
      })
      expect(resolved.execution.routing).toEqual({ type: "fixed", baseURL: new URL("http://127.0.0.1:9999/v1") })
    }).pipe(Effect.provide(Catalog.layer.pipe(Layer.provide(catalog)))),
  )

  it.effect("resolves a bundled public ID through the shared Catalog execution", () =>
    Effect.gen(function* () {
      const gateway = yield* Catalog.Service
      const resolved = yield* gateway.resolve("bymorning/gpt-5.6-luna", "openai-chat")
      expect(resolved.entry).toMatchObject({ id: "bymorning/gpt-5.6-luna", name: "Luna" })
      expect(resolved.execution).toEqual(lunaExecution)
      expect(resolved.execution.routing).toEqual({ type: "fixed", baseURL: new URL("http://127.0.0.1:9999/v1") })
    }).pipe(Effect.provide(Catalog.layer.pipe(Layer.provide(lunaCatalog)))),
  )

  it.effect("refuses an incompatible protocol for the effective execution", () =>
    Effect.gen(function* () {
      const gateway = yield* Catalog.Service
      const failure = yield* gateway.resolve("custom/custom-model", "anthropic-messages").pipe(Effect.flip)
      expect(failure._tag).toBe("LLMGateway.NotFoundError")
    }).pipe(Effect.provide(Catalog.layer.pipe(Layer.provide(catalog)))),
  )
})
