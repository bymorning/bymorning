import { describe, expect, it } from "vitest"

import { normalizeScheme, normalizeTheme, resolveMode, themeName } from "./model"

describe("theme model", () => {
  it("normalizes persisted preferences and rejects unknown theme names", () => {
    expect(normalizeTheme("ink")).toBe("ink")
    expect(normalizeTheme("unknown")).toBe("paper")
    expect(normalizeTheme(null)).toBe("paper")
    expect(normalizeScheme("system")).toBe("system")
    expect(normalizeScheme("unknown")).toBe("dark")
    expect(normalizeScheme(null)).toBe("dark")
    expect(themeName("unknown")).toBeUndefined()
  })

  it("resolves system mode without browser dependencies", () => {
    expect(resolveMode("light", true)).toBe("light")
    expect(resolveMode("dark", false)).toBe("dark")
    expect(resolveMode("system", false)).toBe("light")
    expect(resolveMode("system", true)).toBe("dark")
  })
})
