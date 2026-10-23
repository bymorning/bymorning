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

it("includes the official Central user group icon used by Members", () => {
  expect(isIconName("central-user-group")).toBe(true)
})

it("does not retain the replaced Projects stack icon", () => {
  expect(isIconName("central-projects")).toBe(false)
})

it("does not retain Central icons for removed Gateway items", () => {
  expect(
    [
      "central-console",
      "central-key-2",
      "central-settings-gear",
      "central-book",
      "central-playground",
      "central-api-connection",
      "central-dashboard",
    ].filter(isIconName),
  ).toEqual([])
})

it("gives every Console navigation item a distinct icon", () => {
  const icons = consoleSidebar.items.map((item) => item.icon)
  expect(new Set(icons).size).toBe(icons.length)
})

it("does not retain Central icons for the removed demo Agent navigation", () => {
  expect(["central-agent", "central-tasks", "central-analytics"].filter(isIconName)).toEqual([])
})
