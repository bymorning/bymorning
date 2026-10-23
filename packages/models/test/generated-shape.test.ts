import { describe, expect, expectTypeOf, it } from "vitest"
import { models as anthropic } from "../generated/providers/anthropic.generated.js"
import { models as bedrock } from "../generated/providers/amazon-bedrock.generated.js"
import { models as openai } from "../generated/providers/openai.generated.js"
import { models as fireworks } from "../generated/providers/fireworks.generated.js"
import { models as google } from "../generated/providers/google.generated.js"
import { models as opencode } from "../generated/providers/opencode.generated.js"
import type { GeneratedModel } from "../src/normalized.js"
import type { Cost } from "../src/source-schema.js"

describe("generated catalog contract", () => {
  it("is a normalized catalog without an untyped metadata escape hatch", () => {
    expectTypeOf(openai).toExtend<ReadonlyArray<GeneratedModel>>()
    expectTypeOf(anthropic).toExtend<ReadonlyArray<GeneratedModel>>()
    expectTypeOf(bedrock).toExtend<ReadonlyArray<GeneratedModel>>()
    expectTypeOf(fireworks).toExtend<ReadonlyArray<GeneratedModel>>()
    expectTypeOf(google).toExtend<ReadonlyArray<GeneratedModel>>()
    expectTypeOf(opencode).toExtend<ReadonlyArray<GeneratedModel>>()
    expectTypeOf<GeneratedModel["metadata"]["cost"]>().toEqualTypeOf<Cost | undefined>()
    expectTypeOf<{ readonly type: "toggle" }>().toExtend<
      NonNullable<GeneratedModel["unsupported"]["reasoningOptions"]>[number]
    >()
  })

  it("keeps the generated row snapshot shape", () => {
    expect(Object.keys(opencode[0]!)).toEqual([
      "source",
      "local",
      "apiID",
      "format",
      "lifecycle",
      "metadata",
      "unsupported",
    ])
    expect(openai.find((model) => model.apiID === "chatgpt-image-latest")?.lifecycle).toBe("active")
  })
})
