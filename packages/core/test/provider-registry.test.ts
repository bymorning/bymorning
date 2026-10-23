import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { describe, expect, it } from "vitest"
import { credentialHeader, makeDefinitions, registry } from "../src/provider/registry.js"

describe("Provider registry", () => {
  it("has unique deterministic identities, canonical origins, and credential authority", () => {
    expect(makeDefinitions(registry).size).toBe(registry.length)
    expect(registry.map((entry) => entry.info.name)).toEqual([
      "openai",
      "anthropic",
      "google",
      "opencode",
      "fireworks",
      "amazon-bedrock",
    ])
    for (const entry of registry) {
      if (entry.endpoint._tag === "fixed") {
        expect(entry.info.api).toBe(entry.endpoint.api)
        expect(entry.endpoint.api).not.toMatch(/\/$/)
        expect(new URL(entry.endpoint.api).origin).not.toBe("null")
      }
      expect(entry.integration.methods.length).toBeGreaterThan(0)
    }
  })

  it("registers Google and OpenCode with their native credential authorities", () => {
    const google = registry.find((entry) => entry.info.name === Provider.Google)!
    const opencode = registry.find((entry) => entry.info.name === Provider.OpenCode)!

    expect(google).toMatchObject({
      info: {
        displayName: "Google",
        api: "https://generativelanguage.googleapis.com/v1beta",
        format: "google",
      },
      authentication: "google-api-key",
      catalog: "direct",
      integration: {
        environment: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
      },
    })
    expect(opencode).toMatchObject({
      info: { displayName: "OpenCode Zen", api: "https://opencode.ai/zen/v1", format: "oa-compat" },
      authentication: "bearer",
      catalog: "aggregator",
      integration: { environment: ["OPENCODE_API_KEY"] },
    })
    expect(credentialHeader(opencode, "secret")).toEqual(["authorization", "Bearer secret"])
    expect(
      credentialHeader(
        registry.find((entry) => entry.info.name === Provider.Anthropic)!,
        "secret",
      ),
    ).toEqual(["x-api-key", "secret"])
    expect(credentialHeader(google, "secret")).toEqual(["x-goog-api-key", "secret"])
  })

  it("registers Bedrock's regional endpoint and complete authentication methods", () => {
    const bedrock = registry.find((entry) => entry.info.name === Provider.AmazonBedrock)
    expect(bedrock?.info).toMatchObject({ name: "amazon-bedrock", format: "bedrock-converse" })
    expect(bedrock && Integration.ID.make(bedrock.info.name)).toBe(Provider.AmazonBedrock)
    expect(bedrock?.info.api).toBeUndefined()
    expect(bedrock?.endpoint).toEqual({ _tag: "aws-regional", partitions: ["aws", "aws-us-gov"] })
    expect(
      (["us-east-1", "us-west-2"] as const).map((region) => Provider.bedrockRuntimeAPI(AwsRegion.make(region))),
    ).toEqual(["https://bedrock-runtime.us-east-1.amazonaws.com", "https://bedrock-runtime.us-west-2.amazonaws.com"])
    expect(bedrock?.integration.methods.map((method) => method.type)).toEqual([
      "key",
      "aws-sigv4",
      "env-group",
      "env-group",
    ])
    expect(bedrock?.integration.methods.slice(2)).toEqual(Integration.BedrockEnvMethods)
  })

  it("rejects duplicate identities", () => {
    const duplicate = registry[0]
    expect(() => makeDefinitions([duplicate, duplicate])).toThrow(
      `Duplicate Provider definition: ${Provider.OpenAI}`,
    )
  })
})
