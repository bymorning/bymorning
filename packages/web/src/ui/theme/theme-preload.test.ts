/// <reference types="node" />

import { Script } from "node:vm"
import { describe, expect, it } from "vitest"

import source from "../../../public/bymorning-theme-preload.js?raw"

function preload(values: Record<string, string> = {}, systemDark = false) {
  const meta = { content: "", setAttribute: (_name: string, value: string) => (meta.content = value) }
  const document = {
    documentElement: { dataset: {} as Record<string, string>, style: { backgroundColor: "" } },
    querySelector: () => meta,
  }
  new Script(source).runInNewContext({
    document,
    localStorage: { getItem: (key: string) => values[key] ?? null },
    matchMedia: () => ({ matches: systemDark }),
    getComputedStyle: () => ({ backgroundColor: "resolved-deep" }),
    requestAnimationFrame: (callback: () => void) => callback(),
  })
  return { root: document.documentElement, meta }
}

describe("theme preload", () => {
  it.each(["bymorning", "ink", "paper"])("selects persisted %s before first paint", (theme) => {
    const result = preload({ "bymorning-theme-id": theme, "bymorning-color-scheme": "light" })
    expect(result.root.dataset).toEqual({ theme, colorScheme: "light" })
    expect(result.root.style.backgroundColor).toBe("var(--color-bg-deep)")
    expect(result.meta.content).toBe("resolved-deep")
  })

  it.each(["default", "unknown", "toString", "constructor", "hasOwnProperty", "__proto__"])(
    "normalizes deleted or unsafe ID %s",
    (theme) => expect(preload({ "bymorning-theme-id": theme }).root.dataset.theme).toBe("paper"),
  )

  it.each([
    ["light", false, "light"],
    ["dark", false, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
    ["invalid", true, "dark"],
  ])("normalizes %s with system dark=%s to %s", (scheme, dark, expected) => {
    expect(preload({ "bymorning-color-scheme": scheme }, dark).root.dataset.colorScheme).toBe(expected)
  })

  it("remains usable when browser reads fail", () => {
    const document = {
      documentElement: { dataset: {} as Record<string, string>, style: { backgroundColor: "" } },
      querySelector: () => null,
    }
    new Script(source).runInNewContext({
      document,
      localStorage: {
        getItem: () => {
          throw new Error("denied")
        },
      },
      matchMedia: () => {
        throw new Error("unavailable")
      },
    })
    expect(document.documentElement.dataset).toEqual({ theme: "paper", colorScheme: "dark" })
  })

  it("contains selection only, without cache parsing or style injection", () => {
    expect(source).not.toMatch(/cache|JSON|createElement|appendChild|textContent|canonical-/i)
  })
})
