import { describe, expect, it } from "vitest"

import { mutationNodesContainElement } from "./observe-element-offset"

describe("reconnect-aware element offsets", () => {
  it("matches only the scroll element or an ancestor containing it", () => {
    const route = document.createElement("section")
    const viewport = document.createElement("div")
    const child = document.createElement("div")
    const sibling = document.createElement("div")
    route.append(viewport)
    viewport.append(child)

    expect(mutationNodesContainElement([viewport], viewport)).toBe(true)
    expect(mutationNodesContainElement([route], viewport)).toBe(true)
    expect(mutationNodesContainElement([child, sibling], viewport)).toBe(false)
  })
})
