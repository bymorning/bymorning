import { Match, Show, Switch, type JSX, type ParentProps } from "solid-js"

import { Button } from "../ui/components/button"
import { Empty } from "../ui/components/empty"
import { ScrollFrame } from "../ui/components/scroll-frame"
import "./request-log.css"

/**
 * Shared Request log chrome for Console destinations.
 *
 * Owns loading, empty, pagination, and truncated identity cells so MCP and
 * Gateway Overview stay visually aligned.
 */
export function RequestLog(
  props: ParentProps<{
    readonly loading: boolean
    readonly ready: boolean
    readonly empty: boolean
    readonly emptyLabel: string
    readonly description?: string | undefined
    readonly canGoPrevious: boolean
    readonly canGoNext: boolean
    readonly onPrevious: () => void
    readonly onNext: () => void
  }>,
): JSX.Element {
  return (
    <section data-component="request-log" aria-labelledby="request-log-title">
      <div data-slot="section-heading">
        <div>
          <h2 id="request-log-title">Request log</h2>
          <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
        </div>
      </div>
      <Switch>
        <Match when={props.loading}>
          <p role="status" aria-label="Loading request log" data-slot="request-log-status">
            Loading requests…
          </p>
        </Match>
        <Match when={props.ready}>
          <Show
            when={!props.empty}
            fallback={
              <Empty label={props.emptyLabel} variant="panel">
                {props.emptyLabel}
              </Empty>
            }
          >
            {props.children}
          </Show>
          <Show when={props.canGoPrevious || props.canGoNext}>
            <nav data-slot="request-log-pagination" aria-label="Request log pages">
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                disabled={!props.canGoPrevious}
                onClick={props.onPrevious}
              >
                Prev
              </Button>
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                disabled={!props.canGoNext}
                onClick={props.onNext}
              >
                Next
              </Button>
            </nav>
          </Show>
        </Match>
      </Switch>
    </section>
  )
}

/**
 * Scroll-contained table wrapper for a Request log.
 */
export function RequestLogTable(props: ParentProps): JSX.Element {
  return (
    <ScrollFrame data-slot="table-wrap" data-component="request-log-table">
      <table aria-label="Request log">{props.children}</table>
    </ScrollFrame>
  )
}

/**
 * Truncating identity cell for a Request log row.
 *
 * @param props.title - Full identity shown on hover when the label ellipsizes.
 */
export function RequestLogIdentity(props: ParentProps<{ readonly title: string }>): JSX.Element {
  return (
    <th scope="row" data-slot="request-log-identity">
      <span title={props.title} data-slot="request-log-identity-label">
        {props.children}
      </span>
    </th>
  )
}
