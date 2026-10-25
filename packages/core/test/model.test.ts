import { Model } from "@bymorning/core/model"
import { catalog as pinned } from "@bymorning/models/catalog"
import { models as bedrockModels } from "@bymorning/models/generated/amazon-bedrock"
import { models as openAIModels } from "@bymorning/models/generated/openai"
import * as Provider from "@bymorning/schema/provider"
import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import { bedrockCatalog, govCloudProfiles, openAIBindings, openAICatalog } from "../src/model/direct.js"
import { legacyCatalog } from "../src/model/legacy.js"
import { bindings, joinRegistry, registry } from "../src/model/registry.js"

const generatedCatalogFixture = openAICatalog.filter(({ id }) => id === "gpt-5.6")
const isDeprecated = (model: { readonly lifecycle: string }) => model.lifecycle === "deprecated"
/** Bundled Bedrock IDs: `us-gov.` rows for the documented GovCloud profiles lead the pinned rows. */
const bedrockIDs = (models: ReadonlyArray<(typeof bedrockModels)[number]>) => [
  ...govCloudProfiles
    .filter((apiID) => models.some((model) => model.apiID === apiID))
    .map((apiID) => `us-gov.${apiID.slice("us.".length)}`),
  ...models.map(({ local }) => local.id),
]

test("discovers every nondeprecated pinned row without requiring an execution binding", async () => {
  const discovered = await Effect.runPromise(
    Model.Service.use((service) => service.list).pipe(Effect.provide(Model.layer)),
  )
  const identities = new Set(discovered.map((model) => `${model.provider}/${model.apiID}`))
  for (const provider of Object.values(pinned)) {
    for (const model of Object.values(provider.models)) {
      const name = provider.id === "fireworks-ai" ? "fireworks" : provider.id
      expect(identities.has(`${name}/${model.id}`)).toBe(model.status !== "deprecated")
    }
  }
  expect(Model.publicID({ provider: Provider.Name.make("groq"), id: "shared-name" })).toBe("groq/shared-name")
})

test("keeps every non-deprecated source model in the executable registry", () => {
  const previouslyFiltered = [
    "chatgpt-image-latest",
    "gpt-image-1",
    "gpt-image-1-mini",
    "gpt-image-1.5",
    "gpt-image-2",
    "gpt-realtime-2.1",
    "text-embedding-3-large",
    "text-embedding-3-small",
    "text-embedding-ada-002",
  ]
  expect(
    registry
      .filter(({ provider, id }) => provider === Provider.OpenAI && previouslyFiltered.includes(id))
      .map(({ id }) => id)
      .sort(),
  ).toEqual(
    previouslyFiltered
      .filter((id) => openAIModels.some((model) => model.local.id === id && !isDeprecated(model)))
      .sort(),
  )
})

test("uses only code-backed provider adapters without generated transport metadata", () => {
  for (const entry of registry.filter(
    ({ provider }) => provider === Provider.OpenAI || provider === Provider.Anthropic,
  )) {
    expect(entry.options).toEqual({})
    expect(entry.variants).toEqual({})
    expect(JSON.stringify(entry.options)).not.toMatch(/https?:|headers|body|npm|env|apiKey/i)
  }
  const bedrock = registry.filter(({ provider }) => provider === Provider.AmazonBedrock)
  expect(bedrock).toHaveLength(bedrockIDs(bedrockModels.filter((model) => !isDeprecated(model))).length)
  for (const entry of bedrock) expect(entry.options).toEqual({})
})

test("adds a GovCloud profile only for each US profile AWS documents in GovCloud", () => {
  const sonnet = "anthropic.claude-sonnet-4-5-20250929-v1:0"
  const us = bedrockCatalog.find(({ id }) => id === `us.${sonnet}`)!
  const gov = bedrockCatalog.find(({ id }) => id === `us-gov.${sonnet}`)!
  expect(gov).toEqual({
    ...us,
    id: `us-gov.${sonnet}`,
    apiID: `us-gov.${sonnet}`,
    name: "Claude Sonnet 4.5 (US GovCloud)",
  })
  const binding = (id: string) => bindings.find((entry) => entry.provider === Provider.AmazonBedrock && entry.id === id)
  expect(binding(`us-gov.${sonnet}`)).toEqual({ ...binding(`us.${sonnet}`), id: `us-gov.${sonnet}` })
  // Every documented profile exists in the pinned source; a dropped one must be noticed, not skipped silently.
  for (const apiID of govCloudProfiles)
    expect(
      bedrockModels.map((model) => model.apiID),
      apiID,
    ).toContain(apiID)
  const derived = bedrockCatalog.filter(({ id }) => id.startsWith("us-gov."))
  expect(derived.map(({ apiID }) => apiID)).toEqual(govCloudProfiles.map((apiID) => `us-gov.${apiID.slice(3)}`))
  // Pinned US profiles GovCloud does not serve get no us-gov. row.
  expect(bedrockCatalog.some(({ id }) => id === "us-gov.anthropic.claude-fable-5")).toBe(false)
  expect(bedrockCatalog.some(({ id }) => id === "us-gov.meta.llama4-scout-17b-instruct-v1:0")).toBe(false)
  expect(derived.every(({ name }) => name.endsWith(" (US GovCloud)") && !name.includes("(US) "))).toBe(true)
  expect(bedrockModels.some(({ apiID }) => apiID.startsWith("us-gov."))).toBe(false)
})

test("maps optional generated pricing lanes without importing unsupported fields", () => {
  const gpt56 = openAICatalog.find(({ id }) => id === "gpt-5.6")
  expect(gpt56?.cost).toEqual({
    input: 4,
    output: 20,
    cache: { read: 0.4, write: 5 },
    tiers: [
      {
        input: 8,
        output: 30,
        cache: { read: 0.8, write: 10 },
        tier: { type: "context", size: 272_000 },
      },
    ],
    experimentalOver200K: { input: 8, output: 30, cache: { read: 0.8, write: 10 } },
  })
  expect(gpt56).not.toHaveProperty("source")
  expect(gpt56).not.toHaveProperty("unsupported")
  expect(gpt56?.capabilities).not.toHaveProperty("structuredOutput")
})

test("omits deprecated Models from discovery and refuses direct selection", async () => {
  expect(legacyCatalog.map(({ provider, id }) => [provider, id])).toEqual([["anthropic", "claude-opus-4-1"]])

  await expect(
    Effect.runPromise(
      Model.Service.use((models) => models.get({ provider: Provider.Anthropic, id: "claude-opus-4-1" })).pipe(
        Effect.provide(Model.layer),
      ),
    ),
  ).rejects.toMatchObject({ _tag: "Model.NotFoundError" })
  const listed = await Effect.runPromise(Model.Service.use((models) => models.list).pipe(Effect.provide(Model.layer)))
  expect(listed.some((model) => model.status === "deprecated")).toBe(false)
  expect(listed.some((model) => model.provider === Provider.Name.make("bymorning"))).toBe(false)
})

test("keeps absent and default variant selection equivalent for every model", async () => {
  await Effect.runPromise(
    Model.Service.use((models) =>
      Effect.forEach(registry, (entry) => {
        if (!entry.capabilities.input.includes("text") || !entry.capabilities.output.includes("text"))
          return Effect.all([
            models.get({ provider: entry.provider, id: entry.id }).pipe(Effect.flip, Effect.orDie),
            models.get({ provider: entry.provider, id: entry.id, variant: "default" }).pipe(Effect.flip, Effect.orDie),
          ]).pipe(
            Effect.tap((errors) =>
              Effect.sync(() =>
                expect(errors.map((error) => error._tag)).toEqual(["Model.NotFoundError", "Model.NotFoundError"]),
              ),
            ),
            Effect.asVoid,
          )
        return Effect.all([
          models.get({ provider: entry.provider, id: entry.id }),
          models.get({ provider: entry.provider, id: entry.id, variant: "default" }),
        ]).pipe(
          Effect.tap(([implicit, explicit]) => Effect.sync(() => expect(explicit).toEqual(implicit))),
          Effect.asVoid,
        )
      }),
    ).pipe(Effect.provide(Model.layer)),
  )
})

test("resolves provider format defaults and model binding overrides", async () => {
  const direct = await Effect.runPromise(
    Model.Service.use((models) => models.get({ provider: Provider.OpenAI, id: "gpt-5.6" })).pipe(
      Effect.provide(Model.layer),
    ),
  )
  expect(direct.format).toBe("openai")

  const [binding] = openAIBindings.filter(({ id }) => id === "gpt-5.6")
  const overridden = joinRegistry(generatedCatalogFixture, [{ ...binding!, format: "anthropic" }])
  const selected = await Effect.runPromise(
    Model.Service.use((models) => models.get({ provider: Provider.OpenAI, id: "gpt-5.6" })).pipe(
      Effect.provide(Model.makeLayer(overridden)),
    ),
  )
  expect(selected.format).toBe("anthropic")
})

test("fails unknown models and variants before execution", async () => {
  const missing = { provider: Provider.Name.make("missing-provider"), id: "missing" }
  const missingError = await Effect.runPromise(
    Model.Service.use((models) => models.get(missing)).pipe(Effect.provide(Model.layer), Effect.flip),
  )
  expect(missingError).toEqual(new Model.NotFoundError({ model: missing }))

  const variant = { provider: Provider.OpenAI, id: "gpt-5.6", variant: "high" }
  const variantError = await Effect.runPromise(
    Model.Service.use((models) => models.get(variant)).pipe(Effect.provide(Model.layer), Effect.flip),
  )
  expect(variantError).toEqual(new Model.NotFoundError({ model: variant }))
})

describe("joinRegistry", () => {
  test("rejects duplicate catalog rows, duplicate bindings, and bindings without catalog metadata", () => {
    const binding = openAIBindings.filter(({ id }) => id === "gpt-5.6")
    expect(() => joinRegistry([...generatedCatalogFixture, ...generatedCatalogFixture], binding)).toThrow(
      "Duplicate catalog entry: openai/gpt-5.6",
    )
    expect(() => joinRegistry(generatedCatalogFixture, [...binding, ...binding])).toThrow(
      "Duplicate execution binding: openai/gpt-5.6",
    )
    expect(() => joinRegistry([], binding)).toThrow("Execution binding has no catalog entry: openai/gpt-5.6")
    expect(joinRegistry(generatedCatalogFixture, [])).toEqual([])
  })

  test("accepts generated normalized metadata without changing execution bindings", () => {
    const binding = openAIBindings.filter(({ id }) => id === "gpt-5.6")
    const joined = joinRegistry(generatedCatalogFixture, binding)
    expect(joined).toEqual(registry.filter(({ provider, id }) => provider === Provider.OpenAI && id === "gpt-5.6"))
    expect(joined[0]?.options).toBe(binding[0]?.options)
    expect(bindings.find(({ provider, id }) => provider === Provider.OpenAI && id === "gpt-5.6")).toBe(binding[0])
  })
})
