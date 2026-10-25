import { Provider } from "@bymorning/schema/provider"
import { describe, expect, it } from "vitest"
import { credentialHeader, makeDefinitions, registry } from "../src/provider/registry.js"

describe("Provider registry", () => {
  it("has unique identities, canonical origins, and at least one authentication method", () => {
    expect(makeDefinitions(registry).size).toBe(registry.length)
    for (const entry of registry) {
      if (entry.endpoint._tag === "fixed") {
        expect(entry.info.api).toBe(entry.endpoint.api)
        expect(entry.endpoint.api).not.toMatch(/\/$/)
        expect(new URL(entry.endpoint.api).origin).not.toBe("null")
      }
      expect(entry.integration.methods.length).toBeGreaterThan(0)
    }
  })

  it("sends Google and OpenCode credentials to their canonical API with their native authentication", () => {
    const find = (name: Provider.Name) => registry.find((entry) => entry.info.name === name)!
    // `info.api` is the destination a Connection's key is sent to.
    expect(find(Provider.Google)).toMatchObject({
      info: { api: "https://generativelanguage.googleapis.com/v1beta", format: "google" },
      authentication: "google-api-key",
      catalog: "direct",
    })
    expect(find(Provider.OpenCode)).toMatchObject({
      info: { api: "https://opencode.ai/zen/v1", format: "oa-compat" },
      authentication: "bearer",
      catalog: "aggregator",
    })
  })

  it("sends each provider's credential under its native header", () => {
    const entry = (name: Provider.Name) => registry.find((candidate) => candidate.info.name === name)!
    expect(credentialHeader(entry(Provider.OpenCode), "secret")).toEqual(["authorization", "Bearer secret"])
    expect(credentialHeader(entry(Provider.Anthropic), "secret")).toEqual(["x-api-key", "secret"])
    expect(credentialHeader(entry(Provider.Google), "secret")).toEqual(["x-goog-api-key", "secret"])
  })

  it("rejects duplicate identities", () => {
    const duplicate = registry[0]
    expect(() => makeDefinitions([duplicate, duplicate])).toThrow(`Duplicate Provider definition: ${Provider.OpenAI}`)
  })
})
