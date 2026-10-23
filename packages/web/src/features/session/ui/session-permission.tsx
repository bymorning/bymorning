import { Show, type Accessor, type JSX } from "solid-js"

import { PermissionView } from "./permission-view"

export declare namespace SessionPermission {
  export type Reply = "reject" | "once"
  export interface Item {
    readonly id: string
    readonly title: string
    readonly action: string
    readonly resources: ReadonlyArray<string>
  }
  export interface Model {
    readonly item: Accessor<Item | undefined>
    readonly pending: Accessor<boolean>
    readonly error: Accessor<string | undefined>
    readonly reply: (reply: Reply) => void | Promise<void>
  }
}

export function SessionPermission(props: {
  readonly model: SessionPermission.Model
  readonly primary: (node: HTMLButtonElement) => void
}): JSX.Element {
  return (
    <Show
      when={props.model.item()}
      fallback={<Show when={props.model.error()}>{(error) => <p role="alert">{error()}</p>}</Show>}
    >
      {(item) => (
        <PermissionView
          item={item()}
          pending={props.model.pending()}
          primary={props.primary}
          error={props.model.error()}
          onReply={(reply) => void props.model.reply(reply)}
        />
      )}
    </Show>
  )
}
