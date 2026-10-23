import { describe, expect, it } from "vitest"

import { canReusePendingBlock, completedProjection } from "./markdown-projection"

describe("completedProjection", () => {
  it("wraps text in a single full block", () => {
    expect(completedProjection("# Hi")).toEqual({ text: "# Hi", blocks: [{ raw: "# Hi", src: "# Hi", mode: "full" }] })
  })
})

describe("canReusePendingBlock", () => {
  it("requires a current block with a matching mode", () => {
    expect(canReusePendingBlock(undefined, { raw: "a", src: "a", mode: "full" })).toBe(false)
    expect(canReusePendingBlock({ raw: "a", mode: "full" }, { raw: "a", src: "a", mode: "live" })).toBe(false)
  })

  it("reuses streaming blocks when the next block extends the current raw text", () => {
    const current = { raw: "const", mode: "code" as const }
    expect(canReusePendingBlock(current, { raw: "const value", src: "const value", mode: "code" })).toBe(true)
    expect(canReusePendingBlock(current, { raw: "const", src: "const", mode: "code" })).toBe(true)
    expect(canReusePendingBlock(current, { raw: "con", src: "con", mode: "code" })).toBe(false)
  })

  it("requires exact raw equality for finished modes", () => {
    const current = { raw: "# Hi", mode: "full" as const }
    expect(canReusePendingBlock(current, { raw: "# Hi", src: "# Hi", mode: "full" })).toBe(true)
    expect(canReusePendingBlock(current, { raw: "# Hi there", src: "# Hi there", mode: "full" })).toBe(false)
  })
})
