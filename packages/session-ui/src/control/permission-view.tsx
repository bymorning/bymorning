import { For, Show, type JSX } from "solid-js"

import { useSession } from "../context/session.js"
import type { SessionUI } from "../model.js"
import "./permission-view.css"

export function PermissionView(props: { readonly model: SessionUI.PermissionProps }): JSX.Element {
  const session = useSession()
  return (
    <Show when={props.model.item()}>
      {(item) => (
        <section
          data-component="permission-view"
          aria-labelledby={`permission-${item().id}`}
          aria-busy={props.model.action.pending()}
        >
          <header>
            <strong id={`permission-${item().id}`}>{session.labels().permission}</strong>
            <code>{item().action}</code>
          </header>
          <Show when={item().resources.length}>
            <div data-slot="resources">
              <For each={item().resources}>{(resource) => <code>{resource}</code>}</For>
            </div>
          </Show>
          <div data-slot="actions">
            <button
              type="button"
              disabled={props.model.action.pending()}
              onClick={() => props.model.action.run({ reply: "reject" })}
            >
              {session.labels().reject}
            </button>
            <button
              type="button"
              disabled={props.model.action.pending()}
              onClick={() => props.model.action.run({ reply: "always" })}
            >
              {session.labels().allowAlways}
            </button>
            <button
              type="button"
              disabled={props.model.action.pending()}
              onClick={() => props.model.action.run({ reply: "once" })}
            >
              {session.labels().allowOnce}
            </button>
          </div>
          <Show when={props.model.action.error()}>{(error) => <p role="alert">{error()}</p>}</Show>
        </section>
      )}
    </Show>
  )
}
