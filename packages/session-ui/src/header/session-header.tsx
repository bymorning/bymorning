import { Show, createEffect, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useSession } from "../context/session.js"
import type { SessionUI } from "../model.js"
import "./session-header.css"

export function SessionHeader(props: { readonly model: SessionUI.HeaderProps }): JSX.Element {
  const session = useSession()
  const [state, setState] = createStore({ editing: false, value: "" })
  let input: HTMLInputElement | undefined
  createEffect(() => {
    if (!state.editing) setState("value", props.model.title())
  })
  const usage = () => props.model.usage?.()
  const save = () => {
    const title = state.value.trim()
    if (title && props.model.rename && !props.model.rename.pending()) props.model.rename.run(title)
  }
  return (
    <header data-component="session-header">
      <div data-slot="identity">
        <Show when={props.model.identity().project?.avatar} fallback={<span aria-hidden="true">◉</span>}>
          {(avatar) => <img src={avatar()} alt="" />}
        </Show>
        <span>{props.model.identity().project?.name ?? props.model.identity().workspace}</span>
      </div>
      <Show
        when={state.editing}
        fallback={
          <Show when={props.model.rename} fallback={<h1>{props.model.title()}</h1>}>
            {(_rename) => (
              <button
                type="button"
                aria-label={session.labels().rename}
                onClick={() => {
                  setState({ editing: true, value: props.model.title() })
                  queueMicrotask(() => input?.focus())
                }}
              >
                <h1>{props.model.title()}</h1>
              </button>
            )}
          </Show>
        }
      >
        <input
          ref={(element) => {
            input = element
          }}
          aria-label={session.labels().sessionTitle}
          value={state.value}
          disabled={props.model.rename?.pending()}
          onInput={(event) => setState("value", event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              save()
            }
            if (event.key === "Escape") setState("editing", false)
          }}
          onBlur={() => setState("editing", false)}
        />
      </Show>
      <Show when={props.model.rename?.error()}>{(error) => <p role="alert">{error()}</p>}</Show>
      <Show when={props.model.status() === "running"}>
        <span
          data-slot="status"
          role="status"
          aria-label={session.labels().statusLabel({ status: session.labels().running })}
        />
      </Show>
      <Show when={usage()}>
        {(value) => (
          <span data-slot="usage" title={`${value().tokens.toLocaleString()} · ${value().cost.toLocaleString()}`}>
            <Show when={value().percentage !== undefined}>
              {(_percentage) => <span data-slot="usage-ring" style={{ "--usage": `${value().percentage}%` }} />}
            </Show>
            <span>{value().tokens.toLocaleString()}</span>
            <span>{value().cost.toLocaleString()}</span>
            <Show when={!value().complete}>
              <span>+</span>
            </Show>
          </span>
        )}
      </Show>
    </header>
  )
}
