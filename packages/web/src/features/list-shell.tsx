import { For, Match, Switch, type Accessor, type JSX } from "solid-js"

import { Button } from "../ui/components/button"
import type { ListState } from "./list-state"

/**
 * Common loading/error/empty chrome for a list feature. The ready state is
 * fully delegated to `children`, which receives every item so a caller may
 * group or otherwise structure them (a flat `<ul>` is the caller's choice,
 * not this shell's). Items arrive as an accessor: `children` runs once per
 * transition into the ready state, so it must read them reactively to follow
 * later refreshes.
 */
export function ListShell<T>(props: {
  readonly name: string
  readonly loadingLabel: string
  readonly emptyLabel: string
  readonly state: ListState<T>
  readonly onRetry: () => void
  readonly children: (items: Accessor<ReadonlyArray<T>>) => JSX.Element
}) {
  return (
    <div data-component={props.name}>
      <Switch>
        <Match when={props.state.status === "loading"}>
          <div data-slot={`${props.name}-loading`} role="status">
            <span>{props.loadingLabel}</span>
            <div data-slot={`${props.name}-skeleton`} aria-hidden="true">
              <For each={[0, 1, 2, 3]}>{() => <div data-slot={`${props.name}-skeleton-row`} />}</For>
            </div>
          </div>
        </Match>
        <Match when={props.state.status === "error" ? props.state : undefined}>
          {(state) => (
            <div data-slot={`${props.name}-error`} role="alert">
              <span>{state().message}</span>
              <Button variant="ghost" onClick={props.onRetry}>
                Retry
              </Button>
            </div>
          )}
        </Match>
        <Match when={props.state.status === "empty"}>
          <p role="status" data-slot={`${props.name}-empty`}>
            {props.emptyLabel}
          </p>
        </Match>
        <Match when={props.state.status === "ready" ? props.state : undefined}>
          {(state) => props.children(() => state().items)}
        </Match>
      </Switch>
    </div>
  )
}
