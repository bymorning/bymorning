import { expect, it } from "vitest"

import { isIconName } from "../../ui/components/icon"
import { consoleSidebar, workspaceRoutes } from "./navigation"

it("resolves every sidebar-owned icon without the fallback", () => {
  const configured = [
    ...workspaceRoutes.map((route) => route.icon),
    ...consoleSidebar.items.map((item) => item.icon),
    "central-plus-small",
    "central-search",
    "central-chevron-right-small",
    "central-arrow-left",
    "central-folder-closed",
    "central-folder-open",
    "central-sessions",
    "central-chevron-down-small",
    "central-checkmark-small",
    "central-horizontal-dots",
    "central-theme",
    "central-logout",
    "settings-gear",
  ]

  expect(configured.filter((name) => !isIconName(name))).toEqual([])
})
