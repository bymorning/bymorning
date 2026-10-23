import { expect, it, vi } from "vitest"

import { workspaceRouteItems } from "./layout"

it("keeps gateway destinations out of the direct Workspace route items", () => {
  const routes = workspaceRouteItems({
    workspaceID: "workspace-1",
    pathname: "/w/workspace-1/mcp",
    navigate: vi.fn(),
    onDismiss: vi.fn(),
  })

  expect(routes.map((route) => route.id)).not.toContain("mcp")
  expect(routes.filter((route) => route.active)).toHaveLength(0)
})
