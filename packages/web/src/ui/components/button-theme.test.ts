/// <reference types="node" />

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = (name: string) => readFileSync(join(process.cwd(), "src/ui/components", name), "utf8")

describe("component button theme selectors", () => {
  it("applies primary state paint only to semantic Button primary selectors", () => {
    const button = source("button.css")
    const iconButton = source("icon-button.css")

    expect(button).toContain('data-variant="primary"')
    expect(button).toContain("var(--button-primary-hover-background-image)")
    expect(button).toContain("var(--button-primary-pressed-background-image)")
    expect(iconButton).not.toContain("--button-primary-hover-background-image")
    expect(iconButton).not.toContain("--button-primary-pressed-background-image")
  })

  it("shares only component radius and focus tokens with IconButton", () => {
    for (const name of ["button.css", "icon-button.css"]) {
      const css = source(name)
      expect(css).toContain("var(--button-radius)")
      expect(css).toContain("var(--button-focus-ring)")
    }
  })

  it("excludes native and synthetic disabled buttons from interaction paint and focus", () => {
    const button = source("button.css")
    const interactionSelectors = [...button.matchAll(/([^{}]+)\s*\{/g)]
      .map((match) => match[1]!.trim())
      .filter((selector) => /:hover|:active|data-state="(?:hover|pressed)"|data-expanded/.test(selector))

    expect(interactionSelectors.length).toBeGreaterThan(0)
    for (const selector of interactionSelectors) {
      expect(selector).toContain(":not(:disabled)")
      expect(selector).toContain(':not([data-state="disabled"])')
    }
    expect(button).toMatch(/focus-visible[^{}]+:not\(:disabled\):not\(\[data-state="disabled"\]\)/)
  })

  it("renders an inert, isolated edge glow that activates only for hover", () => {
    const button = source("button.css")
    const pseudo = button.slice(button.indexOf('[data-variant="primary"]::before'), button.indexOf("[data-component=", button.indexOf("opacity: var(--button-primary-hover-edge-opacity)")) + 1)

    expect(button).toMatch(/data-variant="primary"[^{}]*\{[^}]*isolation: isolate;[^}]*overflow: hidden;/s)
    expect(pseudo).toContain("left: -10%")
    expect(pseudo).toContain("width: 110%")
    expect(pseudo).toContain("filter: blur(10px)")
    expect(pseudo).toContain("transition: opacity 300ms ease")
    expect(pseudo).toContain("z-index: -1")
    expect(button).toContain("top: 100%")
    expect(button).toContain("top: -100%")
    expect(button).toMatch(/@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*::before,[^}]*::after[^}]*\{[^}]*transition: none;/s)
    expect(button).toMatch(/data-state="hover"[^{}]*:not\(:active\):not\([^)]*data-state="pressed"[^{}]*:not\(:disabled\):not\([^)]*data-state="disabled"[^{}]*::before/s)
    expect(button.indexOf("opacity: var(--button-primary-hover-edge-opacity)")).toBeLessThan(
      button.indexOf('data-variant="primary"]:is(:active'),
    )
  })
})
