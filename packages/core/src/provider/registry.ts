import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import { catalog } from "@bymorning/models/catalog"

export interface Definition {
  readonly info: Provider.Info
  readonly endpoint: Provider.EndpointStrategy
  readonly authentication: "bearer" | "api-key" | "google-api-key"
  readonly catalog: "direct" | "aggregator"
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
  readonly integration: {
    readonly key: boolean
    readonly environment: ReadonlyArray<string>
    readonly methods: ReadonlyArray<Integration.Method>
  }
}

const definition = (
  name: Provider.Name,
  displayName: string,
  api: string,
  format: Provider.Format,
  authentication: Definition["authentication"],
  key: boolean,
  environment: ReadonlyArray<string>,
  listing: Definition["catalog"] = "direct",
): Definition => ({
  info: Provider.Info.make({ name, displayName, api: Provider.API.make(api), format, status: "auto" }),
  endpoint: Provider.EndpointStrategy.make({ _tag: "fixed", api: Provider.API.make(api) }),
  authentication,
  catalog: listing,
  package: {
    openai: "@opencode-ai/ai/providers/openai/responses",
    anthropic: "@opencode-ai/ai/providers/anthropic",
    google: "@opencode-ai/ai/providers/google",
    "oa-compat": "@opencode-ai/ai/providers/openai-compatible",
    "bedrock-converse": "@opencode-ai/ai/providers/amazon-bedrock",
  }[format],
  settings: { baseURL: api },
  integration: {
    key,
    environment,
    methods: [
      ...(key ? [{ type: "key" as const }] : []),
      ...(environment.length > 0 ? [{ type: "env" as const, names: [...environment] }] : []),
    ],
  },
})

/** The provider-native header carrying one resolved credential. */
export const credentialHeader = (provider: Definition, key: string): readonly [name: string, value: string] => {
  if (provider.authentication === "bearer") return ["authorization", `Bearer ${key}`]
  if (provider.authentication === "google-api-key") return ["x-goog-api-key", key]
  return ["x-api-key", key]
}

const bedrockRegion = {
  key: "region",
  type: "string",
  title: "AWS region",
  required: true,
} as const

export const registry = [
  definition(Provider.OpenAI, "OpenAI", "https://api.openai.com/v1", "openai", "bearer", true, ["OPENAI_API_KEY"]),
  definition(Provider.Anthropic, "Anthropic", "https://api.anthropic.com/v1", "anthropic", "api-key", true, [
    "ANTHROPIC_API_KEY",
  ]),
  definition(
    Provider.Google,
    "Google",
    "https://generativelanguage.googleapis.com/v1beta",
    "google",
    "google-api-key",
    true,
    ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  ),
  definition(
    Provider.OpenCode,
    "OpenCode Zen",
    "https://opencode.ai/zen/v1",
    "oa-compat",
    "bearer",
    true,
    ["OPENCODE_API_KEY"],
    "aggregator",
  ),
  definition(Provider.Fireworks, "Fireworks", "https://api.fireworks.ai/inference/v1", "oa-compat", "bearer", true, [
    "FIREWORKS_API_KEY",
  ]),
  {
    info: Provider.Info.make({
      name: Provider.AmazonBedrock,
      displayName: "Amazon Bedrock",
      format: "bedrock-converse",
      status: "auto",
    }),
    endpoint: Provider.EndpointStrategy.make({ _tag: "aws-regional", partitions: ["aws", "aws-us-gov"] }),
    authentication: "bearer",
    catalog: "direct",
    package: "@opencode-ai/ai/providers/amazon-bedrock",
    settings: {},
    integration: {
      key: true,
      environment: [],
      methods: [
        { type: "key", label: "Bedrock API key", form: [bedrockRegion] },
        {
          id: Integration.BedrockAwsSigV4MethodID,
          type: "aws-sigv4",
          label: "AWS credentials",
          region: bedrockRegion,
        },
        ...Integration.BedrockEnvMethods,
      ],
    },
  },
] as const satisfies ReadonlyArray<Definition>

export const makeDefinitions = (entries: ReadonlyArray<Definition>) => {
  const result = new Map<Provider.Name, Definition>()
  for (const entry of entries) {
    if (result.has(entry.info.name)) throw new Error(`Duplicate Provider definition: ${entry.info.name}`)
    if (entry.endpoint._tag === "fixed") {
      const origin = new URL(entry.endpoint.api).origin
      if (
        entry.info.api !== entry.endpoint.api ||
        entry.endpoint.api !== entry.endpoint.api.replace(/\/$/, "") ||
        origin === "null"
      )
        throw new Error(`Invalid canonical Provider API: ${entry.info.name}`)
    } else if (entry.info.api !== undefined) throw new Error(`Regional Provider has a fixed API: ${entry.info.name}`)
    if (entry.integration.methods.length === 0)
      throw new Error(`Provider has no credential authority: ${entry.info.name}`)
    result.set(entry.info.name, entry)
  }
  return result
}

/** Installed native adapters whose endpoint and bearer authentication contracts were audited. */
export const nativeRegistry = [
  ["groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1"],
  ["cerebras", "CEREBRAS_API_KEY", "https://api.cerebras.ai/v1"],
  ["deepinfra", "DEEPINFRA_API_KEY", "https://api.deepinfra.com/v1/openai"],
  ["togetherai", "TOGETHER_API_KEY", "https://api.together.xyz/v1"],
  ["mistral", "MISTRAL_API_KEY", "https://api.mistral.ai/v1"],
  ["deepseek", "DEEPSEEK_API_KEY", "https://api.deepseek.com/v1"],
  ["baseten", "BASETEN_API_KEY", "https://inference.baseten.co/v1"],
  ["openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1"],
  ["xai", "XAI_API_KEY", "https://api.x.ai/v1"],
].flatMap(([id, environment, endpoint]): Array<Definition> => {
  if (!id || !environment || !endpoint) return []
  const provider = catalog[id]
  if (!provider) return []
  const info = definition(Provider.Name.make(id), provider.name, (provider.api ?? endpoint).replace(/\/$/, ""), "oa-compat", "bearer", true, [environment], "aggregator")
  return [{
    ...info,
    info: id === "xai" ? { ...info.info, format: "openai" } : info.info,
    package: id === "deepseek" || id === "baseten" ? "@opencode-ai/ai/providers/openai-compatible" : `@opencode-ai/ai/providers/${id}`,
  }]
})

export const definitions = makeDefinitions([...registry, ...nativeRegistry])
