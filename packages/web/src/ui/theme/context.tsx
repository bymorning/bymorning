import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"

import { applyThemeToDocument, getColorSchemeMedia } from "./browser-adapter"
import {
  normalizeScheme,
  normalizeTheme,
  parseTheme,
  resolveMode,
  themeName,
  THEME_IDS,
  type ColorScheme,
  type ThemeID,
  type ThemeMode,
} from "./model"
import { readThemeStorage, THEME_STORAGE, writeThemeStorage } from "./storage-adapter"

export { THEME_STORAGE } from "./storage-adapter"
export type { ColorScheme, ThemeID, ThemeMode } from "./model"

interface ThemeValue {
  readonly theme: Accessor<ThemeID>
  readonly scheme: Accessor<ColorScheme>
  readonly mode: Accessor<ThemeMode>
  readonly ids: Accessor<readonly ThemeID[]>
  readonly name: (id: string) => string | undefined
  readonly setTheme: (id: string) => void
  readonly setColorScheme: (scheme: ColorScheme) => void
}

const ThemeContext = createContext<ThemeValue>()

export function ThemeProvider(props: ParentProps): JSX.Element {
  const initialTheme = normalizeTheme(readThemeStorage(THEME_STORAGE.theme))
  const initialScheme = normalizeScheme(readThemeStorage(THEME_STORAGE.scheme))
  const [theme, setThemeValue] = createSignal<ThemeID>(initialTheme)
  const [scheme, setSchemeValue] = createSignal<ColorScheme>(initialScheme)
  const [mode, setMode] = createSignal<ThemeMode>(resolveCurrentMode(initialScheme))

  const setTheme = (id: string) => {
    const selected = normalizeTheme(id)
    if (!parseTheme(id)) console.warn(`Theme "${id}" not found`)
    setThemeValue(selected)
    writeThemeStorage(THEME_STORAGE.theme, selected)
  }

  const setColorScheme = (value: ColorScheme) => {
    const selected = normalizeScheme(value)
    setSchemeValue(selected)
    setMode(resolveCurrentMode(selected))
    writeThemeStorage(THEME_STORAGE.scheme, selected)
  }

  onMount(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE.theme) {
        setThemeValue(normalizeTheme(event.newValue))
      }
      if (event.key === THEME_STORAGE.scheme) {
        const selected = normalizeScheme(event.newValue)
        setSchemeValue(selected)
        setMode(resolveCurrentMode(selected))
      }
    }
    const media = getColorSchemeMedia()
    const onMedia = () => {
      if (scheme() === "system") setMode(resolveCurrentMode("system"))
    }
    window.addEventListener("storage", onStorage)
    media?.addEventListener("change", onMedia)
    onCleanup(() => {
      window.removeEventListener("storage", onStorage)
      media?.removeEventListener("change", onMedia)
    })
  })

  createEffect(() => applyThemeToDocument(theme(), mode()))

  const value: ThemeValue = {
    theme,
    scheme,
    mode,
    ids: () => THEME_IDS,
    name: themeName,
    setTheme,
    setColorScheme,
  }

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("ThemeProvider is missing")
  return value
}

function resolveCurrentMode(scheme: ColorScheme) {
  return resolveMode(scheme, scheme === "system" && Boolean(getColorSchemeMedia()?.matches))
}
