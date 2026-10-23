export const THEME_STORAGE = {
  theme: "bymorning-theme-id",
  scheme: "bymorning-color-scheme",
} as const

export function readThemeStorage(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeThemeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    console.warn(`Could not persist theme storage key "${key}"`)
  }
}
