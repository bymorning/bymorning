import * as Model from "@bymorning/schema/model"
import * as Provider from "@bymorning/schema/provider"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("uses Provider names in canonical Model contracts", () => {
  const ref = Schema.decodeUnknownSync(Model.Ref)({ provider: "bymorning", id: "minimax-m2.7" })

  expect(ref).toEqual({ provider: Provider.Bymorning, id: "minimax-m2.7" })
  expect(Model.Ref.fields.provider).toBe(Provider.Name)
  expect(Model.Info.fields.provider).toBe(Provider.Name)
  expect(Model.Ref.fields).not.toHaveProperty("providerID")
  expect(Model.Info.fields).not.toHaveProperty("providerID")
  expect(() =>
    Schema.decodeUnknownSync(Model.Ref, { onExcessProperty: "error" })({
      providerID: "prv_bymorning",
      id: "minimax-m2.7",
    }),
  ).toThrow()
})

test("preserves unknown model prices instead of synthesizing zero", () => {
  const cost = Schema.decodeUnknownSync(Model.Cost)({ cache: {} })

  expect(cost).toEqual({ cache: {} })
  expect(cost).not.toHaveProperty("input")
  expect(cost).not.toHaveProperty("output")
})

test.each(["provider-disabled", "region-unsupported", "transport-unsupported"] as const)(
  "accepts the public model management reason %s",
  (unavailableReason) => {
    const info = Schema.decodeUnknownSync(Model.Info)({
      id: "model",
      provider: Provider.AmazonBedrock,
      apiID: "model",
      name: "Model",
      description: "",
      status: "active",
      releaseDate: "2026-09-01",
      lastUpdated: "2026-09-01",
      openWeights: false,
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        tools: true,
        input: ["text"],
        output: ["text"],
      },
      variants: [],
      limit: { context: 1, output: 1 },
      cost: { cache: {} },
    })

    expect(
      Schema.decodeUnknownSync(Model.Management)({
        info,
        enabled: true,
        isPreferredDefault: false,
        isEffectiveDefault: false,
        unavailableReason,
      }).unavailableReason,
    ).toBe(unavailableReason)
  },
)
