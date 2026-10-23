import { describe, expect, it } from "vitest"

import { measureScrollFade } from "./scroll-fade"

function region(input: Partial<Record<"scrollLeft" | "scrollTop" | "scrollWidth", number>>) {
  return {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 200,
    scrollWidth: 500,
    clientHeight: 100,
    scrollHeight: 400,
    ...input,
  } as HTMLElement
}

describe("measureScrollFade", () => {
  it("fades only the end side at the start of a horizontal region", () => {
    expect(measureScrollFade(region({}), "x")).toEqual({ above: false, below: true })
  })

  it("fades both sides in the middle", () => {
    expect(measureScrollFade(region({ scrollLeft: 120 }), "x")).toEqual({ above: true, below: true })
  })

  it("fades only the start side at the end", () => {
    expect(measureScrollFade(region({ scrollLeft: 300 }), "x")).toEqual({ above: true, below: false })
  })

  it("does not fade when the content fits", () => {
    expect(measureScrollFade(region({ scrollWidth: 200 }), "x")).toEqual({ above: false, below: false })
  })

  it("ignores sub-pixel remainders", () => {
    expect(measureScrollFade(region({ scrollLeft: 299.5 }), "x")).toEqual({ above: true, below: false })
  })

  it("measures vertical regions the same way", () => {
    expect(measureScrollFade(region({}), "y")).toEqual({ above: false, below: true })
    expect(measureScrollFade(region({ scrollTop: 150 }), "y")).toEqual({ above: true, below: true })
    expect(measureScrollFade(region({ scrollTop: 300 }), "y")).toEqual({ above: true, below: false })
  })
})
