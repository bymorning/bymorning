import { For, Match, Switch } from "solid-js"

import { Button } from "../../ui/components/button"
import { Catalog, CatalogCopy, CatalogRow, CatalogTrigger } from "../../ui/components/catalog"
import { Empty } from "../../ui/components/empty"
import type { ListState } from "../list-state"
import type { SkillListItem } from "./skill-list-model"
import "./skill-list.css"

export function SkillList(props: {
  readonly state: ListState<SkillListItem>
  readonly onOpen: (skillID: string) => void
  readonly onRetry: () => void
}) {
  return (
    <div data-component="skill-list">
      <Switch>
        <Match when={props.state.status === "loading"}>
          <p data-slot="skill-list-loading" role="status">
            Loading skills…
          </p>
        </Match>
        <Match when={props.state.status === "error" ? props.state : undefined}>
          {(state) => (
            <div data-slot="skill-list-error" role="alert">
              <span>{state().message}</span>
              <Button variant="ghost" onClick={props.onRetry}>
                Retry
              </Button>
            </div>
          )}
        </Match>
        <Match when={props.state.status === "empty"}>
          <Empty variant="panel">No custom skills yet.</Empty>
        </Match>
        <Match when={props.state.status === "ready" ? props.state : undefined}>
          {(state) => (
            <Catalog aria-label="Skills">
              <For each={state().items}>
                {(item) => (
                  <CatalogRow>
                    <CatalogTrigger aria-label={`Open ${item.name} details`} onClick={() => props.onOpen(item.id)}>
                      <CatalogCopy title={item.name} description={item.description} />
                    </CatalogTrigger>
                  </CatalogRow>
                )}
              </For>
            </Catalog>
          )}
        </Match>
      </Switch>
    </div>
  )
}
