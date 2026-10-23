import { describe, expect, it } from "vitest"

import { contrastRatio } from "./color"

describe("contrastRatio", () => {
  it("returns the maximum 21:1 ratio for black and white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21)
  })

  it.each([
    ["#ff0000", "#000000", 5.252],
    ["#00ff00", "#000000", 15.304],
    ["#0000ff", "#ffffff", 8.592],
  ] as const)("calculates the WCAG ratio for %s on %s", (foreground, background, ratio) => {
    expect(contrastRatio(foreground, background)).toBeCloseTo(ratio, 3)
  })
})
