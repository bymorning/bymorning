import type { FontID } from "./font"

export type HexColor = `#${string}`
declare const paletteColorBrand: unique symbol
/** Opaque six-digit #RRGGBB accepted at the theme palette input boundary. */
export type PaletteColor = `#${string}` & { readonly [paletteColorBrand]: true }
export type ThemeMode = "light" | "dark"

export type ColorScale = readonly [
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
  HexColor,
]

export interface OklchColor {
  readonly l: number
  readonly c: number
  readonly h: number
}

export interface ThemePalette {
  readonly neutral: PaletteColor
  readonly ink: PaletteColor
  readonly primary: PaletteColor
  readonly success: PaletteColor
  readonly warning: PaletteColor
  readonly error: PaletteColor
  readonly info: PaletteColor
  readonly accent: PaletteColor
  readonly interactive?: PaletteColor
}

export interface ThemeFonts {
  readonly heading: FontID
  readonly body: FontID
  readonly mono: FontID
}

export interface ThemeVariant {
  readonly palette: ThemePalette
}

export type ThemePaletteReference = keyof ThemePalette
/** A runtime-validated palette color or a reference to one. Imported JSON still requires `requireTheme`. */
export type ThemeColor = PaletteColor | ThemePaletteReference

export interface SolidPaint {
  readonly type: "solid"
  readonly color: ThemeColor
}

export interface LinearGradientPaint {
  readonly type: "linear-gradient"
  readonly angle: 0 | 90 | 180 | 270
  readonly stops:
    | readonly [ThemeColor, ThemeColor]
    | readonly [ThemeColor, ThemeColor, ThemeColor]
    | readonly [ThemeColor, ThemeColor, ThemeColor, ThemeColor]
  readonly positions?:
    readonly [number, number] | readonly [number, number, number] | readonly [number, number, number, number]
}

export type ButtonPaint = SolidPaint | LinearGradientPaint

export interface ButtonPrimaryState {
  readonly paint?: ButtonPaint
  readonly foreground?: ThemeColor
}

export interface ButtonTheme {
  readonly radius?: "theme" | "pill"
  readonly focusRing?: ThemeColor
  readonly primary?: {
    readonly shadow?: "theme" | "none"
    readonly hoverEffect?: "fill" | "edge-glow"
    readonly base?: ButtonPrimaryState
    readonly hover?: ButtonPrimaryState
    readonly pressed?: ButtonPrimaryState
  }
}

export interface ThemeComponents {
  readonly button?: ButtonTheme
}

export interface ThemeDefinition {
  readonly id: string
  readonly name: string
  readonly radius: number
  readonly fonts: ThemeFonts
  readonly components?: ThemeComponents
  readonly light: ThemeVariant
  readonly dark: ThemeVariant
}

export type Hue = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink"
export type Step = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 | 1100 | 1200
export type GreyStep = 50 | Step
export type AlphaTone = "dark" | "light"
export type AlphaStep = 0 | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 20 | 24 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100
export type PrimitiveToken = (typeof import("./tokens").PRIMITIVE_TOKENS)[number]
export type SemanticToken = (typeof import("./tokens").SEMANTIC_TOKENS)[number]
export type Token = PrimitiveToken | SemanticToken
export type TokenValue = string
export type ThemeScopedToken = (typeof import("./tokens").THEME_SCOPED_TOKENS)[number]
export type ResolvedTheme = Readonly<Record<ThemeScopedToken, TokenValue>>
