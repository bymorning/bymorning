import { catalog } from "@bymorning/models/catalog"
import { Provider } from "@bymorning/schema/provider"

/** Provider discovery never requires a corresponding authentication Integration. */
export const sourceProviders = Object.values(catalog).map((provider) =>
  Provider.Info.make({
    name: Provider.Name.make(provider.id === "fireworks-ai" ? "fireworks" : provider.id),
    displayName: provider.name,
    ...(provider.api === undefined ? {} : { api: Provider.API.make(provider.api) }),
    format:
      provider.npm === "@ai-sdk/anthropic"
        ? "anthropic"
        : provider.npm === "@ai-sdk/google"
          ? "google"
          : provider.npm === "@ai-sdk/openai"
            ? "openai"
            : provider.npm === "@ai-sdk/amazon-bedrock"
              ? "bedrock-converse"
              : "oa-compat",
    status: "auto",
  }),
)
