import { blend, contrastRatio, hexToOklch, shift } from "./color"
import type { HexColor, ThemeMode, TokenValue } from "./types"

const GREY_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

const greyRef = (step: number): TokenValue => `var(--color-grey-${step})`

function greyHex(primitives: Record<string, TokenValue>, step: number) {
  const hex = primitives[`color-grey-${step}`]
  if (hex && isHexColor(hex)) return hex
  return undefined
}

function isHexColor(value: string): value is HexColor {
  return value.startsWith("#")
}

function resolveSurface(value: TokenValue, primitives: Record<string, TokenValue>) {
  if (isHexColor(value)) return value
  const step = value.match(/^var\(--color-grey-(\d+)\)$/)?.[1]
  if (!step) throw new Error(`Expected grey primitive ref, got ${value}`)
  const hex = greyHex(primitives, Number(step))
  if (!hex) throw new Error(`Missing grey primitive color-grey-${step}`)
  return hex
}

function pickGrey(primitives: Record<string, TokenValue>, background: HexColor, minContrast: number, target: number) {
  const matches = GREY_STEPS.filter((step) => {
    const hex = greyHex(primitives, step)
    return hex && contrastRatio(hex, background) >= minContrast
  })
  if (matches.length === 0) return target
  return matches.reduce((best, step) => (Math.abs(step - target) < Math.abs(best - target) ? step : best))
}

export function mapForeground(input: {
  readonly ink: HexColor
  readonly mode: ThemeMode
  readonly primitives: Record<string, TokenValue>
  readonly semantics: Record<string, TokenValue>
}): Record<string, TokenValue> {
  const { ink, primitives, semantics } = input
  const isDark = input.mode === "dark"
  const tint = hexToOklch(ink)
  const body = shift(ink, {
    l: isDark ? Math.max(0, 0.88 - tint.l) * 0.4 : -Math.max(0, tint.l - 0.18) * 0.24,
    c: isDark ? 1.04 : 1.02,
  })

  const bgBase = resolveSurface(requireValue(semantics, "color-bg-base"), primitives)
  const bgContrast = resolveSurface(requireValue(semantics, "color-bg-contrast"), primitives)
  const bgInverse = resolveSurface(requireValue(semantics, "color-bg-inverse"), primitives)
  const inverseTarget = hexToOklch(bgInverse).l > 0.55 ? 1100 : greyHex(primitives, 50) ? 50 : 100

  return {
    "color-text-base": isDark ? blend("#ffffff", body, 0.9) : shift(body, { l: -0.07, c: 1.04 }),
    "color-text-muted": shift(body, { l: isDark ? -0.11 : 0.11, c: 0.9 }),
    "color-text-faint": shift(body, { l: isDark ? -0.2 : 0.21, c: isDark ? 0.78 : 0.72 }),
    "color-icon-base": greyRef(pickGrey(primitives, bgBase, 7, isDark ? 400 : 800)),
    "color-icon-muted": greyRef(pickGrey(primitives, bgBase, 3, 600)),
    "color-icon-inverse": greyRef(pickGrey(primitives, bgInverse, 7, inverseTarget)),
    "color-icon-contrast": greyRef(pickGrey(primitives, bgContrast, 7, 100)),
    "color-icon-accent": isDark ? "var(--color-orange-400)" : "var(--color-orange-600)",
    "color-icon-accent-hover": isDark ? "var(--color-orange-300)" : "var(--color-orange-700)",
  }
}

function requireValue(tokens: Record<string, TokenValue>, key: string): TokenValue {
  const value = tokens[key]
  if (value === undefined) throw new Error(`Missing theme token: ${key}`)
  return value
}
