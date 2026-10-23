import { onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"

import { validateAmount } from "../amount"
import { errorMessage } from "../../utils/error-message"
import "./usage-limit.css"

export function Usage(props: { readonly usage?: number | undefined; readonly limit?: number | undefined }): JSX.Element {
  return (
    <span data-component="usage-value">
      <Show when={props.usage !== undefined} fallback="—">
        <Show when={props.limit !== undefined}>
          <span data-slot="usage-percent">({percentage(props.usage ?? 0, props.limit ?? 0)}%)</span>
        </Show>
        <span>{money(props.usage ?? 0)}</span>
      </Show>
    </span>
  )
}

export function InlineLimit(props: {
  readonly name: string
  readonly value?: number | undefined
  readonly editable?: boolean
  readonly local?: boolean
  readonly onSave: (value: number | undefined) => Promise<unknown> | unknown
}): JSX.Element {
  const [state, setState] = createStore({ editing: false, draft: "", validation: "" })
  const mutation = useMutation(() => ({
    mutationFn: async (request: { value: number | undefined; save: typeof props.onSave }) => request.save(request.value),
    retry: false,
    networkMode: "always",
    throwOnError: false,
    gcTime: 0,
  }))
  const error = () => state.validation || (mutation.isError ? errorMessage(mutation.error, "Could not update limit.") : "")
  let disposed = false
  onCleanup(() => { disposed = true })
  let suppressBlur = false
  let input: HTMLInputElement | undefined
  const errorID = () => `limit-${safeID(props.name)}-error`
  const start = () => {
    if (!props.editable || mutation.isPending) return
    suppressBlur = false
    mutation.reset()
    setState({ editing: true, draft: props.value?.toString() ?? "", validation: "" })
    queueMicrotask(() => {
      input?.focus()
      input?.select()
    })
  }
  const cancel = () => {
    if (mutation.isPending) return
    suppressBlur = true
    mutation.reset()
    setState({ editing: false, draft: "", validation: "" })
  }
  const save = () => {
    if (disposed || !state.editing || mutation.isPending) return
    mutation.reset()
    const error = validateAmount(state.draft)
    if (error) {
      setState("validation", error)
      input?.focus()
      return
    }
    setState("validation", "")
    void mutation.mutateAsync({ value: state.draft === "" ? undefined : Number(state.draft), save: props.onSave }).then(
      () => { if (!disposed) setState({ editing: false, draft: "", validation: "" }) },
      () => {
        if (disposed) return
        input?.focus()
      },
    )
  }

  return (
    <span data-component="inline-limit" data-editing={state.editing ? "" : undefined} aria-busy={mutation.isPending}>
      <Show
        when={state.editing}
        fallback={
          <button
            type="button"
            data-slot="limit-value"
            disabled={!props.editable}
            aria-label={props.editable ? `${props.value === undefined ? "Set" : "Edit"} ${props.local ? "local " : ""}limit for ${props.name}` : undefined}
            title={props.local ? "Stored locally for this view only" : undefined}
            onClick={start}
          >
            {props.value === undefined ? "No limit" : money(props.value)}
          </button>
        }
      >
        <span data-slot="limit-editor">
          <span aria-hidden="true">$</span>
          <input
            ref={input}
            type="text"
            inputmode="decimal"
            autocomplete="off"
            value={state.draft}
            disabled={mutation.isPending}
            aria-label={`${props.name} ${props.local ? "local " : ""}limit (USD)`}
            aria-invalid={error() ? true : undefined}
            aria-describedby={error() ? errorID() : undefined}
            onInput={(event) => {
              if (mutation.isPending) return
              mutation.reset()
              setState({ draft: event.currentTarget.value, validation: "" })
            }}
            onBlur={() => {
              if (suppressBlur) {
                suppressBlur = false
                return
              }
              save()
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                cancel()
                return
              }
              if (event.key !== "Enter") return
              event.preventDefault()
              save()
            }}
          />
        </span>
      </Show>
      <Show when={mutation.isPending}>
        <span class="sr-only" role="status">Saving limit…</span>
      </Show>
      <Show when={error()}>
        <span id={errorID()} role="alert" data-slot="limit-error">{error()}</span>
      </Show>
    </span>
  )
}

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
const percentage = (usage: number, limit: number) =>
  limit === 0 ? 100 : Math.min(100, Math.round((usage / limit) * 100))
const safeID = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-")
