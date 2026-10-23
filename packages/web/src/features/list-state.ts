import { createMemo, onMount, type Accessor } from "solid-js"

export type ListState<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "empty" }
  | { readonly status: "ready"; readonly items: ReadonlyArray<T> }

// Structural mirror of the data context's DataState: features may not import `context/`.
export type ListSourceState =
  { readonly state: "idle" | "loading" | "ready" } | { readonly state: "error"; readonly message: string }

export function deriveListState<T>(sourceState: ListSourceState, items: ReadonlyArray<T> | undefined): ListState<T> {
  if (items && items.length > 0) return { status: "ready", items }
  if (items && sourceState.state === "ready") return { status: "empty" }
  if (sourceState.state === "error") return { status: "error", message: sourceState.message }
  return { status: "loading" }
}

export function createListController<T>(options: {
  readonly sourceState: Accessor<ListSourceState>
  readonly list: Accessor<ReadonlyArray<T> | undefined>
  readonly sync: () => Promise<void> | void
}) {
  const state = createMemo(() => deriveListState(options.sourceState(), options.list()))
  const retry = () => void Promise.resolve(options.sync()).catch(() => undefined)

  onMount(retry)

  return { state, retry }
}
