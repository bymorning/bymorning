import { isFontID } from "./font"
import type {
  ButtonPaint,
  ButtonPrimaryState,
  ButtonTheme,
  PaletteColor,
  ThemeColor,
  ThemeDefinition,
  ThemeFonts,
  ThemePalette,
  ThemeVariant,
} from "./types"

const PALETTE_KEYS = ["neutral", "ink", "primary", "success", "warning", "error", "info", "accent"] as const
const THEME_COLOR_REFERENCES = [...PALETTE_KEYS, "interactive"] as const

export function requireTheme(value: unknown): ThemeDefinition {
  if (isTheme(value)) return value
  const invalidPaletteColor = findInvalidPaletteColor(value)
  if (invalidPaletteColor)
    throw new Error(`Invalid theme palette color at ${invalidPaletteColor}: expected opaque six-digit #RRGGBB`)
  throw new Error("Invalid theme")
}

function isTheme(value: unknown): value is ThemeDefinition {
  return (
    isRecord(value) &&
    hasKeys(
      value,
      value.components === undefined
        ? ["id", "name", "radius", "fonts", "light", "dark"]
        : ["id", "name", "radius", "fonts", "components", "light", "dark"],
    ) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    isRadius(value.radius) &&
    isFonts(value.fonts) &&
    (value.components === undefined || isComponents(value.components)) &&
    isVariant(value.light) &&
    isVariant(value.dark)
  )
}

function isComponents(value: unknown) {
  return (
    isRecord(value) &&
    hasKeys(value, value.button === undefined ? [] : ["button"]) &&
    (value.button === undefined || isButton(value.button))
  )
}

function isButton(value: unknown): value is ButtonTheme {
  if (!isRecord(value) || !hasOnlyKeys(value, ["radius", "focusRing", "primary"])) return false
  if (value.radius !== undefined && value.radius !== "theme" && value.radius !== "pill") return false
  if (value.focusRing !== undefined && !isThemeColor(value.focusRing)) return false
  if (value.primary === undefined) return true
  if (!isRecord(value.primary) || !hasOnlyKeys(value.primary, ["shadow", "hoverEffect", "base", "hover", "pressed"]))
    return false
  if (value.primary.shadow !== undefined && value.primary.shadow !== "theme" && value.primary.shadow !== "none") return false
  if (value.primary.hoverEffect !== undefined && value.primary.hoverEffect !== "fill" && value.primary.hoverEffect !== "edge-glow")
    return false
  if (
    value.primary.hoverEffect === "edge-glow" &&
    (!isRecord(value.primary.hover) ||
      !isRecord(value.primary.hover.paint) ||
      value.primary.hover.paint.type !== "linear-gradient" ||
      value.primary.hover.foreground !== undefined)
  )
    return false
  return [value.primary.base, value.primary.hover, value.primary.pressed].every(
    (state) => state === undefined || isButtonState(state),
  )
}

function isButtonState(value: unknown): value is ButtonPrimaryState {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["paint", "foreground"]) &&
    (value.paint === undefined || isButtonPaint(value.paint)) &&
    (value.foreground === undefined || isThemeColor(value.foreground))
  )
}

function isButtonPaint(value: unknown): value is ButtonPaint {
  if (!isRecord(value) || typeof value.type !== "string") return false
  if (value.type === "solid") return hasKeys(value, ["type", "color"]) && isThemeColor(value.color)
  return (
    value.type === "linear-gradient" &&
    hasKeys(value, value.positions === undefined ? ["type", "angle", "stops"] : ["type", "angle", "stops", "positions"]) &&
    (value.angle === 0 || value.angle === 90 || value.angle === 180 || value.angle === 270) &&
    Array.isArray(value.stops) &&
    value.stops.length >= 2 &&
    value.stops.length <= 4 &&
    value.stops.every(isThemeColor) &&
    (value.positions === undefined || isGradientPositions(value.positions, value.stops.length))
  )
}

function isGradientPositions(value: unknown, stopCount: number) {
  if (!Array.isArray(value) || value.length !== stopCount) return false
  return value.every(
    (position, index) =>
      typeof position === "number" &&
      Number.isFinite(position) &&
      position >= 0 &&
      position <= 100 &&
      (index === 0 || position >= value[index - 1]!),
  )
}

function isVariant(value: unknown): value is ThemeVariant {
  return isRecord(value) && hasKeys(value, ["palette"]) && isPalette(value.palette)
}

function isPalette(value: unknown): value is ThemePalette {
  if (!isRecord(value)) return false
  if (!hasKeys(value, value.interactive === undefined ? PALETTE_KEYS : [...PALETTE_KEYS, "interactive"])) return false
  if (!PALETTE_KEYS.every((key) => isPaletteColor(value[key]))) return false
  if (value.interactive !== undefined && !isPaletteColor(value.interactive)) return false
  return true
}

function findInvalidPaletteColor(value: unknown) {
  if (!isRecord(value)) return
  for (const mode of ["light", "dark"] as const) {
    const variant = value[mode]
    if (!isRecord(variant) || !isRecord(variant.palette)) continue
    for (const key of [...PALETTE_KEYS, "interactive"] as const) {
      if (key in variant.palette && !isPaletteColor(variant.palette[key])) return `${mode}.${key}`
    }
  }
}

function isFonts(value: unknown): value is ThemeFonts {
  return (
    isRecord(value) &&
    hasKeys(value, ["heading", "body", "mono"]) &&
    isFontID(value.heading) &&
    isFontID(value.body) &&
    isFontID(value.mono)
  )
}

function isRadius(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isThemeColor(value: unknown): value is ThemeColor {
  return isPaletteColor(value) || (typeof value === "string" && THEME_COLOR_REFERENCES.some((color) => color === value))
}

function isPaletteColor(value: unknown): value is PaletteColor {
  if (typeof value !== "string") return false
  return /^#[0-9a-f]{6}$/i.test(value)
}
