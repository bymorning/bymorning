import { onCleanup } from "solid-js"
import { createStore, reconcile, unwrap, type SetStoreFunction, type Store } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"

import { errorMessage } from "../utils/error-message"

export type SubmitResult<R> =
  | { readonly type: "success"; readonly value: R }
  | { readonly type: "invalid"; readonly message: string }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "ignored" }

export interface Form<V extends object, R> {
  readonly values: Store<V>
  readonly set: SetStoreFunction<V>
  readonly pending: boolean
  readonly error: string | undefined
  submit(): Promise<SubmitResult<R>>
  reset(): void
}

export function createForm<V extends object, R>(input: {
  readonly values: V
  readonly validate?: (values: Store<V>) => string | undefined
  readonly submit: (values: Store<V>) => R | Promise<R>
  /** Compatibility message used when a submission rejects with a non-Error. */
  readonly fallback?: string
}): Form<V, R> {
  const initial = snapshot(input.values)
  const [state, setState] = createStore({
    values: snapshot(initial),
    validation: undefined as string | undefined,
  })
  const mutation = useMutation<R, unknown, V>(() => ({
    mutationFn: async (values) => input.submit(values),
    retry: false,
    networkMode: "always",
    throwOnError: false,
    gcTime: 0,
  }))
  const message = (cause: unknown) => errorMessage(cause, input.fallback ?? "Something went wrong.")
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const set = ((...args: unknown[]) => {
    setState("values", ...(args as [never]))
    // A validation message already on screen tracks the edits that answer it instead of going stale.
    if (state.validation !== undefined) setState("validation", input.validate?.(state.values))
  }) as SetStoreFunction<V>
  return {
    get values() {
      return state.values
    },
    set,
    get pending() {
      return mutation.isPending
    },
    get error() {
      return state.validation ?? (mutation.isError ? message(mutation.error) : undefined)
    },
    reset() {
      if (disposed || mutation.isPending) return
      setState("values", reconcile(snapshot(initial)))
      setState("validation", undefined)
      mutation.reset()
    },
    async submit() {
      if (disposed || mutation.isPending) return { type: "ignored" }
      mutation.reset()
      setState("validation", undefined)
      const invalid = input.validate?.(state.values)
      if (invalid) {
        setState("validation", invalid)
        return { type: "invalid", message: invalid }
      }
      try {
        const value = await mutation.mutateAsync(snapshot(state.values))
        if (disposed) return { type: "ignored" }
        return { type: "success", value }
      } catch (cause) {
        if (disposed) return { type: "ignored" }
        return { type: "failed", message: message(cause) }
      }
    },
  }
}

// Clone draft containers without losing immutable File/Blob values or Date types.
function snapshot<T>(value: T): T {
  const raw = unwrap(value)
  if (raw instanceof Date) return new Date(raw) as T
  if (Array.isArray(raw)) return raw.map(snapshot) as T
  if (raw && typeof raw === "object" && Object.getPrototypeOf(raw) === Object.prototype) {
    return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, snapshot(item)])) as T
  }
  return raw
}

export { FormFrame } from "./components/form-frame"
export { FormDialog } from "./components/form-dialog"
