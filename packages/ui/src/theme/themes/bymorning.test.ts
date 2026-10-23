import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { requireDisjointThemeLayers, resolveTheme } from "../resolve"
import type { ThemeDefinition } from "../types"
import { requireTheme } from "../validate"
import byMorningJson from "./bymorning.json"
import inkJson from "./ink.json"
import paperJson from "./paper.json"

const byMorning = requireTheme(byMorningJson)
const ink = requireTheme(inkJson)
const paper = requireTheme(paperJson)
const paletteFields = [
  "neutral",
  "ink",
  "primary",
  "accent",
  "success",
  "warning",
  "error",
  "info",
  "interactive",
] as const
const alphaPaletteCases = (["light", "dark"] as const).flatMap((mode) =>
  paletteFields.map((field) => [mode, field, mode === "light" ? "#12345600" : "#12345680"] as const),
)

function withLightPalette(theme: ThemeDefinition, colors: Readonly<Record<string, string>>) {
  return requireTheme({ ...theme, light: { palette: { ...theme.light.palette, ...colors } } })
}

function effective(tokens: Readonly<Record<string, string>>, key: string) {
  const value = tokens[key]
  const reference = value?.match(/^var\(--([a-z0-9-]+)\)$/)?.[1]
  return reference ? tokens[reference] : value
}

describe("bundled palette definitions", () => {
  it("validates all authoritative JSON files through one contract", () => {
    expect(byMorning).toMatchObject({ id: "bymorning", name: "Sand" })
    expect(ink).toMatchObject({ id: "ink", name: "Ink" })
    expect(paper).toMatchObject({ id: "paper", name: "Paper" })
    for (const definition of [byMorning, ink, paper]) {
      expect(Object.keys(definition)).toEqual(
        definition.components
          ? ["id", "name", "radius", "fonts", "components", "light", "dark"]
          : ["id", "name", "radius", "fonts", "light", "dark"],
      )
      expect(Object.keys(definition.light)).toEqual(["palette"])
      expect(Object.keys(definition.dark)).toEqual(["palette"])
    }
  })

  it("resolves the Paper component button contract", () => {
    const resolved = resolveTheme(paper)
    for (const mode of ["light", "dark"] as const) {
      expect(resolved[mode]["font-heading"]).toBe('"Inter", sans-serif')
      expect(resolved[mode]["font-body"]).toBe('"Inter", sans-serif')
      expect(resolved[mode]["font-mono"]).toBe('"JetBrains Mono", monospace')
      expect(resolved[mode]["button-radius"]).toBe("9999px")
      expect(resolved[mode]["button-radius-small"]).toBe("9999px")
      expect(resolved[mode]["button-primary-shadow"]).toBe("none")
      expect(resolved[mode]["button-primary-hover-background-color"]).toBe(paper[mode].palette.primary)
      expect(resolved[mode]["button-primary-hover-background-image"]).toBe(
        resolved[mode]["button-primary-base-background-image"],
      )
      expect(resolved[mode]["button-primary-hover-foreground"]).toBe(resolved[mode]["button-primary-base-foreground"])
      expect(resolved[mode]["button-primary-hover-edge-background-image"]).toBe(
        "linear-gradient(270deg, #c4dfff 0%, #e5d0ff 38%, #fcbead 67%, #ffd3ba 100%)",
      )
      expect(resolved[mode]["button-primary-hover-edge-opacity"]).toBe("0.8")
      expect(resolved[mode]["button-focus-ring"]).toBe(paper[mode].palette.primary)
    }
  })

  it("retains canonical button radius, focus, and shadow behavior without component config", () => {
    for (const definition of [byMorning, ink]) {
      for (const mode of ["light", "dark"] as const) {
        const resolved = resolveTheme(definition)[mode]
        expect(resolved["button-radius"]).toBe("var(--radius)")
        expect(resolved["button-radius-small"]).toBe("var(--radius-md)")
        expect(resolved["button-focus-ring"]).toBe("var(--color-border-focus)")
        expect(resolved["button-primary-shadow"]).toBe("var(--shadow-button-primary)")
        expect(resolved["button-primary-hover-edge-background-image"]).toBe("none")
        expect(resolved["button-primary-hover-edge-opacity"]).toBe("0")
      }
    }
  })

  it("rejects arbitrary button CSS and malformed gradient paints", () => {
    const button = paperJson.components.button
    for (const primary of [
      { ...button.primary, css: "color: red" },
      { ...button.primary, hover: { paint: { type: "radial-gradient", stops: ["#000000", "#ffffff"] } } },
      { ...button.primary, hover: { paint: { type: "linear-gradient", angle: 45, stops: ["#000000", "#ffffff"] } } },
      { ...button.primary, hover: { paint: { type: "linear-gradient", angle: 90, stops: ["#000000"] } } },
      {
        ...button.primary,
        hover: {
          paint: {
            type: "linear-gradient",
            angle: 270,
            stops: ["#000000", "#ffffff"],
            positions: [60, 40],
          },
        },
      },
      {
        ...button.primary,
        hover: {
          paint: {
            type: "linear-gradient",
            angle: 270,
            stops: ["#000000", "#ffffff"],
            positions: [0, 101],
          },
        },
      },
      { ...button.primary, hoverEffect: "edge-glow", hover: { foreground: "#ffffff" } },
      { ...button.primary, hoverEffect: "edge-glow", hover: { paint: { type: "solid", color: "#ffffff" } } },
      { ...button.primary, hoverEffect: "sparkle" },
      { ...button.primary, hover: { foreground: "rebeccapurple" } },
    ]) {
      expect(() => requireTheme({ ...paperJson, components: { button: { ...button, primary } } })).toThrow(
        "Invalid theme",
      )
    }
  })

  it("checks primary state text at 4.5:1 and configured focus rings at 3:1", () => {
    expect(() =>
      resolveTheme(
        requireTheme({
          ...paperJson,
          components: {
            button: {
              ...paperJson.components.button,
              primary: {
                ...paperJson.components.button.primary,
                hoverEffect: "fill",
                hover: { ...paperJson.components.button.primary.hover, foreground: "#ffffff" },
              },
            },
          },
        }),
      ),
    ).toThrow("Theme primary button hover contrast is below 4.5:1")

    expect(() =>
      resolveTheme(
        requireTheme({
          ...paperJson,
          components: {
            button: {
              ...paperJson.components.button,
              focusRing: "#bbbbbb",
            },
          },
        }),
      ),
    ).toThrow("Theme button focus ring contrast is below 3:1")
  })

  it("checks rendered fallback layers and gradient interpolation, not only source colors", () => {
    expect(() =>
      resolveTheme(
        requireTheme({
          ...paperJson,
          components: {
            button: {
              primary: {
                base: { paint: { type: "solid", color: "#747474" }, foreground: "#ffffff" },
                hover: {
                  paint: { type: "linear-gradient", angle: 90, stops: ["#ff0000", "#009900"] },
                  foreground: "#000000",
                },
              },
            },
          },
        }),
      ),
    ).toThrow("Theme primary button hover contrast is below 4.5:1")

    expect(() =>
      resolveTheme(
        requireTheme({
          ...paperJson,
          components: {
            button: {
              primary: { base: { paint: { type: "solid", color: "#727272" }, foreground: "#ffffff" } },
            },
          },
          light: { palette: { ...paperJson.light.palette, primary: "#727272", ink: "#777777" } },
        }),
      ),
    ).toThrow("Theme primary button hover contrast is below 4.5:1")
  })

  it.each(["recipe", "decisions", "overrides", "v2Overrides"])("rejects the forbidden %s property", (key) => {
    expect(() => requireTheme({ ...byMorningJson, [key]: {} })).toThrow("Invalid theme")
    expect(() => requireTheme({ ...inkJson, light: { ...inkJson.light, [key]: {} } })).toThrow("Invalid theme")
  })

  it("rejects unknown palette fields, raw token keys, and removed diff seeds", () => {
    for (const key of ["unknown", "color-bg-accent", "diffAdd", "diffDelete"]) {
      expect(() =>
        requireTheme({
          ...byMorningJson,
          light: { palette: { ...byMorningJson.light.palette, [key]: "#ffffff" } },
        }),
      ).toThrow("Invalid theme")
    }
  })

  it("rejects missing required colors and invalid structural values", () => {
    const { accent: _accent, ...withoutAccent } = byMorningJson.light.palette
    expect(() => requireTheme({ ...byMorningJson, light: { palette: withoutAccent } })).toThrow("Invalid theme")
    expect(() => requireTheme({ ...byMorningJson, radius: -1 })).toThrow("Invalid theme")
    expect(() =>
      requireTheme({ ...byMorningJson, fonts: { ...byMorningJson.fonts, body: "https://example.com/font.woff2" } }),
    ).toThrow("Invalid theme")
  })

  it("accepts opaque six-digit palette colors", () => {
    expect(() =>
      requireTheme({
        ...byMorningJson,
        light: {
          palette: { ...byMorningJson.light.palette, primary: "#123456", neutral: "#abcdef", ink: "#ABCDEF" },
        },
      }),
    ).not.toThrow()
  })

  it.each(alphaPaletteCases)("rejects an alpha-bearing %s.%s palette seed", (mode, field, color) => {
    expect(() =>
      requireTheme({
        ...byMorningJson,
        [mode]: { palette: { ...byMorningJson[mode].palette, [field]: color } },
      }),
    ).toThrow(`Invalid theme palette color at ${mode}.${field}: expected opaque six-digit #RRGGBB`)
  })
})

describe("shared palette resolver", () => {
  it("has no theme identity or discriminator dispatch", () => {
    const source = readFileSync(join(process.cwd(), "src/theme/resolve.ts"), "utf8")
    expect(source).not.toMatch(/theme\.(?:id|name|recipe)/)
    expect(source).not.toMatch(/ByMorning|bymorning|decisions/)
    expect(source.match(/resolveThemeVariant\(theme, /g)).toHaveLength(2)
  })

  it("uses interactive when provided and otherwise falls back to primary", () => {
    const byMorningResolved = resolveTheme(byMorning).light
    expect(byMorningResolved["color-cyan-600"]).not.toBe(byMorningResolved["color-orange-600"])
    const inkResolved = resolveTheme(ink).light
    expect(inkResolved["color-cyan-600"]).toBe(inkResolved["color-orange-600"])
  })

  it("keeps layered surfaces subtle in both modes", () => {
    const resolved = resolveTheme(byMorning)
    expect(resolved.light["color-bg-layer-1"]).toBe("var(--color-grey-100)")
    expect(resolved.light["color-bg-layer-2"]).toBe("var(--color-grey-200)")
    expect(resolved.dark["color-bg-layer-1"]).toBe("var(--color-grey-1000)")
    expect(resolved.dark["color-bg-layer-2"]).toBe("var(--color-grey-900)")
  })

  it("keeps app surfaces ordered from recessed to raised in both modes", () => {
    const resolved = resolveTheme(byMorning)
    expect([
      resolved.light["color-bg-deep"],
      resolved.light["color-bg-surface"],
      resolved.light["color-bg-surface-raised"],
    ]).toEqual(["var(--color-grey-300)", "var(--color-grey-200)", "var(--color-grey-100)"])
    expect([
      resolved.dark["color-bg-deep"],
      resolved.dark["color-bg-surface"],
      resolved.dark["color-bg-surface-raised"],
    ]).toEqual(["var(--color-grey-1200)", "var(--color-grey-900)", "var(--color-grey-800)"])
  })

  it("makes Sand primary drive button, brand, accent, icon, and focus output", () => {
    const original = resolveTheme(byMorning).light
    const changed = resolveTheme(withLightPalette(byMorning, { primary: "#001f40" })).light
    expect(changed["color-bg-button-primary"]).toBe("#001f40")
    expect(changed["color-orange-600"]).not.toBe(original["color-orange-600"])
    for (const token of ["color-bg-accent", "color-text-accent", "color-icon-accent", "color-border-focus"]) {
      expect(effective(changed, token), token).not.toBe(effective(original, token))
    }
  })

  it.each([
    ["success", "#008a55", "color-green-800", "color-success-fg"],
    ["warning", "#b14d00", "color-yellow-800", "color-warning-fg"],
    ["error", "#9d174d", "color-red-800", "color-danger-fg"],
    ["info", "#005bbb", "color-blue-800", "color-info-fg"],
  ] as const)("maps %s only through its corresponding status ramp", (seed, value, primitive, semantic) => {
    const original = resolveTheme(byMorning).light
    const changed = resolveTheme(withLightPalette(byMorning, { [seed]: value })).light
    expect(changed[primitive]).not.toBe(original[primitive])
    expect(effective(changed, semantic)).toBe(changed[primitive])
    expect(effective(changed, semantic)).not.toBe(effective(original, semantic))
  })

  it("rejects collisions between fixed resolver layers", () => {
    expect(() => requireDisjointThemeLayers({ token: "first" }, { token: "second" })).toThrow(
      "Theme resolver layers overlap at token",
    )
  })

  it("rejects a primary button without an accessible palette foreground", () => {
    expect(() =>
      resolveTheme(
        withLightPalette(ink, {
          neutral: "#777777",
          ink: "#888888",
          primary: "#808080",
        }),
      ),
    ).toThrow("Theme primary button contrast is below 4.5:1")
  })
})
