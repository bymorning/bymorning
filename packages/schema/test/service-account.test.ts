import * as ServiceAccount from "@bymorning/schema/service-account"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("ServiceAccount.Policy", () => {
  it("accepts optional models, rpm, and tpm", () => {
    expect(Schema.decodeUnknownSync(ServiceAccount.Policy)({})).toEqual({})
    expect(
      Schema.decodeUnknownSync(ServiceAccount.Policy)({
        models: ["bymorning/gpt-5.6-luna"],
        rpm: 0,
        tpm: 500_000,
      }),
    ).toEqual({
      models: ["bymorning/gpt-5.6-luna"],
      rpm: 0,
      tpm: 500_000,
    })
  })

  it("rejects malformed models, rpm, and tpm", () => {
    expect(() => Schema.decodeUnknownSync(ServiceAccount.Policy)({ models: "gpt" })).toThrow()
    expect(() => Schema.decodeUnknownSync(ServiceAccount.Policy)({ rpm: "1" })).toThrow()
    expect(() => Schema.decodeUnknownSync(ServiceAccount.Policy)({ tpm: null })).toThrow()
  })
})
