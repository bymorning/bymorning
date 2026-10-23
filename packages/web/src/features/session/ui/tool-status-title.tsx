import { Show, type JSX } from "solid-js"

import { TextShimmer } from "../../../ui/components/text-shimmer"
import "./tool-status-title.css"

export function ToolStatusTitle(props: {
  readonly active: boolean
  readonly activeText: string
  readonly doneText: string
}): JSX.Element {
  return (
    <span
      data-component="tool-status-title"
      data-active={props.active ? "true" : "false"}
      aria-label={props.active ? props.activeText : props.doneText}
    >
      <Show when={props.active} fallback={<span data-slot="tool-status-done">{props.doneText}</span>}>
        <span data-slot="tool-status-active">
          <TextShimmer text={props.activeText} />
        </span>
      </Show>
    </span>
  )
}
