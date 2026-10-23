import { createMemo, createSignal, onCleanup, onMount, type Accessor, type JSX } from "solid-js"

import { useDialog } from "../../context/dialog"
import { createSimpleContext } from "../../context/helper"
import { useSettings } from "../../context/settings"

export interface CommandOption {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly meta?: string
  readonly category?: string
  readonly keybind?: string
  readonly icon?: JSX.Element
  readonly disabled?: boolean
  readonly hidden?: boolean
  readonly slash?: string
  /** Fires the keybind even while focus is inside an editable field (input, textarea, contenteditable). */
  readonly evenWhileTyping?: boolean
  readonly when?: (event: KeyboardEvent) => boolean
  readonly onSelect?: (source?: "palette" | "keybind" | "slash") => void
  readonly onHighlight?: () => void | (() => void)
}
interface CommandRegistration {
  readonly key: string | undefined
  readonly options: Accessor<ReadonlyArray<CommandOption>>
}

export const { provider: CommandProvider, use: useCommand } = createSimpleContext({
  name: "Command",
  /** Own active web commands, exact key matching, and shortcut dispatch. */
  init: () => {
    const dialog = useDialog()
    const settings = useSettings()
    const [registrations, setRegistrations] = createSignal<CommandRegistration[]>([])
    // A route transition can commit a stale `registrations` value over a disposal write made while
    // the old route is torn down, resurrecting its commands. Removal is therefore also recorded here.
    const removed = new WeakSet<CommandRegistration>()
    const options = createMemo(() => {
      const keys = new Set<string>()
      const seen = new Set<string>()
      return registrations()
        .filter((item) => !removed.has(item))
        .filter((item) => item.key === undefined || (!keys.has(item.key) && !!keys.add(item.key)))
        .flatMap((entry) => entry.options())
        .filter((item) => !seen.has(item.id) && !!seen.add(item.id))
        .map((item) => {
          const keybind = settings.keybinds.get(item.id) ?? item.keybind
          return keybind === undefined ? item : { ...item, keybind }
        })
    })
    const bindings = createMemo(() => {
      const value = new Map<
        string,
        Array<{ option: CommandOption; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }>
      >()
      for (const item of options()) {
        if (!item.keybind || item.keybind === "none" || item.disabled) continue
        for (const combo of item.keybind.split(",")) {
          const parts = combo.trim().toLowerCase().split("+")
          const modifiers = new Set(parts.slice(0, -1))
          const mod = modifiers.has("mod")
          const mac = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)
          const key = parts.at(-1)!
          value.set(key, [
            ...(value.get(key) ?? []),
            {
              option: item,
              ctrl: modifiers.has("ctrl") || modifiers.has("control") || (mod && !mac),
              meta: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command") || (mod && mac),
              shift: modifiers.has("shift"),
              alt: modifiers.has("alt") || modifiers.has("option"),
            },
          ])
        }
      }
      return value
    })
    const register = (key: string, options: () => ReadonlyArray<CommandOption>) => {
      const entry = { key, options: createMemo(options) }
      setRegistrations((items) => [entry, ...items.filter((item) => !removed.has(item))])
      onCleanup(() => {
        removed.add(entry)
        setRegistrations((items) => items.filter((item) => item !== entry))
      })
    }
    const keydown = (event: KeyboardEvent) => {
      if (dialog.active || event.repeat || event.defaultPrevented) return
      const items = bindings()
        .get(
          event.key === ","
            ? "comma"
            : event.key === "+"
              ? "plus"
              : event.key === " "
                ? "space"
                : event.key.toLowerCase(),
        )
        ?.filter(
          (item) =>
            item.ctrl === event.ctrlKey &&
            item.meta === event.metaKey &&
            item.shift === event.shiftKey &&
            item.alt === event.altKey,
        )
        .map((item) => item.option)
      const item = items?.find((item) => item.when?.(event)) ?? items?.find((item) => !item.when)
      if (
        !item ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            event.target.closest(
              "input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']",
            ) !== null) &&
          !item.evenWhileTyping)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      item.onSelect?.("keybind")
    }
    onMount(() => window.addEventListener("keydown", keydown, true))
    onCleanup(() => window.removeEventListener("keydown", keydown, true))
    return {
      options,
      register,
      slash: {
        search: (input: string) => {
          const match = /^\/([^\s]*)$/.exec(input)
          if (!match) return undefined
          return options().filter(
            (item) =>
              !item.disabled &&
              item.slash !== undefined &&
              item.slash.toLowerCase().startsWith(match[1]!.toLowerCase()),
          )
        },
        select: (option: CommandOption) => {
          const item = options().find((item) => item.id === option.id && item.slash !== undefined && !item.disabled)
          if (!item?.onSelect) return false
          item.onSelect("slash")
          return true
        },
      },
    }
  },
})

export type CommandValue = ReturnType<typeof useCommand>
