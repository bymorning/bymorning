import { describe, expect, it } from "vitest"
import { modelFormat } from "../src/sync.js"

describe("model wire format", () => {
  it("derives formats from provider and model npm packages", () => {
    expect(modelFormat("oa-compat", undefined, "@ai-sdk/openai-compatible")).toBe("oa-compat")
    expect(modelFormat("oa-compat", "@ai-sdk/openai", "@ai-sdk/openai-compatible")).toBe("openai")
    expect(modelFormat("oa-compat", "@ai-sdk/anthropic", "@ai-sdk/openai-compatible")).toBe("anthropic")
    expect(modelFormat("oa-compat", "@ai-sdk/google", "@ai-sdk/openai-compatible")).toBe("google")
    expect(modelFormat("bedrock-converse", "@ai-sdk/amazon-bedrock/mantle", "@ai-sdk/amazon-bedrock")).toBe(
      "bedrock-converse",
    )
  })
})
