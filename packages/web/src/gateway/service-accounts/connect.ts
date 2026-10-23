import type { ProviderInfo } from "@bymorning/client"

/** One Gateway ingress format. Native Providers are not translated, so a client must speak its Provider's format. */
export type Protocol = "openai-chat" | "openai-responses" | "anthropic-messages" | "google-generate"

export type Format = ProviderInfo["format"]

export const protocolFor = (format: Format): Protocol => {
  switch (format) {
    case "anthropic":
      return "anthropic-messages"
    case "google":
      return "google-generate"
    case "openai":
      return "openai-responses"
    // Bedrock is translated from any caller format; OpenAI Chat is the most widely supported.
    case "oa-compat":
    case "bedrock-converse":
      return "openai-chat"
  }
}

/** Provider display name for the format a client needs. */
export const formatLabel: Record<Format, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "oa-compat": "OpenAI-compatible",
  "bedrock-converse": "Bedrock",
}

export interface ActiveModel {
  /** Public Gateway identity, `provider/model`. */
  readonly id: string
  readonly format: Format
}

export interface ConfigInput {
  readonly origin: string
  readonly key: string
  /** Enabled Models with an active Provider; each client addresses one it can call. */
  readonly models: ReadonlyArray<ActiveModel>
}

export interface Client {
  readonly id: "claude-code" | "codex" | "cursor" | "copilot" | "opencode" | "gemini" | "openai" | "curl"
  readonly label: string
  /** Provider format the client needs an active Model for; undefined accepts any. */
  readonly needs: Format | undefined
  readonly config: (input: ConfigInput) => string
}

const serves = (format: Format, needs: Format) => format === needs || format === "bedrock-converse"

/** An enabled Model the client can call, or a placeholder when none is. */
const modelFor = (models: ReadonlyArray<ActiveModel>, needs: Format | undefined) =>
  (needs === undefined ? models[0] : models.find((model) => serves(model.format, needs)))?.id ?? "provider/model"

/** Clients an administrator is likely to connect, with the configuration each expects. */
export const clients: ReadonlyArray<Client> = [
  {
    id: "claude-code",
    label: "Claude Code",
    needs: "anthropic",
    config: ({ origin, key }) =>
      [`export ANTHROPIC_BASE_URL="${origin}/inference/anthropic"`, `export ANTHROPIC_AUTH_TOKEN="${key}"`].join("\n"),
  },
  {
    id: "codex",
    label: "Codex",
    needs: "openai",
    config: ({ origin, key, models }) =>
      [
        `# ~/.codex/config.toml`,
        `model = "${modelFor(models, "openai")}"`,
        `model_provider = "bymorning"`,
        ``,
        `[model_providers.bymorning]`,
        `name = "ByMorning"`,
        `base_url = "${origin}/inference/openai/v1"`,
        `env_key = "BYMORNING_API_KEY"`,
        ``,
        `# then in your shell`,
        `export BYMORNING_API_KEY="${key}"`,
      ].join("\n"),
  },
  {
    id: "cursor",
    label: "Cursor",
    needs: "oa-compat",
    config: ({ origin, key, models }) =>
      [
        `Cursor Settings → Models`,
        `1. OpenAI API Key: on, paste ${key}`,
        `2. Override OpenAI Base URL: on, ${origin}/inference/openai/v1`,
        `3. Add Model: ${modelFor(models, "oa-compat")}`,
        ``,
        `Tab autocomplete stays on Cursor's own models.`,
      ].join("\n"),
  },
  {
    id: "copilot",
    label: "VS Code Copilot",
    needs: "oa-compat",
    config: ({ origin, key, models }) =>
      [
        `Chat model picker → Manage Language Models → Add Models → Custom Endpoint`,
        `API type: Chat Completions · API key: ${key}`,
        ``,
        `// chatLanguageModels.json`,
        `{`,
        `  "vendor": "customendpoint",`,
        `  "apiType": "chat-completions",`,
        `  "models": [{`,
        `    "id": "${modelFor(models, "oa-compat")}",`,
        `    "name": "${modelFor(models, "oa-compat")}",`,
        `    "url": "${origin}/inference/openai/v1/chat/completions",`,
        `    "toolCalling": true`,
        `  }]`,
        `}`,
      ].join("\n"),
  },
  {
    id: "opencode",
    label: "OpenCode",
    needs: "oa-compat",
    config: ({ origin, key, models }) =>
      [
        `// opencode.json`,
        `{`,
        `  "provider": {`,
        `    "bymorning": {`,
        `      "npm": "@ai-sdk/openai-compatible",`,
        `      "name": "ByMorning",`,
        `      "options": { "baseURL": "${origin}/inference/openai/v1", "apiKey": "${key}" },`,
        `      "models": { "${modelFor(models, "oa-compat")}": {} }`,
        `    }`,
        `  }`,
        `}`,
      ].join("\n"),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    needs: "google",
    config: ({ origin, key }) =>
      [`export GOOGLE_GEMINI_BASE_URL="${origin}/inference/google"`, `export GEMINI_API_KEY="${key}"`].join("\n"),
  },
  {
    id: "openai",
    label: "OpenAI SDK",
    needs: "oa-compat",
    config: ({ origin, key }) =>
      [`export OPENAI_BASE_URL="${origin}/inference/openai/v1"`, `export OPENAI_API_KEY="${key}"`].join("\n"),
  },
  {
    id: "curl",
    label: "cURL",
    needs: undefined,
    config: ({ origin, key, models }) => curl(origin, key, models[0]),
  },
]

/** Clients whose format has an active Model. Unknown availability admits every client. */
export const available = (formats: ReadonlySet<Format> | undefined): ReadonlyArray<Client> =>
  formats === undefined
    ? clients
    : clients.filter(
        (client) => client.needs === undefined || [...formats].some((format) => serves(format, client.needs!)),
      )

const curl = (origin: string, key: string, example: ActiveModel | undefined) => {
  const model = example?.id ?? "provider/model"
  switch (example ? protocolFor(example.format) : "openai-chat") {
    case "anthropic-messages":
      return [
        `curl ${origin}/inference/anthropic/v1/messages \\`,
        `  -H "x-api-key: ${key}" \\`,
        `  -H "anthropic-version: 2023-06-01" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"model":"${model}","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'`,
      ].join("\n")
    case "openai-responses":
      return [
        `curl ${origin}/inference/openai/v1/responses \\`,
        `  -H "Authorization: Bearer ${key}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"model":"${model}","input":"Hello"}'`,
      ].join("\n")
    case "google-generate":
      return [
        `curl ${origin}/inference/google/v1beta/models/${encodeURIComponent(model)}:generateContent \\`,
        `  -H "x-goog-api-key: ${key}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'`,
      ].join("\n")
    case "openai-chat":
      return [
        `curl ${origin}/inference/openai/v1/chat/completions \\`,
        `  -H "Authorization: Bearer ${key}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`,
      ].join("\n")
  }
}
