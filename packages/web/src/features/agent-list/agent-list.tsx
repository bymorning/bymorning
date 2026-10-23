import { Index, Show } from "solid-js"

import { Icon } from "../../ui/components/icon"
import { ListShell } from "../list-shell"
import type { ListState } from "../list-state"
import type { AgentListItem } from "./agent-list-model"
import "./agent-list.css"

/**
 * A Workspace has exactly one selectable Agent — the built-in Default — and
 * any number of Subagents it delegates to. `mode` carries that distinction
 * for the life of the Agent, so grouping by it (rather than list order) is
 * always correct even before a Workspace's Agent catalog finishes loading
 * in a particular order.
 */
const isDefaultAgent = (item: AgentListItem) => item.mode !== "subagent"

export function AgentList(props: {
  readonly state: ListState<AgentListItem>
  readonly onOpen: (agentID: string) => void
  readonly onRetry: () => void
}) {
  return (
    <ListShell
      name="agent-list"
      loadingLabel="Loading agents…"
      emptyLabel="No agents in this workspace."
      state={props.state}
      onRetry={props.onRetry}
    >
      {(items) => {
        const primary = () => items().filter(isDefaultAgent)
        const subagents = () => items().filter((item) => !isDefaultAgent(item))
        return (
          <div data-slot="agent-list-groups">
            <Show when={primary().length > 0}>
              <section data-slot="agent-list-group" aria-labelledby="agent-list-default-heading">
                <h3 id="agent-list-default-heading" data-slot="agent-list-group-heading">
                  Default agent
                </h3>
                <ul data-slot="agent-list-items" aria-label="Default agent">
                  {/* Index keeps each row's DOM across refreshes, which hand back new item objects. */}
                  <Index each={primary()}>
                    {(item) => (
                      <li data-slot="agent-list-item">
                        <AgentRow item={item()} default onOpen={props.onOpen} />
                      </li>
                    )}
                  </Index>
                </ul>
              </section>
            </Show>
            <Show when={subagents().length > 0}>
              <section data-slot="agent-list-group" aria-labelledby="agent-list-subagents-heading">
                <h3 id="agent-list-subagents-heading" data-slot="agent-list-group-heading">
                  Subagents
                </h3>
                <ul data-slot="agent-list-items" aria-label="Subagents">
                  <Index each={subagents()}>
                    {(item) => (
                      <li data-slot="agent-list-item">
                        <AgentRow item={item()} onOpen={props.onOpen} />
                      </li>
                    )}
                  </Index>
                </ul>
              </section>
            </Show>
          </div>
        )
      }}
    </ListShell>
  )
}

function AgentRow(props: {
  readonly item: AgentListItem
  readonly default?: boolean
  readonly onOpen: (agentID: string) => void
}) {
  return (
    <button
      type="button"
      data-slot="agent-list-row"
      data-variant={props.default ? "default" : undefined}
      aria-label={`Open ${props.item.name || props.item.id} details`}
      onClick={() => props.onOpen(props.item.id)}
    >
      <span data-slot="agent-list-row-avatar" aria-hidden="true">
        <Icon name="central-agents" size="large" />
      </span>
      <span data-slot="agent-list-row-content">
        <strong data-slot="agent-list-row-name">{props.item.name || props.item.id}</strong>
        <Show when={props.item.description}>
          {(description) => <span data-slot="agent-list-row-description">{description()}</span>}
        </Show>
        <Show when={props.item.model}>
          {(model) => (
            <span data-slot="agent-list-row-meta">
              <span data-slot="agent-list-row-model" title={`${model().provider} / ${model().id}`}>
                <span data-slot="agent-list-row-provider">{model().provider}</span>
                <span aria-hidden="true">/</span>
                <span>{model().id}</span>
                <Show when={model().variant}>{(variant) => <span>· {variant()}</span>}</Show>
              </span>
            </span>
          )}
        </Show>
      </span>
      <span data-slot="agent-list-row-accessory" aria-hidden="true">
        <Icon name="central-chevron-right-small" />
      </span>
    </button>
  )
}
