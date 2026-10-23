import { describe, expect, it } from "vitest"
import { SidebarLayout } from "./right-sidebar-layout"

describe("SidebarLayout", () => {
  it("uses a safe sidebar width before workspace measurement", () => {
    expect(SidebarLayout.resolve(600)).toEqual({ sessionWidth: 600, min: 480, max: Infinity, width: 480 })
  })

  it("gives the sidebar the space remaining beside the preferred conversation width", () => {
    expect(SidebarLayout.resolve(600, 1500)).toEqual({ sessionWidth: 600, min: 480, max: 1080, width: 900 })
  })

  it("clamps conversation width to preserve the sidebar minimum", () => {
    expect(SidebarLayout.resolve(900, 1200)).toEqual({ sessionWidth: 720, min: 480, max: 780, width: 480 })
  })

  it("preserves the minimum conversation width for a wide requested sidebar", () => {
    expect(SidebarLayout.resolve(100, 1200)).toEqual({ sessionWidth: 420, min: 480, max: 780, width: 780 })
  })
})
