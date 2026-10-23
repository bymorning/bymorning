import { createStore } from "solid-js/store"

import { createSimpleContext } from "./helper"
import { Persist, persisted, type SyncStorage } from "../runtime/persistence/storage"

const settingsTarget = Persist.global("settings.v1")

export const SETTINGS_STORAGE_KEY = settingsTarget.key

export interface Settings {
  readonly general: {
    readonly showAgent: boolean
    readonly showModelVariant: boolean
    readonly renderMarkdown: boolean
    readonly showReasoningSummaries: boolean
    readonly showSessionUsage: boolean
    readonly toggleAgent: () => void
    readonly toggleMarkdown: () => void
    readonly toggleReasoning: () => void
    readonly toggleSessionUsage: () => void
    readonly toggleVariant: () => void
  }
  readonly keybinds: {
    readonly get: (key: string) => string | undefined
    readonly set: (key: string, value: string) => void
  }
  readonly picker: {
    readonly get: (key: string) => "show" | "hide" | undefined
    readonly set: (key: string, value: "show" | "hide") => void
  }
}

export const { provider: SettingsProvider, use: useSettings, optional: useOptionalSettings } = createSimpleContext({
  name: "Settings",
  init: (props: { readonly storage?: SyncStorage }): Settings => {
    const store = createStore<{
      general: {
        showAgent: boolean
        showModelVariant: boolean
        renderMarkdown: boolean
        showReasoningSummaries: boolean
        showSessionUsage: boolean
      }
      keybinds: Record<string, string>
      picker: Record<string, "show" | "hide">
    }>({
      general: {
        showAgent: false,
        showModelVariant: false,
        renderMarkdown: true,
        showReasoningSummaries: false,
        showSessionUsage: false,
      },
      keybinds: {},
      picker: {},
    })
    // Explicit store typing selects the store overload across the signal/store union.
    // oxlint-disable-next-line typescript-eslint/no-unnecessary-type-arguments
    const [settings, setSettings] = persisted<(typeof store)[0], typeof store>(settingsTarget, store, {
      storage: props.storage,
    })

    return {
      picker: {
        get: (key) => settings.picker?.[key],
        set: (key, value) => setSettings("picker", (picker = {}) => ({ ...picker, [key]: value })),
      },
      general: {
        get showAgent() {
          return settings.general.showAgent ?? false
        },
        get showModelVariant() {
          return settings.general.showModelVariant ?? false
        },
        get renderMarkdown() {
          return settings.general.renderMarkdown ?? true
        },
        get showReasoningSummaries() {
          return settings.general.showReasoningSummaries ?? false
        },
        get showSessionUsage() {
          return settings.general.showSessionUsage ?? false
        },
        toggleAgent: () => setSettings("general", "showAgent", (value) => !(value ?? false)),
        toggleMarkdown: () => setSettings("general", "renderMarkdown", (value) => !(value ?? true)),
        toggleReasoning: () => setSettings("general", "showReasoningSummaries", (value) => !value),
        toggleSessionUsage: () => setSettings("general", "showSessionUsage", (value) => !(value ?? false)),
        toggleVariant: () => setSettings("general", "showModelVariant", (value) => !(value ?? false)),
      },
      keybinds: {
        get: (key) => settings.keybinds[key],
        set: (key, value) => setSettings("keybinds", key, value),
      },
    }
  },
})
