import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"

import { type CommandOption } from "../shell/commands/context"
import { nextIndex } from "../ui/list-navigation"

export function createCommandDialogModel(input: {
  readonly options: Accessor<ReadonlyArray<CommandOption>>
  readonly initialLimit?: number | null
  readonly search: Accessor<
    ((query: string, signal: AbortSignal) => Promise<ReadonlyArray<CommandOption>>) | undefined
  >
}) {
  const [query, setQueryValue] = createSignal("")
  const [active, setActive] = createStore({ index: 0, id: undefined as string | undefined })
  const [searchEntries, setSearchEntries] = createSignal<ReadonlyArray<CommandOption>>([])
  const preview = { id: undefined as string | undefined, cleanup: undefined as void | (() => void) }
  const entries = createMemo(() => {
    const value = query().trim()
    const options = input.options()
    if (!value) return input.initialLimit === null ? options : options.slice(0, input.initialLimit ?? 5)
    return [...options.filter((entry) => matchesEntry(entry, value)), ...searchEntries()].filter(
      (entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index,
    )
  })
  const groupedEntries = createMemo(() => groups(entries()))
  const activeEntry = createMemo(() => entries()[active.index])

  createEffect(
    on(
      () => [query(), input.search()] as const,
      ([rawQuery, search]) => {
        const value = rawQuery.trim()
        if (!value || !search) {
          setSearchEntries([])
          return
        }
        const abort = new AbortController()
        const timeout = setTimeout(() => {
          void search(value, abort.signal).then(
            (result) => {
              if (!abort.signal.aborted) setSearchEntries(result)
            },
            () => {
              if (!abort.signal.aborted) setSearchEntries([])
            },
          )
        }, 100)
        onCleanup(() => {
          clearTimeout(timeout)
          abort.abort()
        })
      },
    ),
  )

  const cancelPreview = () => {
    preview.cleanup?.()
    preview.cleanup = undefined
    preview.id = undefined
  }
  const activate = (index: number) => setActive({ index, id: entries()[index]?.id })
  createEffect(
    on(
      () => [entries(), active.id] as const,
      ([values, id]) => {
        const index = id ? values.findIndex((entry) => entry.id === id) : -1
        activate(index < 0 ? 0 : index)
      },
    ),
  )
  createEffect(() => {
    const entry = activeEntry()
    cancelPreview()
    if (!entry) return
    preview.id = entry.id
    preview.cleanup = entry.onHighlight?.()
  })
  onCleanup(cancelPreview)

  const move = (delta: -1 | 1) => {
    const count = entries().length
    if (count === 0) return
    activate(nextIndex(count, active.index, delta))
  }
  const select = (entry: CommandOption | undefined, beforeSelect: () => void) => {
    if (!entry) return
    if (preview.id === entry.id) {
      preview.cleanup = undefined
      preview.id = undefined
    } else {
      cancelPreview()
      entry.onHighlight?.()
    }
    beforeSelect()
    entry.onSelect?.("palette")
  }

  return {
    query,
    entries,
    groupedEntries,
    activeEntry,
    setQuery(value: string) {
      setQueryValue(value)
      setActive("id", undefined)
    },
    activate,
    move,
    select,
  }
}

function groups(entries: ReadonlyArray<CommandOption>) {
  const map = new Map<string, CommandOption[]>()
  entries.forEach((entry) =>
    map.set(entry.category ?? "Commands", [...(map.get(entry.category ?? "Commands") ?? []), entry]),
  )
  return Array.from(map.entries()).map(([category, entries]) => ({ category, entries }))
}

function matchesEntry(entry: CommandOption, query: string) {
  const value = query.toLowerCase()
  return [entry.title, entry.description, entry.category].some((text) => text?.toLowerCase().includes(value))
}
