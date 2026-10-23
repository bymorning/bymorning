import { describe, expect, it } from "vitest"

import { normalizeScheme, normalizeTheme, resolveMode, themeName, THEME_IDS } from "./model"

describe("theme model", () => {
  it("normalizes persisted preferences and exposes the canonical catalog", () => {
    expect(THEME_IDS).toEqual(["bymorning", "ink", "paper"])
    expect(normalizeTheme("ink")).toBe("ink")
    expect(normalizeTheme("unknown")).toBe("paper")
    expect(normalizeTheme(null)).toBe("paper")
    expect(normalizeScheme("system")).toBe("system")
    expect(normalizeScheme("unknown")).toBe("dark")
    expect(normalizeScheme(null)).toBe("dark")
    expect(themeName("bymorning")).toBe("Sand")
    expect(themeName("paper")).toBe("Paper")
    expect(themeName("unknown")).toBeUndefined()
  })

  it("resolves system mode without browser dependencies", () => {
    expect(resolveMode("light", true)).toBe("light")
    expect(resolveMode("dark", false)).toBe("dark")
    expect(resolveMode("system", false)).toBe("light")
    expect(resolveMode("system", true)).toBe("dark")
  })
})
