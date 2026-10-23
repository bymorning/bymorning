import { catalog } from "@bymorning/models/catalog"
import { Provider } from "@bymorning/schema/provider"
import type { CatalogEntry } from "./definition.js"
import type { Definition } from "./definition.js"
import { definitions } from "../provider/registry.js"

/** Preserve the existing Fireworks identity while ingesting the complete source. */
const providerName = (id: string) => Provider.Name.make(id === "fireworks-ai" ? "fireworks" : id)

/** Full bundled discovery metadata, independent of installed execution adapters. */
export const sourceModels = Object.values(catalog).flatMap((provider) =>
  Object.values(provider.models).map((model): CatalogEntry => ({
    id: model.id,
    provider: providerName(provider.id),
    apiID: model.id,
    name: model.name,
    description: model.description ?? "",
    ...(model.family === undefined ? {} : { family: model.family }),
    status: model.status ?? "active",
    releaseDate: model.release_date,
    lastUpdated: model.last_updated,
    openWeights: model.open_weights,
    capabilities: {
      attachment: model.attachment,
      reasoning: model.reasoning,
      tools: model.tool_call,
      ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
      input: model.modalities.input,
      output: model.modalities.output,
    },
    limit: model.limit,
    cost: {
      ...(model.cost?.input === undefined ? {} : { input: model.cost.input }),
      ...(model.cost?.output === undefined ? {} : { output: model.cost.output }),
      cache: {
        ...(model.cost?.cache_read === undefined ? {} : { read: model.cost.cache_read }),
        ...(model.cost?.cache_write === undefined ? {} : { write: model.cost.cache_write }),
      },
      ...(model.cost?.tiers === undefined
        ? {}
        : {
            tiers: model.cost.tiers.map((tier) => ({
              ...(tier.input === undefined ? {} : { input: tier.input }),
              ...(tier.output === undefined ? {} : { output: tier.output }),
              cache: {
                ...(tier.cache_read === undefined ? {} : { read: tier.cache_read }),
                ...(tier.cache_write === undefined ? {} : { write: tier.cache_write }),
              },
              tier: tier.tier,
            })),
          }),
      ...(model.cost?.context_over_200k === undefined
        ? {}
        : {
            experimentalOver200K: {
              ...(model.cost.context_over_200k.input === undefined
                ? {}
                : { input: model.cost.context_over_200k.input }),
              ...(model.cost.context_over_200k.output === undefined
                ? {}
                : { output: model.cost.context_over_200k.output }),
              cache: {
                ...(model.cost.context_over_200k.cache_read === undefined
                  ? {}
                  : { read: model.cost.context_over_200k.cache_read }),
                ...(model.cost.context_over_200k.cache_write === undefined
                  ? {}
                  : { write: model.cost.context_over_200k.cache_write }),
              },
            },
          }),
    },
  })),
)

const transport = new Map<string, { readonly format: Provider.Format; readonly package: string }>([
  ["@ai-sdk/openai", { format: "openai", package: "@opencode-ai/ai/providers/openai/responses" }],
  ["@ai-sdk/openai-compatible", { format: "oa-compat", package: "@opencode-ai/ai/providers/openai-compatible" }],
  ["@ai-sdk/anthropic", { format: "anthropic", package: "@opencode-ai/ai/providers/anthropic" }],
  ["@ai-sdk/google", { format: "google", package: "@opencode-ai/ai/providers/google" }],
])

/** Installed transport hints apply only within an independently registered authentication contract. */
export const nativeModels = sourceModels.flatMap((model): Array<Definition> => {
  const provider = catalog[model.provider]
  const source = provider?.models[model.id]
  const definition = definitions.get(model.provider)
  if (!provider || !source || !definition) return []
  const npm = source.provider?.npm ?? provider.npm
  if (model.status === "deprecated") return []
  const runtime =
    source.provider?.shape === "completions"
      ? transport.get("@ai-sdk/openai-compatible")
      : npm === provider.npm
        ? { format: definition.info.format, package: definition.package }
        : transport.get(npm)
  if (!runtime) return []
  return [
    {
      ...model,
      ...runtime,
      settings: source.provider?.api === undefined ? {} : { baseURL: source.provider.api },
      options: {},
      variants: {},
    },
  ]
})
