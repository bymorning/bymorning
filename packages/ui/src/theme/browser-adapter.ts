import type { ThemeID, ThemeMode } from "./model"

export function getColorSchemeMedia(): MediaQueryList | undefined {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined
  } catch {
    return undefined
  }
}

export function applyThemeToDocument(theme: ThemeID, mode: ThemeMode) {
  const color = "var(--color-bg-deep)"
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = color
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", getComputedStyle(document.documentElement).backgroundColor)
}
