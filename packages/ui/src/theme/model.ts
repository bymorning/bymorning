export type ColorScheme = "light" | "dark" | "system"
export type ThemeMode = "light" | "dark"
export type ThemeID = "bymorning" | "ink" | "paper"

export const THEME_IDS = ["bymorning", "ink", "paper"] as const

const THEME_NAMES: Readonly<Record<ThemeID, string>> = {
  bymorning: "Sand",
  ink: "Ink",
  "paper": "Paper",
}

export function parseTheme(value: string | null): ThemeID | undefined {
  return value === "bymorning" || value === "ink" || value === "paper" ? value : undefined
}

export function normalizeTheme(value: string | null): ThemeID {
  return parseTheme(value) ?? "paper"
}

export function normalizeScheme(value: string | null): ColorScheme {
  return value === "light" || value === "dark" || value === "system" ? value : "dark"
}

export function resolveMode(scheme: ColorScheme, systemDark: boolean): ThemeMode {
  if (scheme !== "system") return scheme
  return systemDark ? "dark" : "light"
}

export function themeName(id: string) {
  const theme = parseTheme(id)
  return theme ? THEME_NAMES[theme] : undefined
}
