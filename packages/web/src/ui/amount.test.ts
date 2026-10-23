import { describe, expect, it } from "vitest"

import { validateAmount } from "./amount"

describe("validateAmount", () => {
  it("accepts empty, zero, and two-decimal amounts", () => {
    expect(validateAmount("")).toBeUndefined()
    expect(validateAmount("0")).toBeUndefined()
    expect(validateAmount("12.34")).toBeUndefined()
  })

  it("rejects amounts with excess decimal precision", () => {
    expect(validateAmount("12.345")).toBe("Enter a non-negative amount with at most two decimal places.")
  })

  it("rejects negative amounts and leading zeroes", () => {
    expect(validateAmount("-1")).toBe("Enter a non-negative amount with at most two decimal places.")
    expect(validateAmount("01")).toBe("Enter a non-negative amount with at most two decimal places.")
  })

  it("rejects digit strings that cannot be represented finitely", () => {
    expect(validateAmount("9".repeat(309))).toBe("Enter a finite amount.")
  })
})
