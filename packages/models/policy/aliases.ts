export const providerAliases = {
  openai: "openai",
  anthropic: "anthropic",
  fireworks: "fireworks-ai",
  google: "google",
  opencode: "opencode",
  "amazon-bedrock": "amazon-bedrock",
} as const

// Source IDs are durable local IDs for this snapshot. Renames must be added here before an update is approved.
export const modelAliases: Readonly<Record<string, string>> = {}
