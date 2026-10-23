import {
  createContext,
  createEffect,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"

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

export interface ThemeValue {
  readonly theme: Accessor<ThemeID>
  readonly scheme: Accessor<ColorScheme>
  readonly mode: Accessor<ThemeMode>
  readonly list: Accessor<readonly ThemeID[]>
  readonly name: (id: string) => string | undefined
  readonly setTheme: (id: string) => void
  readonly setScheme: (scheme: ColorScheme) => void
}

const ThemeContext = createContext<ThemeValue>()

export function ThemeProvider(props: ParentProps): JSX.Element {
  const initialTheme = normalizeTheme(readThemeStorage(THEME_STORAGE.theme))
  const initialScheme = normalizeScheme(readThemeStorage(THEME_STORAGE.scheme))
  const [state, setState] = createStore({
    theme: initialTheme,
    scheme: initialScheme,
    mode: resolveCurrentMode(initialScheme),
  })

  const setTheme = (id: string) => {
    const selected = normalizeTheme(id)
    if (!parseTheme(id)) console.warn(`Theme "${id}" not found`)
    setState("theme", selected)
    writeThemeStorage(THEME_STORAGE.theme, selected)
  }

  const setScheme = (value: ColorScheme) => {
    const selected = normalizeScheme(value)
    setState({ scheme: selected, mode: resolveCurrentMode(selected) })
    writeThemeStorage(THEME_STORAGE.scheme, selected)
  }

  onMount(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE.theme) {
        setState("theme", normalizeTheme(event.newValue))
      }
      if (event.key === THEME_STORAGE.scheme) {
        const selected = normalizeScheme(event.newValue)
        setState({ scheme: selected, mode: resolveCurrentMode(selected) })
      }
    }
    const media = getColorSchemeMedia()
    const onMedia = () => {
      if (state.scheme === "system") setState("mode", resolveCurrentMode("system"))
    }
    window.addEventListener("storage", onStorage)
    media?.addEventListener("change", onMedia)
    onCleanup(() => {
      window.removeEventListener("storage", onStorage)
      media?.removeEventListener("change", onMedia)
    })
  })

  createEffect(() => applyThemeToDocument(state.theme, state.mode))

  const value: ThemeValue = {
    theme: () => state.theme,
    scheme: () => state.scheme,
    mode: () => state.mode,
    list: () => THEME_IDS,
    name: themeName,
    setTheme,
    setScheme,
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
