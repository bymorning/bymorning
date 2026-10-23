export * as Model from "./model.js"

import { Model } from "@bymorning/schema/model"
import type { Provider } from "@bymorning/schema/provider"
import type { ProviderOptions } from "@opencode-ai/ai/schema/options"
import { Context, Effect, Layer, Schema } from "effect"
import type { CatalogEntry, Definition } from "./model/definition.js"
import { catalog, registry } from "./model/registry.js"
import { definitions } from "./provider/registry.js"
import { nativeModels } from "./model/source.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

/** A selected model or variant does not exist in the code registry. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Model.NotFoundError", {
  model: Model.Ref,
}) {}

/** Execution metadata resolved from one valid Model selection. */
export interface Selection {
  readonly info: Model.Info
  readonly format: Provider.Format
  readonly options: ProviderOptions
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
}

/** Code-backed Model discovery and selection. */
export interface Interface {
  readonly get: (model: Model.Ref) => Effect.Effect<Selection, NotFoundError>
  readonly list: Effect.Effect<ReadonlyArray<Model.Info>>
}

/** Code-backed Model discovery and selection. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Model") {}

const project = (entry: CatalogEntry, variants: ReadonlyArray<string> = []): Model.Info => ({
  id: entry.id,
  provider: entry.provider,
  apiID: entry.apiID,
  name: entry.name,
  description: entry.description,
  ...(entry.family === undefined ? {} : { family: entry.family }),
  status: entry.status,
  releaseDate: entry.releaseDate,
  lastUpdated: entry.lastUpdated,
  openWeights: entry.openWeights,
  capabilities: entry.capabilities,
  variants,
  limit: entry.limit,
  cost: entry.cost,
})

/** Construct a Model implementation from validated definitions. */
export const makeLayer = (
  executionEntries: ReadonlyArray<Definition>,
  discoveryEntries: ReadonlyArray<CatalogEntry> = executionEntries,
) => {
  const entries = new Map(executionEntries.map((entry) => [`${entry.provider}/${entry.id}`, entry]))
  const models = [
    ...executionEntries.map((entry): Model.Info => ({
      ...project(entry, Object.keys(entry.variants)),
      execution: Schema.decodeUnknownSync(Model.Execution)({
        ...(entry.package === undefined ? {} : { package: entry.package }),
        ...(entry.format === undefined ? {} : { format: entry.format }),
        ...(entry.settings === undefined ? {} : { settings: entry.settings }),
        options: entry.options,
        variants: entry.variants,
      }),
    })),
    ...discoveryEntries.filter((entry) => !entries.has(`${entry.provider}/${entry.id}`)).map((entry) => ({ ...project(entry), execution: { package: null } })),
  ]
  return Layer.succeed(
    Service,
    Service.of({
      get: Effect.fn("Model.get")(function* (model) {
        const entry = entries.get(`${model.provider}/${model.id}`)
        if (entry === undefined) return yield* new NotFoundError({ model })
        const options = (
          model.variant === undefined || model.variant === "default" ? entry.options : undefined
        ) satisfies ProviderOptions | undefined
        if (options === undefined) return yield* new NotFoundError({ model })
        const format = entry.format ?? definitions.get(entry.provider)?.info.format
        if (format === undefined) return yield* new NotFoundError({ model })
        const provider = definitions.get(entry.provider)
        const runtime = entry.package ?? provider?.package
        if (runtime === undefined) return yield* new NotFoundError({ model })
        return {
          info: project(entry, Object.keys(entry.variants)),
          format,
          options,
          package: runtime,
          settings: { ...provider?.settings, ...entry.settings },
        }
      }),
      list: Effect.succeed(models).pipe(Effect.withSpan("Model.list")),
    }),
  ) satisfies Layer.Layer<Service>
}

/** Public Gateway identity for a provider-native Model. */
export const publicID = (model: Pick<Model.Info, "id" | "provider">): string =>
  definitions.get(model.provider)?.catalog === "direct" ? model.id : `${model.provider}/${model.id}`

/** Model implementation backed only by the bundled registry snapshot. */
export const layer = makeLayer([
  ...registry,
  ...nativeModels.filter((model) => !registry.some((entry) => entry.provider === model.provider && entry.apiID === model.apiID)),
].filter((model) => model.capabilities.input.includes("text") && model.capabilities.output.includes("text")), catalog)

export const defaultLayer = layer

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
