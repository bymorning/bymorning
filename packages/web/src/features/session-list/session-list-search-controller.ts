import { createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"

import { nextIndex } from "../../ui/list-navigation"
import type { SessionListItem } from "./session-list-model"

export const SESSION_SEARCH_RESULT_LIMIT = 64

export function createSessionListSearchController(input: {
  readonly items: Accessor<ReadonlyArray<SessionListItem>>
  readonly placeholder: Accessor<string>
  readonly noResultsLabel: (query: string) => string
  readonly loading: Accessor<boolean>
  readonly openSession: (sessionID: string) => void
}) {
  const [state, setState] = createStore({ value: "", focused: false, highlighted: "" })
  let root: HTMLDivElement | undefined
  let searchInput: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  const query = createMemo(() => state.value.trim())
  const results = createMemo(() => {
    const value = query().toLowerCase()
    if (!value) return []
    return input
      .items()
      .filter((item) => `${item.title} ${item.project.name}`.toLowerCase().includes(value))
      .slice(0, SESSION_SEARCH_RESULT_LIMIT)
  })
  const active = createMemo(() => {
    const items = results()
    if (items.some((item) => item.key === state.highlighted)) return state.highlighted
    return items[0]?.key ?? ""
  })
  const open = createMemo(() => state.focused && query().length > 0)

  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!open()) return
      const target = event.target
      if (!(target instanceof Node) || root?.contains(target)) return
      close()
    }
    document.addEventListener("pointerdown", outside)
    onCleanup(() => document.removeEventListener("pointerdown", outside))
  })

  function focus() {
    searchInput?.focus()
    setState("focused", true)
  }

  function close() {
    setState({ value: "", focused: false, highlighted: "" })
  }

  function select(item: SessionListItem) {
    input.openSession(item.id)
    close()
  }

  return {
    query: {
      value: () => state.value,
      placeholder: input.placeholder,
      open,
      focus,
      input: (value: string) => setState({ value, highlighted: "" }),
      close,
    },
    result: {
      loading: input.loading,
      list: results,
      active,
      noResultsLabel: () => input.noResultsLabel(query()),
      highlight: (item: SessionListItem) => setState("highlighted", item.key),
      move: (delta: 1 | -1) => {
        const items = results()
        if (items.length === 0) return
        const key =
          items[
            nextIndex(
              items.length,
              items.findIndex((item) => item.key === active()),
              delta,
            )
          ]!.key
        setState("highlighted", key)
        list?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.scrollIntoView({ block: "nearest" })
      },
      select,
      selectActive: () => {
        const item = results().find((item) => item.key === active())
        if (item) select(item)
      },
    },
    element: {
      setRoot: (element: HTMLDivElement) => (root = element),
      setInput: (element: HTMLInputElement) => (searchInput = element),
      setList: (element: HTMLDivElement) => (list = element),
    },
  }
}

export type SessionListSearchController = ReturnType<typeof createSessionListSearchController>
