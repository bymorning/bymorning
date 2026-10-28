import { describe, expect, it } from "vitest"
import { catalog } from "../generated/catalog.generated.js"
import { models as anthropic } from "../generated/providers/anthropic.generated.js"
import { models as bedrock } from "../generated/providers/amazon-bedrock.generated.js"
import { models as fireworks } from "../generated/providers/fireworks.generated.js"
import { models as google } from "../generated/providers/google.generated.js"
import { models as openai } from "../generated/providers/openai.generated.js"
import { models as opencode } from "../generated/providers/opencode.generated.js"

describe("generated provider projections", () => {
  // packages/models/AGENTS.md: the package does not filter catalog rows. Only openai, anthropic and bedrock
  // are guarded by the sync's removal check, so the other providers are pinned here.
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
