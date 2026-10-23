import { For, Show, type JSX } from "solid-js"

import { Button } from "../../../ui/components/button"
import type { SessionPermission } from "./session-permission"
import "./permission-view.css"

export function PermissionView(props: {
  readonly item: SessionPermission.Item
  readonly pending: boolean
  readonly error: string | undefined
  readonly primary?: (node: HTMLButtonElement) => void
  readonly onReply: (reply: SessionPermission.Reply) => void
}): JSX.Element {
  return (
    <section
      data-component="permission-view"
      aria-labelledby={`permission-title-${props.item.id}`}
      aria-busy={props.pending}
    >
      <div data-slot="permission-view-header">
        <strong id={`permission-title-${props.item.id}`}>Permission required</strong>
        <span>{props.item.title}</span>
      </div>
      <div data-slot="permission-view-context">
        <span>Action</span>
        <code>{props.item.action}</code>
        <Show when={props.item.resources.length > 0}>
          <span>Resources</span>
          <div>
            <For each={props.item.resources}>{(resource) => <code>{resource}</code>}</For>
          </div>
        </Show>
      </div>
      <Show when={props.error}>
        {(message) => (
          <p data-slot="permission-view-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <div data-slot="permission-view-actions" role="group" aria-label="Permission response">
        <Button variant="danger" disabled={props.pending} onClick={() => props.onReply("reject")}>
          Reject
        </Button>
        <Button ref={props.primary} variant="primary" disabled={props.pending} onClick={() => props.onReply("once")}>
          Once
        </Button>
      </div>
    </section>
  )
}
