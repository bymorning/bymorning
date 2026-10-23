import { describe, expect, it } from "vitest"

import {
  formatCompact,
  formatCost,
  formatDollars,
  formatInteger,
  formatMediumDate,
  formatMonthYear,
  formatShortDate,
} from "./format"

describe("formatDollars", () => {
  it("formats USD currency", () => {
    expect(formatDollars(1234.5)).toBe("$1,234.50")
    expect(formatDollars(0)).toBe("$0.00")
  })
})

describe("formatCompact", () => {
  it("formats compact notation with one fraction digit", () => {
    expect(formatCompact(999)).toBe("999")
    expect(formatCompact(1500)).toBe("1.5K")
    expect(formatCompact(2_500_000)).toBe("2.5M")
  })
})

describe("formatCost", () => {
  it("formats up to six fraction digits", () => {
    expect(formatCost(1.5)).toBe("1.5")
    expect(formatCost(0.00001234)).toBe("0.000012")
  })
})

describe("formatInteger", () => {
  it("groups thousands", () => {
    expect(formatInteger(0)).toBe("0")
    expect(formatInteger(1_234_567)).toBe("1,234,567")
  })
})

describe("date formatters", () => {
  const date = new Date("2026-08-09T12:00:00Z")

  it("formats a short date in UTC", () => {
    expect(formatShortDate(date)).toBe("Aug 9")
  })

  it("formats a medium date in the host time zone", () => {
    expect(formatMediumDate(date)).toBe("Aug 9, 2026")
  })

  it("formats a month and year in UTC", () => {
    expect(formatMonthYear(date)).toBe("August 2026")
  })
})
