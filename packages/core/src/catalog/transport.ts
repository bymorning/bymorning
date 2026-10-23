import type { ProviderPackage } from "@opencode-ai/ai/provider-package"
import {
  Anthropic,
  Bedrock,
  Cerebras,
  Compatible,
  Deepinfra,
  Google,
  Groq,
  Mantle,
  Mistral,
  OpenAI,
  Openrouter,
  Togetherai,
  Xai,
} from "./packages.js"

/** Native packages admitted by the bundled catalog. */
export const packages = {
  "@opencode-ai/ai/providers/groq": Groq,
  "@opencode-ai/ai/providers/cerebras": Cerebras,
  "@opencode-ai/ai/providers/deepinfra": Deepinfra,
  "@opencode-ai/ai/providers/togetherai": Togetherai,
  "@opencode-ai/ai/providers/mistral": Mistral,
  "@opencode-ai/ai/providers/openrouter": Openrouter,
  "@opencode-ai/ai/providers/xai": Xai,
  "@opencode-ai/ai/providers/openai/responses": OpenAI,
  "@opencode-ai/ai/providers/anthropic": Anthropic,
  "@opencode-ai/ai/providers/google": Google,
  "@opencode-ai/ai/providers/openai-compatible": {
    model: (modelID: string, settings: { readonly baseURL?: string }) => {
      if (settings.baseURL === undefined) throw new Error("Compatible provider requires baseURL")
      return Compatible.model(modelID, { ...settings, baseURL: settings.baseURL })
    },
  },
  "@opencode-ai/ai/providers/amazon-bedrock": Bedrock,
  "@opencode-ai/ai/providers/amazon-bedrock/mantle": Mantle,
} as Readonly<Record<string, ProviderPackage.Definition>>
