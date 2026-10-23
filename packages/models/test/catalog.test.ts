import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { catalog } from "../generated/catalog.generated.js"
import { models as anthropic } from "../generated/providers/anthropic.generated.js"
import { models as bedrock } from "../generated/providers/amazon-bedrock.generated.js"
import { models as fireworks } from "../generated/providers/fireworks.generated.js"
import { models as google } from "../generated/providers/google.generated.js"
import { models as openai } from "../generated/providers/openai.generated.js"
import { models as opencode } from "../generated/providers/opencode.generated.js"

describe("complete models.dev catalog", () => {
  it("exports every pinned provider and model", async () => {
    const pin = JSON.parse(await readFile("source/models-dev/pin.json", "utf8"))
    const source = JSON.parse(
      await readFile(`source/models-dev/cache/body.${pin.bodyDigest}.json`, "utf8"),
    ) as typeof catalog

    expect(Object.keys(catalog)).toEqual(Object.keys(source))
    expect(Object.values(catalog).reduce((count, provider) => count + Object.keys(provider.models).length, 0)).toBe(
      Object.values(source).reduce((count, provider) => count + Object.keys(provider.models).length, 0),
    )
  })

  it("does not filter compatibility provider projections", () => {
    for (const [sourceID, generated] of [
      ["openai", openai],
      ["anthropic", anthropic],
      ["fireworks-ai", fireworks],
      ["google", google],
      ["opencode", opencode],
      ["amazon-bedrock", bedrock],
    ] as const) {
      expect(generated.map((model) => model.apiID).sort()).toEqual(Object.keys(catalog[sourceID]!.models).sort())
    }
  })
})
