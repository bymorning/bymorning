import { describe, expect, it } from "@effect/vitest"
import { Credential } from "@bymorning/schema/credential"
import { ConfigSchema } from "@bymorning/schema/config"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Effect, Exit, Layer, PubSub, Ref, Scope, Stream } from "effect"
import type { Actor } from "../src/actor.js"
import { Catalog } from "../src/catalog.js"
import { Model } from "../src/model.js"
import { Provider } from "../src/provider.js"
import { Integration } from "../src/integration.js"
import { Config } from "../src/config.js"
import { registry } from "../src/provider/registry.js"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { configService, minimalConfig } from "./service-fixtures.js"
import { offlineIntegration } from "./fixtures/offline-integration.js"

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
      get: () => Effect.die("Catalog invocation must not consult the bundled Model selector"),
      list: Effect.succeed([model]),
    }),
  ),
)

describe("Catalog", () => {
  it.effect("authenticates a model with its own format's native header instead of the Provider's", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const ref = { provider: provider.name, id: model.id }
      const withFormat = (format: "anthropic" | "google" | "openai") =>
        Effect.gen(function* () {
          const override = yield* catalog.transform((editor) => {
            editor.model.update(provider.name, model.id, (entry) => {
              entry.execution = { format }
            })
          })
          const execution = yield* catalog.model.requireExecution(ref)
          yield* override.dispose
          return execution
        })
      const bearer = yield* catalog.model.requireExecution(ref)
      expect(bearer.authentication).toEqual({
        type: "key",
        integration: "test",
        header: "authorization",
        prefix: "Bearer ",
      })
      const anthropic = yield* withFormat("anthropic")
      expect(anthropic.selection.format).toBe("anthropic")
      expect(anthropic.authentication).toEqual({ type: "key", integration: "test", header: "x-api-key" })
      const google = yield* withFormat("google")
      expect(google.authentication).toEqual({ type: "key", integration: "test", header: "x-goog-api-key" })
      // A Provider whose configured header is not its format's own keeps it for every model format.
      const custom = yield* catalog.transform((editor) => {
        editor.provider.update(provider.name, (entry) => {
          entry.execution = { authentication: { type: "key", integration: "test", header: "x-fixture-key" } }
        })
      })
      const kept = yield* withFormat("anthropic")
      expect(kept.authentication).toEqual({ type: "key", integration: "test", header: "x-fixture-key" })
      yield* custom.dispose
      const openai = yield* withFormat("openai")
      expect(openai.authentication).toEqual({
        type: "key",
        integration: "test",
        header: "authorization",
        prefix: "Bearer ",
      })
    }).pipe(
      Effect.provide(
        Catalog.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              dependencies,
              Layer.succeed(
                Integration.Service,
                Integration.Service.of({
                  get: (id: Integration.ID) => Effect.succeed({ id, name: id, connections: [{}] }),
                } as unknown as Integration.Interface),
              ),
              Layer.succeed(Config.Service, configService(minimalConfig)),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("upserts custom rows, snapshots execution overrides, and restores scoped contributions", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const contribution = yield* catalog.transform((editor) => {
        editor.model.update("custom", "local-key", (model) => {
          model.name = "Custom label"
          model.apiID = "upstream-name"
          model.execution = {
            settings: { baseURL: "https://model.example/v1" },
            options: { user: "model" },
            variants: { high: { user: "variant" } },
          }
        })
        editor.provider.update("custom", (provider) => {
          provider.status = "enabled"
          provider.api = ProviderSchema.API.make("https://provider.example/v1")
          provider.execution = { authentication: { type: "none" }, options: { user: "provider", seed: 42 } }
        })
      })
      const ref = { provider: ProviderSchema.Name.make("custom"), id: "local-key" }
      const before = yield* catalog.model.requireExecution({ ...ref, variant: "high" })
      expect(before.selection).toMatchObject({
        info: { apiID: "upstream-name", variants: ["high"] },
        options: { user: "variant", seed: 42 },
        format: "oa-compat",
      })
      expect(before.routing).toEqual({ type: "fixed", baseURL: new URL("https://model.example/v1") })
      expect((yield* catalog.model.requireExecution({ ...ref, variant: "missing" }).pipe(Effect.flip)).reason).toBe(
        "unavailable",
      )
      const override = yield* catalog.transform((editor) => {
        editor.model.update("custom", "local-key", (model) => {
          model.apiID = "replacement"
          model.execution = {
            format: "anthropic",
            settings: { baseURL: "https://replacement.example" },
            options: { user: "replacement" },
          }
        })
      })
      const after = yield* catalog.model.requireExecution(ref)
      expect(after.selection).toMatchObject({
        info: { apiID: "replacement" },
        format: "anthropic",
        package: "@opencode-ai/ai/providers/anthropic",
        options: { user: "replacement", seed: 42 },
      })
      expect(before.selection.info.apiID).toBe("upstream-name")
      expect(before.selection.options.user).toBe("variant")
      yield* override.dispose
      expect((yield* catalog.model.requireExecution(ref)).selection.info.apiID).toBe("upstream-name")
      yield* contribution.dispose
      expect((yield* catalog.model.requireExecution(ref).pipe(Effect.flip)).reason).toBe("unavailable")
    }).pipe(
      Effect.provide(
        Catalog.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              dependencies,
              offlineIntegration,
              Layer.succeed(Config.Service, configService(minimalConfig)),
            ),
          ),
        ),
      ),
    ),
  )
  it.effect("projects only installed static Providers for management", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const directory = yield* catalog.provider.directory()

      expect(directory.map((entry) => entry.info.name)).toEqual([
        ProviderSchema.OpenAI,
        ProviderSchema.Anthropic,
        ProviderSchema.Google,
        ProviderSchema.OpenCode,
        ProviderSchema.Fireworks,
        ProviderSchema.AmazonBedrock,
      ])
      expect(directory.find((entry) => entry.info.name === ProviderSchema.OpenAI)).toMatchObject({
        connected: false,
        connectionCount: 0,
        modelCount: 1,
      })
      expect(directory.every((entry) => entry.integration === undefined)).toBe(true)
      expect(directory.find((entry) => entry.info.name === ProviderSchema.AmazonBedrock)).toMatchObject({
        connected: false,
        connectionCount: 0,
        modelCount: 2,
      })
      expect(directory.some((entry) => String(entry.integration?.id) === "context7")).toBe(false)
    }).pipe(
      Effect.provide(
        Catalog.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                Provider.Service,
                Provider.Service.of({
                  get: () => Effect.die("unused"),
                  list: Effect.succeed(registry.map((entry) => entry.info)),
                  stream: () => Stream.die("unused"),
                }),
              ),
              Layer.succeed(
                Model.Service,
                Model.Service.of({
                  get: () => Effect.die("unused"),
                  list: Effect.succeed([
                    { ...model, provider: ProviderSchema.OpenAI },
                    { ...model, provider: ProviderSchema.AmazonBedrock, id: "amazon.nova-lite-v1:0" },
                    {
                      ...model,
                      provider: ProviderSchema.AmazonBedrock,
                      id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
                    },
                  ]),
                }),
              ),
              Layer.succeed(
                Integration.Service,
                Integration.Service.of({
                  get: (id: Integration.ID) =>
                    Effect.succeed(
                      registry.some((entry) => entry.info.name === String(id))
                        ? Integration.Info.make({
                            id,
                            name: String(id),
                            methods: [],
                            connections:
                              String(id) === ProviderSchema.Bymorning
                                ? [
                                    {
                                      type: "credential",
                                      id: Credential.ID.make("cred_bymorning"),
                                      label: "Personal",
                                    },
                                    { type: "env", name: "BYMORNING_API_KEY" },
                                  ]
                                : String(id) === ProviderSchema.OpenAI
                                  ? [
                                      { type: "env", name: "OPENAI_API_KEY" },
                                      { type: "env", name: "OPENAI_API_KEY_BACKUP" },
                                    ]
                                  : [],
                          })
                        : undefined,
                    ),
                } as unknown as Integration.Interface),
              ),
              Layer.succeed(
                Config.Service,
                Config.Service.of({
                  provider: { update: () => Effect.die("unused") },
                  get: Effect.succeed({ model_policy: { disabled: [], seen: [], initialized: [] } }),
                  update: () => Effect.die("unused"),
                  refresh: Effect.die("unused"),
                  modelPolicy: {
                    reconcile: () => Effect.die("unused"),
                    toggle: () => Effect.die("unused"),
                    setDefault: () => Effect.die("unused"),
                  },
                  plugin: Config.pluginUnavailable,
                  entries: () => Effect.succeed([]),
                  changes: () => Stream.never,
                } as unknown as Config.Interface),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("seeds the editor default-model view from Config", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      let viewed: { providerID: string; modelID: string } | undefined
      yield* catalog.transform((editor) => {
        viewed = editor.model.default.get()
      })
      expect(viewed).toEqual({ providerID: "test", modelID: "base" })
    }).pipe(
      Effect.provide(
        Catalog.layer.pipe(
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
                    default_model: { provider: ProviderSchema.Name.make("test"), id: "base" },
                    permissions: [],
                    compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
                    model_policy: { disabled: [], seen: [], initialized: [] },
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("replays scoped transforms and resolves availability and defaults", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const scope = yield* Scope.make()
      yield* catalog
        .transform((editor) => {
          editor.provider.update("test", (value) => (value.displayName = "Changed"))
          editor.model.default.set("test", "base")
        })
        .pipe(Scope.provide(scope))

      expect((yield* catalog.provider.available())[0]?.displayName).toBe("Changed")
      expect((yield* catalog.model.default())?.id).toBe("base")

      yield* Scope.close(scope, Exit.void)
      expect((yield* catalog.provider.all())[0]?.displayName).toBe("Test")
    }).pipe(
      Effect.provide(
        Catalog.layer.pipe(
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
                Config.Service.of({
                  provider: { update: () => Effect.die("unused") },
                  get: Effect.succeed({ model_policy: { disabled: [], seen: [], initialized: [] } }),
                  update: () => Effect.die("unused"),
                  refresh: Effect.die("unused"),
                  modelPolicy: {
                    reconcile: () => Effect.succeed({ model_policy: { disabled: [], seen: [], initialized: [] } }),
                    initialize: () => Effect.succeed({ model_policy: { disabled: [], initialized: [] } }),
                    toggle: () => Effect.succeed({ model_policy: { disabled: [], initialized: [] } }),
                    setDefault: () => Effect.succeed({ model_policy: { disabled: [], initialized: [] } }),
                  },
                  plugin: Config.pluginUnavailable,
                  entries: () => Effect.succeed([]),
                  changes: () => Stream.never,
                } as unknown as Config.Interface),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("plans Bedrock models in the exact active request region", () => {
    const region = AwsRegion.make("us-west-2")
    const credentialID = Credential.ID.make("cred_bedrock")
    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      for (const id of ["amazon.nova-lite-v1:0", "us.anthropic.claude-haiku-4-5-20251001-v1:0"]) {
        const plan = yield* catalog.model.requireExecution({ provider: ProviderSchema.AmazonBedrock, id })
        expect(plan.selection.info.apiID).toBe(id)
        expect(plan.routing).toEqual({
          type: "aws-bedrock",
          integration: Integration.ID.make(ProviderSchema.AmazonBedrock),
          region,
          connection: { type: "credential", id: credentialID, authKind: "sigv4" },
        })
      }
    }).pipe(
      Effect.provide(
        Catalog.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                Provider.Service,
                Provider.Service.of({
                  get: () => Effect.die("unused"),
                  list: Effect.succeed(
                    registry
                      .filter((entry) => entry.info.name === ProviderSchema.AmazonBedrock)
                      .map((entry) => ({
                        ...entry.info,
                        execution: {
                          authentication: {
                            type: "key" as const,
                            integration: entry.info.name,
                            header: "authorization",
                            prefix: "Bearer ",
                          },
                        },
                      })),
                  ),
                  stream: () => Stream.die("unused"),
                }),
              ),
              Model.layer,
              Layer.succeed(
                Integration.Service,
                Integration.Service.of({
                  get: (id: Integration.ID) =>
                    Effect.succeed({
                      id,
                      name: id,
                      methods: [],
                      connections: [
                        {
                          type: "regional-credential",
                          id: credentialID,
                          label: "Bedrock",
                          authKind: "sigv4",
                          region,
                        },
                      ],
                    }),
                  connection: {
                    active: () =>
                      Effect.succeed({
                        type: "regional-credential",
                        id: credentialID,
                        label: "Bedrock",
                        authKind: "sigv4",
                        region,
                      }),
                  },
                } as unknown as Integration.Interface),
              ),
              Layer.succeed(
                Config.Service,
                Config.Service.of({
                  provider: { update: () => Effect.die("unused") },
                  get: Effect.succeed({ model_policy: { disabled: [], seen: [], initialized: [] } }),
                  changes: () => Stream.never,
                } as unknown as Config.Interface),
              ),
            ),
          ),
        ),
      ),
    )
  })

  it.effect("exposes every connected catalog model including Mantle", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const visible = yield* catalog.model.visible()
      const available = yield* catalog.model.available()

      expect(visible).toHaveLength(121 + govCloudProfiles)
      expect(available).toHaveLength(121)
      expectCommercial(visible)
      const mantle = yield* catalog.model.requireExecution({
        provider: ProviderSchema.AmazonBedrock,
        id: "openai.gpt-5.4",
      })
      expect(mantle.package).toBe("@opencode-ai/ai/providers/amazon-bedrock/mantle")
      expect(yield* catalog.model.default()).toBeDefined()
    }).pipe(Effect.provide(bedrockCatalogLayer(AwsRegion.make("us-east-1"), true))),
  )

  it.effect("hides disconnected Bedrock metadata", () =>
    Effect.gen(function* () {
      const disconnected = yield* Catalog.Service
      expect(yield* disconnected.model.visible()).toEqual([])
    }).pipe(Effect.provide(bedrockCatalogLayer(AwsRegion.make("us-east-1"), false, "auto"))),
  )

  it.effect("allows commercial regions without local regional approval", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const visible = yield* catalog.model.visible()
      expectCommercial(visible)
      expect(yield* catalog.model.available()).toHaveLength(121)
      expect(yield* catalog.model.default()).toBeDefined()
    }).pipe(Effect.provide(bedrockCatalogLayer(AwsRegion.make("eu-central-1"), true))),
  )

  it.effect("offers GovCloud inference profiles and refuses IDs GovCloud cannot invoke", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const visible = yield* catalog.model.visible()
      const reason = (id: string) => {
        const row = visible.find(({ info }) => info.id === id)
        expect(row, id).toBeDefined()
        return row?.unavailableReason
      }
      expect(reason(`us-gov.${sonnet}`)).toBeUndefined()
      expect(visible.find(({ info }) => info.id === `us-gov.${sonnet}`)?.info).toMatchObject({
        apiID: `us-gov.${sonnet}`,
        name: "Claude Sonnet 4.5 (US GovCloud)",
      })
      expect(reason(`us.${sonnet}`)).toBe("region-unsupported")
      expect(reason(sonnet)).toBe("region-unsupported")
      expect(reason("anthropic.claude-opus-5")).toBe("region-unsupported")
      const global = visible.filter(({ info }) => info.id.startsWith("global."))
      expect(global.length).toBeGreaterThan(0)
      expect(global.every(({ unavailableReason }) => unavailableReason === "region-unsupported")).toBe(true)
      const gov = visible.filter(({ info }) => info.id.startsWith("us-gov."))
      expect(gov).toHaveLength(govCloudProfiles)
      expect(gov.every(({ unavailableReason }) => unavailableReason === undefined)).toBe(true)
      // The default is the first documented GovCloud profile, never an undocumented one.
      expect((yield* catalog.model.default())?.id).toBe(`us-gov.${sonnet}`)
      expect(visible.find(({ isEffectiveDefault }) => isEffectiveDefault)?.info.id).toBe(`us-gov.${sonnet}`)
      expect(visible.some(({ info }) => info.id === "us-gov.anthropic.claude-fable-5")).toBe(false)
      const refused = yield* catalog.model
        .requireExecution({ provider: ProviderSchema.AmazonBedrock, id: "anthropic.claude-opus-5" })
        .pipe(Effect.flip)
      expect(refused.reason).toBe("region-unsupported")
    }).pipe(Effect.provide(bedrockCatalogLayer(AwsRegion.make("us-gov-west-1"), true))),
  )

  it.effect("keeps the commercial default and hides GovCloud profiles in a commercial Region", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const visible = yield* catalog.model.visible()
      expectCommercial(visible)
      expect(visible.find(({ info }) => info.id === `us-gov.${sonnet}`)?.unavailableReason).toBe("region-unsupported")
      expect(visible.find(({ info }) => info.id === `us.${sonnet}`)?.unavailableReason).toBeUndefined()
      expect((yield* catalog.model.default())?.id).toBe("amazon.nova-2-lite-v1:0")
    }).pipe(Effect.provide(bedrockCatalogLayer(AwsRegion.make("us-east-1"), true))),
  )

  it.effect("keeps management unavailable reasons within the public schema", () =>
    Effect.gen(function* () {
      const disconnected = yield* Catalog.Service.use((catalog) => catalog.model.visible()).pipe(
        Effect.provide(bedrockCatalogLayer(AwsRegion.make("us-east-1"), false, "auto")),
      )
      expect(disconnected).toEqual([])

      const providerDisabled = yield* Catalog.Service.use((catalog) =>
        catalog.model.visible(ProviderSchema.AmazonBedrock),
      ).pipe(Effect.provide(bedrockCatalogLayer(AwsRegion.make("us-east-1"), true, "disabled")))
      expect(providerDisabled).toHaveLength(121 + govCloudProfiles)
      expect(providerDisabled.every(({ unavailableReason }) => unavailableReason === "provider-disabled")).toBe(true)

      const policyDisabled = yield* Catalog.Service.use((catalog) => catalog.model.visible()).pipe(
        Effect.provide(
          bedrockCatalogLayer(AwsRegion.make("us-east-1"), true, "enabled", [
            { provider: ProviderSchema.AmazonBedrock, id: "amazon.nova-lite-v1:0" },
          ]),
        ),
      )
      expect(policyDisabled.find(({ info }) => info.id === "amazon.nova-lite-v1:0")).toMatchObject({
        enabled: false,
      })
      expect(policyDisabled.find(({ info }) => info.id === "amazon.nova-lite-v1:0")).not.toHaveProperty(
        "unavailableReason",
      )
      expect(policyDisabled.find(({ info }) => info.id === "openai.gpt-5.4")).not.toHaveProperty("unavailableReason")
      expect(() => policyDisabled.map((row) => ModelSchema.Management.make(row))).not.toThrow()
    }),
  )
})

const sonnet = "anthropic.claude-sonnet-4-5-20250929-v1:0"
/** Bundled `us-gov.` rows: the documented GovCloud profiles. */
const govCloudProfiles = 6

/** In a commercial Region only the derived `us-gov.` profiles are refused. */
function expectCommercial(visible: ReadonlyArray<ModelSchema.Management>) {
  for (const { info, unavailableReason } of visible)
    expect(unavailableReason, info.id).toBe(info.id.startsWith("us-gov.") ? "region-unsupported" : undefined)
  expect(visible.filter(({ info }) => info.id.startsWith("us-gov."))).toHaveLength(govCloudProfiles)
}

function bedrockCatalogLayer(
  region: AwsRegion,
  connected: boolean,
  status: "auto" | "enabled" | "disabled" = "enabled",
  disabled: ReadonlyArray<ModelSchema.Identity> = [],
) {
  const base = registry.find(({ info }) => info.name === ProviderSchema.AmazonBedrock)!.info
  const info = {
    ...base,
    status,
    execution: {
      authentication: { type: "key" as const, integration: base.name, header: "authorization", prefix: "Bearer " },
    },
  }
  const connection = {
    type: "regional-env" as const,
    authKind: "sigv4" as const,
    region,
  }
  return Catalog.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          Provider.Service,
          Provider.Service.of({
            get: () => Effect.succeed(info),
            list: Effect.succeed([info]),
            stream: () => Stream.die("unused"),
          }),
        ),
        Model.layer,
        Layer.succeed(
          Integration.Service,
          Integration.Service.of({
            get: (id: Integration.ID) =>
              Effect.succeed({ id, name: id, methods: [], connections: connected ? [connection] : [] }),
            connection: { active: () => Effect.succeed(connected ? connection : undefined) },
          } as unknown as Integration.Interface),
        ),
        Layer.succeed(
          Config.Service,
          Config.Service.of({
            provider: { update: () => Effect.die("unused") },
            get: Effect.succeed({ model_policy: { disabled, seen: [], initialized: [] } }),
            changes: () => Stream.never,
            modelPolicy: {
              reconcile: () => Effect.die("unused"),
              toggle: () => Effect.die("unused"),
              setDefault: () => Effect.die("unused"),
            },
          } as unknown as Config.Interface),
        ),
      ),
    ),
  )
}

/** Workspace Config fake whose custom Models behave like the persisted authority. */
const customConfig = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<void>()
  const current = yield* Ref.make<ConfigSchema.Info>(minimalConfig)
  const same = (a: ModelSchema.Identity) => (b: ModelSchema.Identity) => a.provider === b.provider && a.id === b.id
  const commit = (update: (info: ConfigSchema.Info) => ConfigSchema.Info) =>
    Ref.updateAndGet(current, update).pipe(Effect.tap(() => PubSub.publish(events, undefined)))
  const service = Config.Service.of({
    ...configService(minimalConfig),
    get: Ref.get(current),
    changes: () => Stream.fromPubSub(events),
    model: {
      put: (model) =>
        commit((info) => ({ ...info, models: [...(info.models ?? []).filter((entry) => !same(model)(entry)), model] })),
      remove: (model) =>
        commit((info) => ({
          ...info,
          models: (info.models ?? []).filter((entry) => !same(model)(entry)),
          model_policy: {
            ...info.model_policy,
            disabled: info.model_policy.disabled.filter((entry) => !same(model)(entry)),
          },
        })),
    },
  })
  return { layer: Layer.succeed(Config.Service, service), commit }
})

describe("Catalog custom Models", () => {
  const admin = {} as Actor.Info
  const connected = Layer.succeed(
    Integration.Service,
    Integration.Service.of({
      get: (id: Integration.ID) => Effect.succeed({ id, name: id, connections: [{}] }),
    } as unknown as Integration.Interface),
  )
  const run = <A, E>(
    body: (
      commit: (update: (info: ConfigSchema.Info) => ConfigSchema.Info) => Effect.Effect<ConfigSchema.Info>,
    ) => Effect.Effect<A, E, Catalog.Service | Scope.Scope>,
  ) =>
    Effect.gen(function* () {
      const config = yield* customConfig
      return yield* body(config.commit).pipe(
        Effect.provide(Catalog.layer.pipe(Layer.provide(Layer.mergeAll(dependencies, connected, config.layer)))),
      )
    }).pipe(Effect.scoped)

  it.effect("adds a custom Model keyed by its upstream name with stated prices and context limit", () =>
    run(() =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const created = yield* catalog.model.create(
          {
            provider: provider.name,
            name: "Sonnet (GovCloud)",
            apiID: "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
            cost: { input: 3, output: 15 },
            limit: { context: 200_000 },
          },
          admin,
        )
        expect(created).toMatchObject({
          custom: true,
          enabled: true,
          info: {
            id: "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
            name: "Sonnet (GovCloud)",
            apiID: "us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0",
            cost: { input: 3, output: 15 },
            limit: { context: 200_000 },
          },
        })
        // Omitted metadata stays unknown rather than asserted.
        expect(created.info.cost.cache).toEqual({})
        expect(created.info.limit.output).toBeUndefined()
        expect(created.info.capabilities).toEqual({ input: [], output: [] })
        const execution = yield* catalog.model.requireExecution({ provider: provider.name, id: created.info.id })
        expect(execution.selection.info.apiID).toBe("us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0")
        const visible = yield* catalog.model.visible()
        expect(visible.find((row) => row.info.id === "base")?.custom).toBeUndefined()
      }),
    ),
  )

  it.effect("refuses a used key and an unknown Provider without writing Config", () =>
    run(() =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const bundled = yield* catalog.model
          .create({ provider: provider.name, id: "base", name: "Shadow", apiID: "elsewhere" }, admin)
          .pipe(Effect.flip)
        expect(bundled).toBeInstanceOf(Catalog.ConflictError)
        expect(bundled).toMatchObject({ model: { provider: "test", id: "base" } })
        // The default key collides too: the upstream name equals the bundled key.
        expect(
          yield* catalog.model
            .create({ provider: provider.name, name: "Again", apiID: "base" }, admin)
            .pipe(Effect.flip),
        ).toBeInstanceOf(Catalog.ConflictError)
        yield* catalog.model.create({ provider: provider.name, id: "mine", name: "Mine", apiID: "upstream" }, admin)
        expect(
          yield* catalog.model
            .create({ provider: provider.name, id: "mine", name: "Mine twice", apiID: "other" }, admin)
            .pipe(Effect.flip),
        ).toBeInstanceOf(Catalog.ConflictError)
        const missing = yield* catalog.model
          .create({ provider: ProviderSchema.Name.make("absent"), name: "Nowhere", apiID: "x" }, admin)
          .pipe(Effect.flip)
        expect(missing).toBeInstanceOf(Catalog.NotFoundError)
        expect((yield* catalog.model.get(provider.name, "base"))?.apiID).toBe("base")
      }),
    ),
  )

  it.effect("updates and deletes only custom Models, preserving identity", () =>
    run(() =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.model.create({ provider: provider.name, id: "mine", name: "Mine", apiID: "v1" }, admin)
        const updated = yield* catalog.model.update(
          { provider: provider.name, id: "mine", name: "Renamed", apiID: "v2", cost: { input: 1 } },
          admin,
        )
        expect(updated.info).toMatchObject({ id: "mine", name: "Renamed", apiID: "v2", cost: { input: 1 } })
        expect(
          (yield* catalog.model.requireExecution({ provider: provider.name, id: "mine" })).selection.info.apiID,
        ).toBe("v2")
        const bundled = { provider: provider.name, id: "base" }
        expect(
          yield* catalog.model.update({ ...bundled, name: "Base", apiID: "base" }, admin).pipe(Effect.flip),
        ).toBeInstanceOf(Catalog.MissingError)
        expect(yield* catalog.model.delete(bundled, admin).pipe(Effect.flip)).toBeInstanceOf(Catalog.MissingError)
        yield* catalog.model.delete({ provider: provider.name, id: "mine" }, admin)
        expect(yield* catalog.model.get(provider.name, "mine")).toBeUndefined()
        expect(
          yield* catalog.model.delete({ provider: provider.name, id: "mine" }, admin).pipe(Effect.flip),
        ).toBeInstanceOf(Catalog.MissingError)
        expect(yield* catalog.model.get(provider.name, "base")).toBeDefined()
      }),
    ),
  )

  it.effect("applies explicit configuration over Plugin contributions and follows external Config changes", () =>
    run((commit) =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.model.create({ provider: provider.name, id: "mine", name: "Mine", apiID: "configured" }, admin)
        // A later contribution under the same key keeps its metadata but not the label or destination.
        yield* catalog.transform((editor) => {
          editor.model.update(provider.name, "mine", (model) => {
            model.name = "Contributed"
            model.apiID = "contributed"
            model.limit.output = 4096
          })
        })
        expect(yield* catalog.model.get(provider.name, "mine")).toMatchObject({
          name: "Mine",
          apiID: "configured",
          limit: { output: 4096 },
        })
        // Another Gateway task commits a change; this Catalog follows the change notification.
        yield* commit((info) => ({
          ...info,
          models: [{ provider: provider.name, id: "mine", name: "Elsewhere", apiID: "remote" }],
        }))
        // Wait on the forked change subscriber without a wall-clock delay.
        for (let turn = 0; turn < 100 && (yield* catalog.model.get(provider.name, "mine"))?.apiID !== "remote"; turn++)
          yield* Effect.yieldNow
        expect((yield* catalog.model.get(provider.name, "mine"))?.apiID).toBe("remote")
      }),
    ),
  )
})
