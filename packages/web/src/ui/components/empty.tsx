import type { JSX, ParentProps } from "solid-js"

import "./empty.css"

export function Empty(
  props: ParentProps<{
    readonly label?: string
    readonly variant?: "plain" | "panel"
  }>,
): JSX.Element {
  return (
    <p role="status" aria-label={props.label} data-component="empty" data-variant={props.variant ?? "plain"}>
      {props.children}
    </p>
  )
}
