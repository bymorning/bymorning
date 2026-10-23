import { describe, expect, it } from "vitest"

import { formatSidebarSessionDate } from "./projects-region"

describe("formatSidebarSessionDate", () => {
  const now = new Date(2026, 7, 31, 14, 14)

  it.each([
    [new Date(2026, 7, 31, 14, 14), "now"],
    [new Date(2026, 7, 31, 14, 9), "5m"],
    [new Date(2026, 7, 31, 12, 14), "2h"],
    [new Date(2026, 7, 30, 23, 59), "Yesterday"],
    [new Date(2026, 7, 28, 12), "Aug 28"],
    [new Date(2025, 7, 28, 12), "Aug 28, 2025"],
  ])("formats %s as %s", (updatedAt, expected) => {
    expect(formatSidebarSessionDate(updatedAt, now, "en-US").compact).toBe(expected)
  })

  it("provides semantic full date copy", () => {
    expect(formatSidebarSessionDate(now, now, "en-US").full).toBe("Updated Aug 31, 2026, 2:14 PM")
  })
})
