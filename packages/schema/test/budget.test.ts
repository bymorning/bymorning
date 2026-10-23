import * as Budget from "@bymorning/schema/budget"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("Budget.Limit", () => {
  it("decodes a holder and non-negative amount", () => {
    expect(Schema.decodeUnknownSync(Budget.Limit)({ holder: "workspace:wrk_1", amount: 10 })).toEqual({
      holder: "workspace:wrk_1",
      amount: 10,
    })
  })

  it("rejects missing, blank, or negative fields", () => {
    expect(() => Schema.decodeUnknownSync(Budget.Limit)({ holder: "workspace:wrk_1" })).toThrow()
    expect(() => Schema.decodeUnknownSync(Budget.Limit)({ amount: 10 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Budget.Limit)({ holder: "", amount: 10 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Budget.Limit)({ holder: "workspace:wrk_1", amount: -1 })).toThrow()
  })
})
