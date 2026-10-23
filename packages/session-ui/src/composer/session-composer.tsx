import { For, Show, createEffect, createUniqueId, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useSession } from "../context/session.js"
import type { SessionUI } from "../model.js"
import "./session-composer.css"

type Mention = { readonly key: string; readonly label: string; readonly insert: string }

export function SessionComposer(props: { readonly model: SessionUI.ComposerProps }): JSX.Element {
  const session = useSession()
  const [state, setState] = createStore({
    open: false,
    kind: "command" as "command" | "mention",
    index: 0,
    mentions: [] as readonly Mention[],
  })
  let input: HTMLTextAreaElement | undefined
  let files: HTMLInputElement | undefined
  let request: AbortController | undefined
  const listID = createUniqueId()
  const disabled = () => props.model.disabled() || props.model.submit.pending()
  const commands = () => props.model.commands?.() ?? []
  const items = () => (state.kind === "command" ? commands() : state.mentions)
  const close = () => {
    request?.abort()
    request = undefined
    setState({ open: false, index: 0, mentions: [] })
  }
  onCleanup(() => request?.abort())
  createEffect(() => {
    if (disabled()) close()
  })
  const select = () => {
    const selected = items()[state.index]
    if (!selected) return false
    if (state.kind === "command") {
      const command = selected as { readonly action: SessionUI.Operation }
      command.action.run()
    } else {
      const mention = selected as Mention
      const value = props.model.value()
      const end = input?.selectionStart ?? value.length
      const start = value.lastIndexOf("@", end)
      props.model.setValue(`${value.slice(0, start)}${mention.insert}${value.slice(end)}`)
    }
    close()
    queueMicrotask(() => input?.focus())
    return true
  }
  const change: JSX.EventHandler<HTMLTextAreaElement, InputEvent> = (event) => {
    const value = event.currentTarget.value
    props.model.setValue(value)
    const before = value.slice(0, event.currentTarget.selectionStart)
    const mention = before.match(/@([^\s@]*)$/)?.[1]
    if (mention !== undefined && props.model.mentions) {
      request?.abort()
      request = new AbortController()
      const current = request
      void props.model.mentions.search(mention, current.signal).then(
        (found) => {
          if (!current.signal.aborted) setState({ open: true, kind: "mention", mentions: found, index: 0 })
        },
        () => undefined,
      )
      return
    }
    if (/\/(\S*)$/.test(before) && props.model.commands) {
      setState({ open: true, kind: "command", index: 0 })
      return
    }
    close()
  }
  return (
    <form
      data-component="session-composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled() && props.model.value().trim()) props.model.submit.run()
      }}
    >
      <Show when={props.model.attachments?.items().length}>
        <div data-slot="attachments" role="list" aria-label={session.labels().attachments}>
          <For each={props.model.attachments?.items() ?? []}>
            {(item) => (
              <div role="listitem" data-state={item.state}>
                <span>{item.path}</span>
                <Show when={item.state === "uploading"}>
                  <span role="status">{session.labels().uploading({ path: item.path })}</span>
                </Show>
                <Show when={item.error}>{(error) => <span role="alert">{error()}</span>}</Show>
                <button
                  type="button"
                  disabled={item.state === "uploading"}
                  aria-label={session.labels().removeAttachment({ path: item.path })}
                  onClick={() => props.model.attachments?.remove(item.key)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <textarea
        ref={(element) => {
          input = element
        }}
        value={props.model.value()}
        disabled={disabled()}
        aria-label={session.labels().message}
        placeholder={session.labels().prompt}
        aria-controls={state.open ? listID : undefined}
        aria-expanded={state.open}
        onInput={change}
        onKeyDown={(event) => {
          if (event.isComposing) return
          if (state.open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault()
            const length = items().length
            if (length) setState("index", (state.index + (event.key === "ArrowDown" ? 1 : -1) + length) % length)
            return
          }
          if (state.open && event.key === "Escape") {
            event.preventDefault()
            close()
            return
          }
          if (state.open && (event.key === "Enter" || event.key === "Tab") && select()) {
            event.preventDefault()
            return
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <Show when={state.open}>
        <div id={listID} data-slot="completion" role="listbox">
          <For each={items()}>
            {(item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={state.index === index()}
                data-active={state.index === index() || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setState("index", index())
                  select()
                }}
              >
                <bdi>{item.label}</bdi>
                <Show when={"description" in item && item.description}>
                  {(description) => <small>{description()}</small>}
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div data-slot="footer">
        <Show when={props.model.attachments}>
          <input
            ref={(element) => {
              files = element
            }}
            type="file"
            hidden
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) props.model.attachments?.add(event.currentTarget.files)
              event.currentTarget.value = ""
            }}
          />
          <Show when={props.model.attachments}>
            <button
              type="button"
              disabled={props.model.attachments?.disabled()}
              aria-label={session.labels().attach}
              onClick={() => files?.click()}
            >
              +
            </button>
          </Show>
        </Show>
        <Select model={props.model.agents} label={session.labels().agent} />
        <Select model={props.model.models} label={session.labels().model} />
        <Select model={props.model.variants} label={session.labels().variant} />
        <button
          type="button"
          disabled={props.model.compact.pending()}
          aria-busy={props.model.compact.pending()}
          onClick={props.model.compact.run}
        >
          {session.labels().compact}
        </button>
        <Show when={props.model.active() && props.model.interrupt}>
          {(interrupt) => (
            <button
              type="button"
              disabled={interrupt().pending()}
              aria-label={session.labels().stop}
              aria-busy={interrupt().pending()}
              onClick={interrupt().run}
            >
              ■
            </button>
          )}
        </Show>
        <button
          type="submit"
          disabled={disabled() || !props.model.value().trim()}
          aria-label={session.labels().send}
          aria-busy={props.model.submit.pending()}
        >
          ↑
        </button>
      </div>
      <Show when={props.model.submit.error() ?? props.model.compact.error() ?? props.model.interrupt?.error()}>
        {(error) => <p role="alert">{error()}</p>}
      </Show>
    </form>
  )
}

function Select(props: { readonly model: SessionUI.Select | undefined; readonly label: string }): JSX.Element {
  return (
    <Show when={props.model}>
      {(model) => (
        <label aria-label={props.label}>
          <select
            value={model().value() ?? ""}
            disabled={model().action.pending()}
            onChange={(event) => model().action.run(event.currentTarget.value)}
          >
            <For each={model().choices}>
              {(choice) => (
                <option value={choice.key} disabled={choice.disabled}>
                  {choice.label}
                </option>
              )}
            </For>
          </select>
          <Show when={model().action.error()}>{(error) => <span role="alert">{error()}</span>}</Show>
        </label>
      )}
    </Show>
  )
}
