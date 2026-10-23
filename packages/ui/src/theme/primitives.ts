import { generateNeutralScale, hexToOklch, oklchToHex, shift } from "./color"
import type { ColorScale, HexColor, ThemePalette, TokenValue } from "./types"

const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** Hue ramps preserve the existing 100-lightest to 1200-darkest generation. */
function generateHueScale(seed: HexColor, isDark: boolean): HexColor[] {
  const base = hexToOklch(seed)
  const chromaBoost = isDark ? 1 : 1.05
  const lightSteps = [
    0.99,
    0.965,
    0.93,
    0.885,
    0.835,
    clamp(base.l, 0.48, 0.72),
    clamp(base.l - 0.07, 0.4, 0.64),
    clamp(base.l - 0.14, 0.32, 0.55),
    clamp(base.l - 0.21, 0.24, 0.46),
    clamp(base.l - 0.28, 0.17, 0.38),
    clamp(base.l - 0.34, 0.12, 0.3),
    clamp(base.l - 0.4, 0.08, 0.22),
  ]
  const chromaMultipliers = [0.28, 0.48, 0.68, 0.86, 1.02, 1.28, 1.34, 1.28, 1.18, 1.08, 0.98, 0.88]

  return lightSteps.map((l, index) =>
    oklchToHex({
      l,
      c: base.c * chromaMultipliers[index]! * chromaBoost,
      h: base.h,
    }),
  )
}

function generateNeutralScaleForTheme(neutral: HexColor, ink: HexColor, isDark: boolean): ColorScale {
  const scale = generateNeutralScale(neutral, isDark, ink)
  if (!isDark) return scale
  return [
    scale[11],
    scale[10],
    scale[9],
    scale[8],
    scale[7],
    scale[6],
    scale[5],
    scale[4],
    scale[3],
    scale[2],
    scale[1],
    scale[0],
  ]
}

function assignHueRamp(prefix: string, scale: readonly HexColor[]) {
  return Object.fromEntries(STEPS.map((step, index) => [`color-${prefix}-${step}`, scale[index]!]))
}

export function generatePrimitives(palette: ThemePalette, isDark: boolean): Record<string, TokenValue> {
  return {
    "color-grey-50": "#ffffffff",
    ...assignHueRamp("grey", generateNeutralScaleForTheme(palette.neutral, palette.ink, isDark)),
    ...assignHueRamp("red", generateHueScale(palette.error, isDark)),
    ...assignHueRamp("orange", generateHueScale(palette.primary, isDark)),
    ...assignHueRamp("yellow", generateHueScale(palette.warning, isDark)),
    ...assignHueRamp("green", generateHueScale(palette.success, isDark)),
    ...assignHueRamp("cyan", generateHueScale(palette.interactive ?? palette.primary, isDark)),
    ...assignHueRamp("blue", generateHueScale(palette.info, isDark)),
    ...assignHueRamp("purple", generateHueScale(palette.accent, isDark)),
    ...assignHueRamp("pink", generateHueScale(shift(palette.accent, { h: 45 }), isDark)),
  }
}
