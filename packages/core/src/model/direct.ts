import {
  anthropicModels,
  bedrockModels,
  fireworksModels,
  googleModels,
  openAIModels,
  openCodeModels,
} from "./generated.js"
import type { GeneratedModel } from "@bymorning/models/normalized"
import type { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import type { CatalogEntry, ExecutionBinding } from "./definition.js"

/**
 * The pinned US geography (`us.`) profiles AWS also serves in AWS GovCloud (US),
 * where the same profile is named `us-gov.`. The pinned source lists no `us-gov.`
 * profiles, and many `us.` profiles have no GovCloud counterpart, so this is the
 * documented subset, in default order: a GovCloud deployment defaults to the first
 * one its connection can invoke. Source: Amazon Bedrock "Regional availability by
 * models", Geo (`bedrock-runtime`) column for us-gov-west-1 and us-gov-east-1,
 * checked 2026-10-16. Replace with ListInferenceProfiles discovery when the
 * deployment role may call it.
 */
export const govCloudProfiles = [
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "us.anthropic.claude-sonnet-5",
  "us.anthropic.claude-opus-5",
  "us.anthropic.claude-opus-4-8",
  "us.anthropic.claude-fable-5-1",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
] as const

/**
 * Add a `us-gov.` row for each documented GovCloud profile, with the pinned `us.`
 * row's metadata and execution binding. They lead the list so GovCloud defaults
 * to one; commercial Regions refuse them, so the commercial default is unchanged.
 */
function withGovCloud(models: ReadonlyArray<GeneratedModel>): ReadonlyArray<GeneratedModel> {
  const derived = govCloudProfiles.flatMap((apiID): GeneratedModel[] => {
    const model = models.find((candidate) => candidate.apiID === apiID)
    if (model === undefined) return []
    const name = model.metadata.name.endsWith(" (US)")
      ? `${model.metadata.name.slice(0, -" (US)".length)} (US GovCloud)`
      : `${model.metadata.name} (US GovCloud)`
    return [
      {
        ...model,
        local: { ...model.local, id: model.local.id.replace(/^us\./, "us-gov.") },
        apiID: `us-gov.${model.apiID.slice("us.".length)}`,
        metadata: { ...model.metadata, name },
      },
    ]
  })
  return [...derived, ...models]
}

export const { catalog: openAICatalog, bindings: openAIBindings } = convertGenerated(
  openAIModels,
  "openai",
  Provider.OpenAI,
  { options: {} },
)
export const { catalog: anthropicCatalog, bindings: anthropicBindings } = convertGenerated(
  anthropicModels,
  "anthropic",
  Provider.Anthropic,
  { options: {} },
)
export const { catalog: bedrockCatalog, bindings: bedrockBindings } = convertGenerated(
  withGovCloud(bedrockModels),
  "amazon-bedrock",
  Provider.AmazonBedrock,
  { options: {} },
)
export const { catalog: googleCatalog, bindings: googleBindings } = convertGenerated(
  googleModels,
  "google",
  Provider.Google,
  { options: {}, modelFormat: true },
)
export const { catalog: fireworksCatalog, bindings: fireworksBindings } = convertGenerated(
  fireworksModels,
  "fireworks-ai",
  Provider.Fireworks,
  { options: {}, modelFormat: true },
)
export const { catalog: opencodeCatalog, bindings: opencodeBindings } = convertGenerated(
  openCodeModels,
  "opencode",
  Provider.OpenCode,
  { options: {}, modelFormat: true },
)

type GeneratedCost = NonNullable<GeneratedModel["metadata"]["cost"]>

/** Convert generated metadata into the intentionally smaller public Core schema. */
function convertGenerated(
  models: ReadonlyArray<GeneratedModel>,
  sourceProvider: GeneratedModel["source"]["provider"],
  provider: Provider.Name,
  execution: {
    readonly options: ExecutionBinding["options"]
    readonly models?: ReadonlyArray<GeneratedModel>
    readonly modelFormat?: boolean
  },
) {
  const catalog = models.map(({ source, local, apiID, lifecycle, metadata, unsupported: _unsupported }) => {
    if (source.provider !== sourceProvider || local.provider !== provider) {
      throw new Error(`Generated model provider mismatch: ${local.provider}/${local.id}`)
    }

    // Source provenance, unsupported execution hints, and structured-output detail do not exist in Model.Info.
    const { structuredOutput: _structuredOutput, ...capabilities } = metadata.capabilities
    return {
      id: local.id,
      provider,
      apiID,
      name: metadata.name,
      description: metadata.description,
      ...(metadata.family === undefined ? {} : { family: metadata.family }),
      status: lifecycle,
      releaseDate: metadata.releaseDate,
      lastUpdated: metadata.lastUpdated,
      openWeights: metadata.openWeights,
      capabilities,
      limit: metadata.limit,
      cost: convertCost(metadata.cost),
    }
  })
  const bindings = (execution.models ?? models).map(({ local, format, transport, unsupported }) => ({
    provider,
    id: local.id,
    ...(execution.modelFormat ? { format } : {}),
    ...(execution.modelFormat
      ? {
          package: {
            openai: "@opencode-ai/ai/providers/openai/responses",
            anthropic: "@opencode-ai/ai/providers/anthropic",
            google: "@opencode-ai/ai/providers/google",
            "oa-compat": "@opencode-ai/ai/providers/openai-compatible",
            "bedrock-converse": "@opencode-ai/ai/providers/amazon-bedrock",
          }[format],
        }
      : {}),
    ...(transport === "mantle-responses"
      ? { package: "@opencode-ai/ai/providers/amazon-bedrock/mantle", settings: { body: { store: false } } }
      : {}),
    options: { ...execution.options },
    ...(unsupported.sourceProviderOptions?.api === undefined
      ? {}
      : {
          settings: {
            baseURL: unsupported.sourceProviderOptions.api,
            ...(transport === "mantle-responses" ? { body: { store: false } } : {}),
          },
        }),
    variants: {},
  })) satisfies ReadonlyArray<ExecutionBinding>
  return { catalog: catalog satisfies ReadonlyArray<CatalogEntry>, bindings }
}

function convertCost(cost: GeneratedCost | undefined): Model.Cost {
  if (cost === undefined) return { cache: {} }
  const {
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    input_audio: _inputAudio,
    output_audio: _outputAudio,
    tiers,
    context_over_200k: over200K,
  } = cost
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    cache: {
      ...(cacheRead === undefined ? {} : { read: cacheRead }),
      write: cacheWrite ?? 0,
    },
    ...(tiers === undefined
      ? {}
      : {
          tiers: tiers.map((tier) => ({
            ...(tier.input === undefined ? {} : { input: tier.input }),
            ...(tier.output === undefined ? {} : { output: tier.output }),
            cache: {
              ...(tier.cache_read === undefined ? {} : { read: tier.cache_read }),
              ...(tier.cache_write === undefined ? {} : { write: tier.cache_write }),
            },
            tier: tier.tier,
          })),
        }),
    ...(over200K === undefined
      ? {}
      : {
          experimentalOver200K: {
            ...(over200K.input === undefined ? {} : { input: over200K.input }),
            ...(over200K.output === undefined ? {} : { output: over200K.output }),
            cache: {
              ...(over200K.cache_read === undefined ? {} : { read: over200K.cache_read }),
              ...(over200K.cache_write === undefined ? {} : { write: over200K.cache_write }),
            },
          },
        }),
  }
}
