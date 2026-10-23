import { blend, contrastRatio, hexToRgb, rgbToHex } from "./color"
import { fontFamily } from "./font"
import { mapForeground } from "./foreground"
import { mapSemantics } from "./mapping"
import { generatePrimitives } from "./primitives"
import { THEME_SCOPED_TOKENS } from "./tokens"
import type {
  ButtonPaint,
  ButtonPrimaryState,
  PaletteColor,
  ResolvedTheme,
  ThemeColor,
  ThemeDefinition,
  ThemeMode,
  ThemePaletteReference,
  TokenValue,
} from "./types"

export function resolveThemeVariant(theme: ThemeDefinition, mode: ThemeMode): ResolvedTheme {
  const variant = theme[mode]
  const primitives = generatePrimitives(variant.palette, mode === "dark")
  const semantics = mapSemantics(mode)
  const foreground = mapForeground({ ink: variant.palette.ink, mode, primitives, semantics })
  return composeTheme(theme, mode, primitives, semantics, foreground)
}

function composeTheme(
  theme: ThemeDefinition,
  mode: ThemeMode,
  primitives: Readonly<Record<string, TokenValue>>,
  semantics: Readonly<Record<string, TokenValue>>,
  foreground: Readonly<Record<string, TokenValue>> = {},
) {
  const variant = theme[mode]
  const inkContrast = contrastRatio(variant.palette.ink, variant.palette.primary)
  const neutralContrast = contrastRatio(variant.palette.neutral, variant.palette.primary)
  if (Math.max(inkContrast, neutralContrast) < 4.5) throw new Error("Theme primary button contrast is below 4.5:1")
  const primary = {
    "color-bg-button-primary": variant.palette.primary,
    "color-text-button-primary": inkContrast >= neutralContrast ? variant.palette.ink : variant.palette.neutral,
  }
  const button = resolveButton(theme, mode, primary["color-text-button-primary"])
  const structural = {
    "font-heading": fontFamily(theme.fonts.heading),
    "font-body": fontFamily(theme.fonts.body),
    "font-mono": fontFamily(theme.fonts.mono),
    "radius-sm": `${Math.max(0, theme.radius - 4)}px`,
    "radius-md": `${Math.max(0, theme.radius - 2)}px`,
    "radius-lg": `${theme.radius}px`,
    "radius-xl": `${theme.radius + 2}px`,
    "radius-2xl": `${theme.radius + 6}px`,
    radius: "var(--radius-lg)",
  }

  requireDisjointThemeLayers(primitives, semantics, foreground, primary, structural, button)
  return requireExactThemeScopedInventory({
    ...primitives,
    ...semantics,
    ...foreground,
    ...primary,
    ...structural,
    ...button,
  })
}

function resolveButton(
  theme: ThemeDefinition,
  mode: ThemeMode,
  defaultForeground: ThemeDefinition[ThemeMode]["palette"]["primary"],
) {
  const palette = theme[mode].palette
  const config = theme.components?.button
  const base = resolveButtonState(config?.primary?.base, palette.primary, defaultForeground, palette)
  const configuredHover = resolveButtonState(
    config?.primary?.hover,
    palette.primary,
    defaultForeground,
    palette,
    "hover",
  )
  const edgeGlow = config?.primary?.hoverEffect === "edge-glow"
  const hover = edgeGlow ? base : configuredHover
  const pressed = resolveButtonState(config?.primary?.pressed, palette.primary, defaultForeground, palette, "pressed")
  const configuredFocusRing = config?.focusRing
  const focusRing = configuredFocusRing ? resolveThemeColor(configuredFocusRing, palette) : "var(--color-border-focus)"

  for (const [name, state] of [
    ["base", base],
    ["hover", hover],
    ["pressed", pressed],
  ] as const) {
    for (const color of state.validationColors) {
      if (contrastRatio(color, state.foreground) < state.validationThreshold)
        throw new Error(`Theme primary button ${name} contrast is below 4.5:1`)
    }
  }
  if (configuredFocusRing && contrastRatio(resolveThemeColor(configuredFocusRing, palette), palette.neutral) < 3)
    throw new Error("Theme button focus ring contrast is below 3:1")

  return {
    "button-primary-base-background-color": base.backgroundColor,
    "button-primary-base-background-image": base.backgroundImage,
    "button-primary-base-foreground": base.foreground,
    "button-primary-hover-background-color": hover.backgroundColor,
    "button-primary-hover-background-image": hover.backgroundImage,
    "button-primary-hover-foreground": hover.foreground,
    "button-primary-hover-edge-background-image": edgeGlow ? configuredHover.backgroundImage : "none",
    "button-primary-hover-edge-opacity": edgeGlow ? "0.8" : "0",
    "button-primary-pressed-background-color": pressed.backgroundColor,
    "button-primary-pressed-background-image": pressed.backgroundImage,
    "button-primary-pressed-foreground": pressed.foreground,
    "button-primary-shadow": config?.primary?.shadow === "none" ? "none" : "var(--shadow-button-primary)",
    "button-focus-ring": focusRing,
    "button-radius": config?.radius === "pill" ? "9999px" : "var(--radius)",
    "button-radius-small": config?.radius === "pill" ? "9999px" : "var(--radius-md)",
  }
}

function resolveButtonState(
  state: ButtonPrimaryState | undefined,
  defaultBackground: ThemeDefinition[ThemeMode]["palette"]["primary"],
  defaultForeground: ThemeDefinition[ThemeMode]["palette"]["primary"],
  palette: ThemeDefinition[ThemeMode]["palette"],
  fallback?: "hover" | "pressed",
) {
  const foreground = resolveThemeColor(state?.foreground ?? defaultForeground, palette)
  if (state?.paint) {
    const paint = resolvePaint(state.paint, palette)
    return { ...paint, foreground }
  }
  const overlay = fallback === "hover" ? 8 : fallback === "pressed" ? 14 : undefined
  const validationColors = Array.from({ length: 33 }, (_, index) => {
    const sheen = blend("#ffffff", defaultBackground, (0.2 * index) / 32)
    return overlay === undefined ? sheen : blend(defaultForeground, sheen, overlay / 100)
  })
  return {
    backgroundColor: defaultBackground,
    backgroundImage: [
      overlay === undefined
        ? undefined
        : `linear-gradient(90deg, color-mix(in srgb, ${defaultForeground} ${overlay}%, transparent) 0%, color-mix(in srgb, ${defaultForeground} ${overlay}%, transparent) 100%)`,
      "linear-gradient(180deg, var(--color-alpha-light-20) 0%, var(--color-alpha-light-0) 100%)",
    ]
      .filter(Boolean)
      .join(", "),
    foreground,
    validationColors,
    // The small buffer makes finite sheen/overlay sampling conservative around the 4.5 contract.
    validationThreshold: 4.55,
  }
}

function resolvePaint(paint: ButtonPaint, palette: ThemeDefinition[ThemeMode]["palette"]) {
  if (paint.type === "solid") {
    const color = resolveThemeColor(paint.color, palette)
    return { backgroundColor: color, backgroundImage: "none", validationColors: [color], validationThreshold: 4.5 }
  }
  const colors = paint.stops.map((color) => resolveThemeColor(color, palette))
  const stops = colors.map((color, index) => `${color}${paint.positions ? ` ${paint.positions[index]}%` : ""}`)
  return {
    backgroundColor: colors[0]!,
    // Legacy CSS gradients interpolate in sRGB, matching the conservative samples below.
    backgroundImage: `linear-gradient(${paint.angle}deg, ${stops.join(", ")})`,
    validationColors: colors.flatMap((color, index) => {
      const next = colors[index + 1]
      if (!next) return [color]
      return Array.from({ length: 33 }, (_, sample) => interpolateSrgb(color, next, sample / 32))
    }),
    validationThreshold: 4.55,
  }
}

function interpolateSrgb(
  from: ThemeDefinition[ThemeMode]["palette"]["primary"],
  to: ThemeDefinition[ThemeMode]["palette"]["primary"],
  amount: number,
) {
  const start = hexToRgb(from)
  const end = hexToRgb(to)
  return rgbToHex(
    start.r + (end.r - start.r) * amount,
    start.g + (end.g - start.g) * amount,
    start.b + (end.b - start.b) * amount,
  )
}

function resolveThemeColor(color: ThemeColor, palette: ThemeDefinition[ThemeMode]["palette"]): PaletteColor {
  return color.startsWith("#") ? (color as PaletteColor) : (palette[color as ThemePaletteReference] ?? palette.primary)
}

export function resolveTheme(theme: ThemeDefinition) {
  return {
    light: resolveThemeVariant(theme, "light"),
    dark: resolveThemeVariant(theme, "dark"),
  }
}

export function requireDisjointThemeLayers(...layers: ReadonlyArray<Readonly<Record<string, TokenValue>>>) {
  const seen = new Set<string>()
  for (const layer of layers) {
    for (const key of Object.keys(layer)) {
      if (seen.has(key)) throw new Error(`Theme resolver layers overlap at ${key}`)
      seen.add(key)
    }
  }
}

function requireExactThemeScopedInventory(tokens: Readonly<Record<string, TokenValue>>): ResolvedTheme {
  const expected = new Set(THEME_SCOPED_TOKENS)
  const keys = Object.keys(tokens)
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key) || tokens[key] === ""))
    throw new Error("Resolved theme does not match the theme-scoped token inventory")
  // This is the checked boundary from dynamically composed resolver layers to the exact public map.
  return tokens as ResolvedTheme
}
