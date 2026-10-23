const emptyProvider = (providerID: string): CatalogProviderRecord => ({
  provider: {
    name: Name.make(providerID),
    displayName: providerID,
    api: API.make(""),
    format: "oa-compat",
    status: "disabled",
  },
  models: new Map<string, ModelRow>(),
})

const emptyModel = (providerID: string, modelID: string): ModelRow => ({
  id: modelID,
  provider: Name.make(providerID),
  apiID: modelID,
  name: modelID,
  description: "",
  status: "active",
  releaseDate: "",
  lastUpdated: "",
  capabilities: { input: [], output: [] },
  variants: [],
  limit: {},
  cost: { cache: {} },
})

export * as Catalog from "./catalog.js"

import type { CatalogEditor, CatalogProviderRecord } from "@bymorning/plugin/effect/catalog"
import type { Config as ConfigSchema } from "@bymorning/schema/config"
import type { AwsRegion } from "@bymorning/schema/aws-region"
import type { Connection } from "@bymorning/schema/connection"
import type { CustomInput, Identity, Info as ModelInfo, ToggleInput } from "@bymorning/schema/model"
import { Custom, Management, Ref } from "@bymorning/schema/model"
import type { Authentication, Info as ProviderInfo, UpdateInput } from "@bymorning/schema/provider"
import { API, AmazonBedrock, DirectoryEntry, Name } from "@bymorning/schema/provider"
import { Context, Effect, Layer, MutableRef, Option, Schema, Stream } from "effect"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { State } from "./state.js"
import { Integration } from "./integration.js"
import { Config } from "./config.js"
import type { Actor } from "./actor.js"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import type { ProviderPackage } from "@opencode-ai/ai/provider-package"
import { packages } from "./catalog/transport.js"
import { bedrockRegion } from "./catalog/region.js"
export class ModelUnavailableError extends Schema.TaggedError<ModelUnavailableError>()(
  "Catalog.ModelUnavailableError",
  {
    model: Ref,
    reason: Schema.optionalKey(
      Schema.Literals([
        "unavailable",
        "provider-inactive",
        "provider-disabled",
        "transport-unsupported",
        "region-unsupported",
        "connection-unavailable",
      ]),
    ),
  },
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Catalog.NotFoundError", {
  provider: Name,
}) {}

const IdentitySchema = Schema.Struct({ provider: Name, id: Schema.String })

/** The Provider already has a Model under the requested key. */
export class ConflictError extends Schema.TaggedError<ConflictError>()("Catalog.ConflictError", {
  model: IdentitySchema,
}) {}

/** No Workspace-configured custom Model has this identity; bundled and contributed Models can only be disabled. */
export class MissingError extends Schema.TaggedError<MissingError>()("Catalog.MissingError", {
  model: IdentitySchema,
}) {}

/** Authentication selected for an Amazon Bedrock execution. */
export type BedrockConnection =
  | {
      readonly type: "credential"
      readonly id: Extract<Connection.Info, { readonly type: "regional-credential" }>["id"]
      readonly authKind: "bearer" | "sigv4"
    }
  | { readonly type: "env"; readonly authKind: "bearer" | "sigv4" }
  | { readonly type: "deployment"; readonly authKind: "sigv4" }

/** Effective Catalog configuration selected for one Model invocation. */
export interface Execution {
  readonly implementation: ProviderPackage.Definition
  readonly authentication: Authentication
  readonly selection: Model.Selection
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
  readonly routing:
    | {
        readonly type: "fixed"
        /**
         * Effective fixed endpoint from the shared Workspace Catalog.
         *
         * `requireExecution` populates this from the effective Model and Provider
         * records so Plugin routing transforms (for example a nativeAPI override)
         * reach Gateway destination resolution. `ModelResolver.native` fails
         * closed with `transport-unsupported` when it is absent instead of
         * substituting a bundled production endpoint.
         */
        readonly baseURL?: URL
      }
    | {
        readonly type: "aws-bedrock"
        readonly integration: Integration.ID
        readonly region: AwsRegion
        readonly connection: BedrockConnection
      }
}

interface Data {
  readonly providers: Map<string, CatalogProviderRecord>
  defaultModel?: { providerID: string; modelID: string }
}

type ModelRow = NonNullable<ReturnType<CatalogEditor["model"]["get"]>>
type ProviderRow = CatalogProviderRecord["provider"]

export interface Interface extends State.Transformable<CatalogEditor> {
  readonly provider: {
    readonly get: (providerID: string) => Effect.Effect<ProviderInfo | undefined>
    readonly all: () => Effect.Effect<ProviderInfo[]>
    readonly available: () => Effect.Effect<ProviderInfo[]>
    readonly directory: () => Effect.Effect<DirectoryEntry[]>
    readonly update: (input: UpdateInput, actor: Actor.Info) => Effect.Effect<ProviderInfo, NotFoundError | Config.StorageError | Actor.ForbiddenError>
  }
  readonly model: {
    readonly get: (providerID: string, modelID: string) => Effect.Effect<ModelInfo | undefined>
    readonly all: () => Effect.Effect<ModelInfo[]>
    readonly available: () => Effect.Effect<ModelInfo[]>
    readonly visible: (providerID?: string) => Effect.Effect<Management[]>
    readonly requireAvailable: (model: Ref) => Effect.Effect<ModelInfo, ModelUnavailableError>
    readonly requireExecution: (model: Ref) => Effect.Effect<Execution, ModelUnavailableError>
    readonly toggle: (input: ToggleInput, actor: Actor.Info) => Effect.Effect<Management[], ModelUnavailableError | Actor.ForbiddenError>
    readonly setDefault: (model: Identity, actor: Actor.Info) => Effect.Effect<Management[], ModelUnavailableError | Actor.ForbiddenError>
    readonly default: () => Effect.Effect<ModelInfo | undefined>
    /** Add a Workspace-configured custom Model to an existing Provider. Its key defaults to its upstream model name. */
    readonly create: (
      input: CustomInput,
      actor: Actor.Info,
    ) => Effect.Effect<Management, ConflictError | NotFoundError | Config.StorageError | Actor.ForbiddenError>
    /** Replace a custom Model's label, upstream model name, prices, and context limit; its identity is fixed. */
    readonly update: (
      input: Custom,
      actor: Actor.Info,
    ) => Effect.Effect<Management, MissingError | Config.StorageError | Actor.ForbiddenError>
    /** Remove a custom Model and its Workspace enablement state. */
    readonly delete: (
      model: Identity,
      actor: Actor.Info,
    ) => Effect.Effect<void, MissingError | Config.StorageError | Actor.ForbiddenError>
  }
}

/** Replayable Provider and Model catalog authority. */
// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Catalog") {}

/**
 * The credential header each wire format reads. A model that overrides its
 * Provider's format (an aggregator such as OpenCode Zen) is served by that
 * format's native endpoint, which ignores the Provider-level header.
 */
const formatHeaders = new Map<ProviderInfo["format"], { header: string; prefix?: string }>([
  ["anthropic", { header: "x-api-key" }],
  ["google", { header: "x-goog-api-key" }],
  ["openai", { header: "authorization", prefix: "Bearer " }],
  ["oa-compat", { header: "authorization", prefix: "Bearer " }],
])

const authenticationFor = (
  defaults: Authentication,
  providerFormat: ProviderInfo["format"],
  modelFormat: ProviderInfo["format"] | undefined,
): Authentication => {
  if (defaults.type !== "key" || modelFormat === undefined || modelFormat === providerFormat) {
    return structuredClone(defaults)
  }
  const providerNative = formatHeaders.get(providerFormat)
  const modelNative = formatHeaders.get(modelFormat)
  // An explicitly configured header (one that is not the Provider format's own) is authoritative.
  const explicit = providerNative === undefined || providerNative.header !== defaults.header.toLowerCase()
  if (explicit || modelNative === undefined || modelNative.header === defaults.header.toLowerCase()) {
    return structuredClone(defaults)
  }
  const { prefix: _prefix, ...rest } = defaults
  return {
    ...rest,
    header: modelNative.header,
    ...(modelNative.prefix === undefined ? {} : { prefix: modelNative.prefix }),
  }
}

/**
 * Project Workspace-configured custom Models onto a rebuilt Catalog. A custom
 * Model whose key a bundled or contributed Model later takes overrides that
 * Model's label, upstream name, and stated prices and context limit. A custom
 * Model whose Provider has left the Catalog is skipped until it returns.
 */
const applyCustom = (data: Data, custom: ReadonlyArray<Custom>): Data => {
  for (const model of custom) {
    const record = data.providers.get(model.provider)
    if (!record) continue
    const row = record.models.get(model.id) ?? emptyModel(model.provider, model.id)
    row.name = model.name
    row.apiID = model.apiID
    if (model.cost?.input !== undefined) row.cost.input = model.cost.input
    if (model.cost?.output !== undefined) row.cost.output = model.cost.output
    if (model.limit?.context !== undefined) row.limit.context = model.limit.context
    ;(record.models as Map<string, ModelRow>).set(model.id, row)
  }
  return data
}

const layerWith = (coordinator?: State.Coordinator) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const integrations = yield* Integration.Service
      const config = yield* Config.Service
      const stateCoordinator = coordinator ?? State.makeCoordinator()
      // Editor-view twin of the live `model.default()` resolution below, seeded from the same Config row.
      const configuredDefault = yield* Config.follow((info) =>
        info.default_model === undefined
          ? undefined
          : { providerID: info.default_model.provider, modelID: info.default_model.id },
      )
      // Explicit Workspace configuration applies after Plugin contributions.
      const customModels = MutableRef.make<ReadonlyArray<Custom>>((yield* config.get).models ?? [])
      const baseProviders = yield* providers.list
      const baseModels = yield* models.list
      const initial = () => {
        const records = new Map<string, CatalogProviderRecord>()
        for (const provider of baseProviders) {
          records.set(provider.name, { provider: structuredClone(provider) as ProviderRow, models: new Map() })
        }
        for (const model of baseModels) {
          const record = records.get(model.provider)
          if (record) {
            const entries = record.models as Map<string, ModelRow>
            entries.set(model.id, structuredClone(model) as ModelRow)
          }
        }
        return { providers: records } satisfies Data
      }
      const state = State.create<Data, CatalogEditor>({
        name: "catalog",
        coordinator: stateCoordinator,
        initial,
        seal: (data) => applyCustom(data, MutableRef.get(customModels)),
        editor: (data) => ({
          provider: {
            list: () => Array.from(data.providers.values()),
            get: (providerID) => data.providers.get(providerID),
            update: (providerID, update) => {
              const record =
                data.providers.get(providerID) ?? emptyProvider(providerID)
              if (!data.providers.has(providerID)) data.providers.set(providerID, record)
              const format = record.provider.format
              const runtime = record.provider.execution?.package
              update(record.provider)
              if (
                format !== record.provider.format &&
                runtime === record.provider.execution?.package &&
                record.provider.execution
              )
                delete record.provider.execution.package
              record.provider.name = Name.make(providerID)
            },
            remove: (providerID) => {
              data.providers.delete(providerID)
            },
          },
          model: {
            get: (providerID, modelID) => data.providers.get(providerID)?.models.get(modelID),
            update: (providerID, modelID, update) => {
              const record =
                data.providers.get(providerID) ?? emptyProvider(providerID)
              if (!data.providers.has(providerID)) data.providers.set(providerID, record)
              const model =
                record.models.get(modelID) ?? emptyModel(providerID, modelID)
              const format = model.execution?.format
              const runtime = model.execution?.package
              update(model)
              if (format !== model.execution?.format && runtime === model.execution?.package && model.execution)
                delete model.execution.package
              model.id = modelID
              model.provider = Name.make(providerID)
              if (model.execution?.variants) model.variants = Object.keys(model.execution.variants)
              ;(record.models as Map<string, ModelRow>).set(modelID, model)
            },
            remove: (providerID, modelID) => {
              const entries = data.providers.get(providerID)?.models as Map<string, ModelRow> | undefined
              entries?.delete(modelID)
            },
            default: {
              get: () => MutableRef.get(configuredDefault) ?? data.defaultModel,
              set: (providerID, modelID) => {
                data.defaultModel = { providerID, modelID }
              },
            },
          },
        }),
      })
      /**
       * Install the custom Models of a committed Config and rebuild. A change
       * notification may already have installed the same value, but a write
       * still rebuilds so its own result is observable when it returns.
       */
      const installCustom = (next: ReadonlyArray<Custom>, force = false) =>
        Effect.suspend(() => {
          if (!force && JSON.stringify(next) === JSON.stringify(MutableRef.get(customModels))) return Effect.void
          MutableRef.set(customModels, next)
          return state.reload()
        })
      yield* state.reload()
      yield* config.changes().pipe(
        Stream.runForEach(() => Effect.flatMap(config.get, (info) => installCustom(info.models ?? []))),
        Effect.forkScoped({ startImmediately: true }),
      )
      // Close the race between the first read and establishing the subscription.
      yield* Effect.flatMap(config.get, (info) => installCustom(info.models ?? []))
      const isCustom = (model: Identity) =>
        MutableRef.get(customModels).some((entry) => entry.provider === model.provider && entry.id === model.id)
      const allProviders = () => Array.from(state.get().providers.values(), (record) => record.provider)
      const allModels = () =>
        Array.from(state.get().providers.values()).flatMap((record) => Array.from(record.models.values()))
      const effectiveProvider = (provider: ProviderRow, current: ConfigSchema.Info): ProviderInfo => ({
        ...provider,
        status: current.providers?.activation?.[provider.name] ?? provider.status,
      })
      const providerProjection = Effect.fn("Catalog.provider.projection")(function* (provider: ProviderRow) {
        const current = yield* config.get
        const info = effectiveProvider(provider, current)
        const auth = info.execution?.authentication
        const selection = { deployment: info.status === "enabled" ? "allow" : "omit" } as const
        const integration =
          auth?.type === "key"
            ? yield* integrations.get(Integration.ID.make(auth.integration), selection).pipe(Effect.orDie)
            : undefined
        const connected =
          auth?.type === "none" ||
          (info.name === AmazonBedrock && info.status === "auto"
            ? (integration?.connections.some(
                (connection) => connection.type === "regional-credential" || connection.type === "regional-env",
              ) ?? false)
            : (integration?.connections.length ?? 0) > 0)
        const active = info.status === "enabled" || (info.status === "auto" && connected)
        return { info, integration, connected, active }
      })
      const activeProviders = Effect.fn("Catalog.active")(function* () {
        const result = new Set<string>()
        for (const provider of allProviders()) {
          if ((yield* providerProjection(provider)).active) result.add(provider.name)
        }
        return result
      })
      const requireExecution = Effect.fn("Catalog.model.requireExecution")(function* (model: Ref) {
        const info = state.get().providers.get(model.provider)?.models.get(model.id)
        if (!info) return yield* new ModelUnavailableError({ model, reason: "unavailable" })
        const providerRow = state.get().providers.get(info.provider)?.provider
        if (!providerRow) return yield* new ModelUnavailableError({ model, reason: "unavailable" })
        const projection = yield* providerProjection(providerRow)
        const provider = projection.info
        if (!projection.active)
          return yield* new ModelUnavailableError({
            model,
            reason: provider.status === "disabled" ? "provider-disabled" : "provider-inactive",
          })
        const defaults = provider.execution
        const override = info.execution
        const format = override?.format ?? provider.format
        const runtime =
          override?.package === null
            ? undefined
            : (override?.package ??
              (override?.format === undefined ? defaults?.package : undefined) ??
              (defaults === undefined
                ? undefined
                : {
                    openai: "@opencode-ai/ai/providers/openai/responses",
                    anthropic: "@opencode-ai/ai/providers/anthropic",
                    google: "@opencode-ai/ai/providers/google",
                    "oa-compat": "@opencode-ai/ai/providers/openai-compatible",
                    "bedrock-converse": "@opencode-ai/ai/providers/amazon-bedrock",
                  }[format]))
        if (!runtime || !defaults) return yield* new ModelUnavailableError({ model, reason: "transport-unsupported" })
        const implementation = packages[runtime]
        if (!implementation) return yield* new ModelUnavailableError({ model, reason: "transport-unsupported" })
        const variant =
          model.variant === undefined || model.variant === "default" ? {} : override?.variants?.[model.variant]
        if (variant === undefined) return yield* new ModelUnavailableError({ model, reason: "unavailable" })
        const selection = {
          info: structuredClone(info),
          format,
          package: runtime,
          settings: structuredClone({ ...defaults.settings, ...override?.settings }),
          options: structuredClone({ ...defaults.options, ...override?.options, ...variant }),
        } satisfies Model.Selection
        const current = yield* config.get
        if (
          current.model_policy.disabled.some(
            (candidate) => candidate.provider === model.provider && candidate.id === model.id,
          )
        )
          return yield* new ModelUnavailableError({ model, reason: "unavailable" })
        const authentication = authenticationFor(defaults.authentication, provider.format, override?.format)
        const integrationID = Integration.ID.make(
          authentication.type === "key" ? authentication.integration : provider.name,
        )
        if (authentication.type === "key") {
          const integration = yield* integrations
            .get(integrationID, { deployment: provider.status === "enabled" ? "allow" : "omit" })
            .pipe(Effect.orDie)
          if (!integration || integration.connections.length === 0)
            return yield* new ModelUnavailableError({ model, reason: "connection-unavailable" })
        }
        const binding = {
          selection,
          implementation,
          authentication,
          package: selection.package,
          settings: selection.settings,
        }
        if (provider.name !== AmazonBedrock) {
          const api = typeof selection.settings.baseURL === "string" ? selection.settings.baseURL : provider.api
          if (api === undefined) return yield* new ModelUnavailableError({ model, reason: "transport-unsupported" })
          const baseURL = yield* Effect.try({
            try: () => new URL(api),
            catch: () => new ModelUnavailableError({ model, reason: "transport-unsupported" }),
          })
          return { ...binding, routing: { type: "fixed", baseURL } } satisfies Execution
        }
        const active = yield* integrations.connection.active(integrationID, {
          deployment: provider.status === "enabled" ? "allow" : "omit",
        })
        if (
          !active ||
          (active.type !== "regional-credential" &&
            active.type !== "regional-env" &&
            active.type !== "regional-deployment")
        )
          return yield* new ModelUnavailableError({ model, reason: "connection-unavailable" })
        // Judge the upstream ID the Bedrock request actually sends, so custom and Plugin Models are covered too.
        const siblings = new Set(
          Array.from(state.get().providers.get(info.provider)?.models.values() ?? [], (entry) => entry.apiID),
        )
        if (!bedrockRegion(selection.info.apiID, active.region, siblings))
          return yield* new ModelUnavailableError({ model, reason: "region-unsupported" })
        return {
          ...binding,
          routing: {
            type: "aws-bedrock",
            integration: integrationID,
            region: active.region,
            connection:
              active.type === "regional-credential"
                ? { type: "credential", id: active.id, authKind: active.authKind }
                : active.type === "regional-deployment"
                  ? { type: "deployment", authKind: "sigv4" }
                  : { type: "env", authKind: active.authKind },
          },
        } satisfies Execution
      })
      const usable = Effect.fn("Catalog.usable")(function* () {
        const online = yield* activeProviders()
        const models = allModels().filter((model) => online.has(model.provider))
        const availability = yield* Effect.forEach(models, (model) => Effect.option(requireExecution(model)), {
          concurrency: 16,
        })
        return models.filter((_, index) => Option.isSome(availability[index] ?? Option.none()))
      })
      const management = Effect.fn("Catalog.management")(function* (providerID?: string) {
        const online = yield* activeProviders()
        const current = yield* config.get
        const disabled = new Set(current.model_policy.disabled.map((model) => `${model.provider}\0${model.id}`))
        const available = yield* usable()
        const effective =
          available.find(
            (model) => model.provider === current.default_model?.provider && model.id === current.default_model.id,
          ) ?? available[0]
        const models =
          providerID === undefined
            ? allModels().filter((model) => online.has(model.provider))
            : Array.from(state.get().providers.get(providerID)?.models.values() ?? [])
        const availability = yield* Effect.forEach(
          models,
          (model) => requireExecution(model).pipe(Effect.flip, Effect.option),
          { concurrency: 16 },
        )
        return models.map((info, index) => {
          const unavailable = availability[index] ?? Option.none()
          const reason = Option.getOrUndefined(unavailable)?.reason
          const unavailableReason =
            reason === "provider-disabled" ||
            reason === "provider-inactive" ||
            reason === "transport-unsupported" ||
            reason === "region-unsupported" ||
            reason === "connection-unavailable"
              ? reason
              : undefined
          return Management.make({
            info,
            enabled: !disabled.has(`${info.provider}\0${info.id}`),
            isPreferredDefault:
              current.default_model?.provider === info.provider && current.default_model.id === info.id,
            isEffectiveDefault: effective?.provider === info.provider && effective.id === info.id,
            ...(unavailableReason === undefined ? {} : { unavailableReason }),
            ...(isCustom(info) ? { custom: true } : {}),
          })
        })
      })

      /** The management row of a custom Model just written; its Provider may be inactive, so it is looked up directly. */
      const managed = Effect.fn("Catalog.model.managed")(function* (model: Identity) {
        const row = (yield* management(model.provider)).find((entry) => entry.info.id === model.id)
        if (!row) return yield* Effect.die(new Error(`Custom Model ${model.provider}/${model.id} was not projected`))
        return row
      })
      return Service.of({
        transform: state.transform,
        reload: state.reload,
        provider: {
          get: (providerID) => {
            const provider = state.get().providers.get(providerID)?.provider
            return provider === undefined
              ? Effect.succeed(undefined)
              : providerProjection(provider).pipe(Effect.map((x) => x.info))
          },
          all: () =>
            Effect.forEach(allProviders(), (provider) => providerProjection(provider).pipe(Effect.map((x) => x.info))),
          available: () =>
            Effect.forEach(allProviders(), providerProjection).pipe(
              Effect.map((entries) => entries.filter((entry) => entry.active).map((entry) => entry.info)),
            ),
          directory: Effect.fn("Catalog.provider.directory")(function* () {
            const result: DirectoryEntry[] = []
            for (const info of allProviders()) {
              const projection = yield* providerProjection(info)
              const integration = projection.integration
              result.push(
                DirectoryEntry.make({
                  info: projection.info,
                  ...(integration === undefined ? {} : { integration }),
                  active: projection.active,
                  connected: projection.connected,
                  connectionCount: integration?.connections.length ?? 0,
                  modelCount: state.get().providers.get(info.name)?.models.size ?? 0,
                }),
              )
            }
            return result
          }),
          update: Effect.fn("Catalog.provider.update")(function* (input, actor: Actor.Info) {
            const provider = state.get().providers.get(input.provider)?.provider
            if (!provider) return yield* new NotFoundError({ provider: input.provider })
            const updated = yield* config.provider.update(input, actor)
            return effectiveProvider(provider, updated)
          }),
        },
        model: {
          get: (providerID, modelID) => Effect.succeed(state.get().providers.get(providerID)?.models.get(modelID)),
          all: () => Effect.succeed(allModels()),
          available: usable,
          visible: management,
          requireAvailable: Effect.fn("Catalog.model.requireAvailable")(function* (model) {
            return (yield* requireExecution(model)).selection.info
          }),
          requireExecution,
          toggle: Effect.fn("Catalog.model.toggle")(function* (input, actor: Actor.Info) {
            const found = (yield* management()).find(
              (candidate) => candidate.info.provider === input.provider && candidate.info.id === input.id,
            )
            if (!found) return yield* new ModelUnavailableError({ model: { provider: input.provider, id: input.id } })
            yield* config.modelPolicy.toggle(input, actor)
            return yield* management()
          }),
          setDefault: Effect.fn("Catalog.model.setDefault")(function* (input, actor: Actor.Info) {
            yield* requireExecution(input)
            yield* config.modelPolicy.setDefault(input, actor)
            return yield* management()
          }),
          default: () =>
            Effect.gen(function* () {
              const available = yield* usable()
              const configured = (yield* config.get).default_model
              return (
                available.find((model) => model.provider === configured?.provider && model.id === configured.id) ??
                available[0]
              )
            }),
          create: Effect.fn("Catalog.model.create")(function* (input, actor: Actor.Info) {
            const model = Custom.make({ ...input, id: input.id ?? input.apiID })
            const record = state.get().providers.get(model.provider)
            if (!record) return yield* new NotFoundError({ provider: model.provider })
            if (record.models.has(model.id))
              return yield* new ConflictError({ model: { provider: model.provider, id: model.id } })
            const updated = yield* config.model.put(model, actor)
            yield* installCustom(updated.models ?? [], true)
            return yield* managed(model)
          }),
          update: Effect.fn("Catalog.model.update")(function* (input, actor: Actor.Info) {
            if (!isCustom(input)) return yield* new MissingError({ model: { provider: input.provider, id: input.id } })
            const updated = yield* config.model.put(input, actor)
            yield* installCustom(updated.models ?? [], true)
            return yield* managed(input)
          }),
          delete: Effect.fn("Catalog.model.delete")(function* (model, actor: Actor.Info) {
            if (!isCustom(model)) return yield* new MissingError({ model: { provider: model.provider, id: model.id } })
            const updated = yield* config.model.remove(model, actor)
            yield* installCustom(updated.models ?? [], true)
          }),
        },
      })
    }),
  )

/** Compatibility Catalog layer with an isolated coordinator for direct callers. */
export const layer = layerWith()

/** Canonical member Catalog and its immediate dependencies. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(State.Service, (coordinator) => layerWith(coordinator))),
  deps: [Provider.node, Model.node, Integration.node, Config.node, State.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: {
  readonly integration: WorkspaceNode<Integration.Service, E>
  readonly config: WorkspaceNode<Config.Service, E>
}) =>
  makeWorkspaceNode({
    service: Service,
    layer,
    deps: [Provider.node, Model.node, input.integration, input.config],
  })
