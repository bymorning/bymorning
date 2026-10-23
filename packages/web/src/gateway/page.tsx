import { Show, type JSX, type ParentProps } from "solid-js"

import "./page.css"

export function GatewayPage(
  props: ParentProps<{
    title: string
    description?: string
    wide?: boolean
    layout?: "default" | "table"
    actions?: JSX.Element
  }>,
): JSX.Element {
  return (
    <div data-component="gateway-page" data-wide={props.wide ? "" : undefined} data-layout={props.layout ?? "default"}>
      <div data-slot="gateway-content">
        <header data-slot="gateway-header">
          <div data-slot="gateway-title-row">
            <h1>{props.title}</h1>
            {props.actions}
          </div>
          {props.description && <p>{props.description}</p>}
        </header>
        {props.children}
      </div>
    </div>
  )
}

/**
 * One headline number. With `onSelect` it becomes a tab that chooses what a
 * sibling chart shows; render those inside a `role="tablist"` container.
 */
export function GatewayMetric(props: {
  readonly label: string
  readonly value: JSX.Element
  readonly selected?: boolean
  readonly onSelect?: () => void
}): JSX.Element {
  return (
    <Show
      when={props.onSelect}
      fallback={
        <div data-slot="metric">
          <span>{props.label}</span>
          <strong>{props.value}</strong>
        </div>
      }
    >
      {(onSelect) => (
        <button
          type="button"
          role="tab"
          data-slot="metric"
          aria-selected={props.selected === true}
          tabIndex={props.selected ? 0 : -1}
          onClick={() => onSelect()()}
        >
          <span>{props.label}</span>
          <strong>{props.value}</strong>
        </button>
      )}
    </Show>
  )
}

