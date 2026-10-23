export const descriptors = [
  {
    localID: "openai",
    sourceID: "openai",
    adapter: "openai",
    expectedNpm: "@ai-sdk/openai",
  },
  {
    localID: "anthropic",
    sourceID: "anthropic",
    adapter: "anthropic",
    expectedNpm: "@ai-sdk/anthropic",
  },
  {
    localID: "fireworks",
    sourceID: "fireworks-ai",
    adapter: "oa-compat",
    expectedNpm: "@ai-sdk/openai-compatible",
  },
  {
    localID: "google",
    sourceID: "google",
    // models.dev intentionally has no provider API URL; the Google SDK selects the endpoint.
    adapter: "google",
    expectedNpm: "@ai-sdk/google",
  },
  {
    localID: "opencode",
    sourceID: "opencode",
    adapter: "oa-compat",
    expectedNpm: "@ai-sdk/openai-compatible",
  },
  {
    localID: "amazon-bedrock",
    sourceID: "amazon-bedrock",
    adapter: "bedrock-converse",
    expectedNpm: "@ai-sdk/amazon-bedrock",
  },
] as const

export type LocalProviderID = (typeof descriptors)[number]["localID"]
export type SourceProviderID = (typeof descriptors)[number]["sourceID"]
export type Adapter = (typeof descriptors)[number]["adapter"]
