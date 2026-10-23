import type { JSX } from "solid-js"

import { ProgressCircle } from "../../../ui/components/progress-circle"
import { Tooltip } from "../../../ui/components/tooltip"
import "./session-context-usage.css"

export function SessionContextUsage(props: {
  readonly tokens: number
  readonly cost: number
  readonly costComplete: boolean
  readonly percentage?: number
}): JSX.Element {
  const label = () =>
    `Context usage: ${props.percentage ?? 0}%, ${props.tokens.toLocaleString()} tokens, ${props.costComplete ? "" : "at least "}${new Intl.NumberFormat(
      undefined,
      {
        style: "currency",
        currency: "USD",
      },
    ).format(props.cost)}${props.costComplete ? "" : "; known subtotal; pricing incomplete"}`
  return (
    <Tooltip value={label()} placement="bottom">
      <span data-component="session-context-usage" role="img" aria-label={label()} tabindex="0">
        <ProgressCircle percentage={props.percentage ?? 0} size={16} strokeWidth={2} aria-hidden="true" />
      </span>
    </Tooltip>
  )
}
