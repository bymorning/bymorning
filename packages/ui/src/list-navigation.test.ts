import { describe, expect, it } from "vitest"

import { nextIndex } from "./list-navigation"

describe("nextIndex", () => {
  it("returns -1 for an empty list", () => {
    expect(nextIndex(0, 0, 1)).toBe(-1)
    expect(nextIndex(0, -1, -1)).toBe(-1)
  })

  it("starts at the first item and steps when nothing is selected", () => {
    expect(nextIndex(5, -1, 1)).toBe(1)
  })

  it("wraps backwards from the first item when starting at nothing selected", () => {
    expect(nextIndex(5, -1, -1)).toBe(4)
  })

  it("wraps forward past the last item", () => {
    expect(nextIndex(5, 4, 1)).toBe(0)
  })

  it("wraps backwards past the first item", () => {
    expect(nextIndex(5, 0, -1)).toBe(4)
  })

  it("steps within bounds", () => {
    expect(nextIndex(3, 1, 1)).toBe(2)
    expect(nextIndex(3, 1, -1)).toBe(0)
  })

  it("stays on the only item", () => {
    expect(nextIndex(1, 0, 1)).toBe(0)
    expect(nextIndex(1, 0, -1)).toBe(0)
  })
})
