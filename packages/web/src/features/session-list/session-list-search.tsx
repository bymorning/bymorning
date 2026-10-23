import { For, Show } from "solid-js"

import { Icon } from "../../ui/components/icon"
import type { SessionListItem, SessionListScope, SessionListStatus } from "./session-list-model"
import { SessionListRow } from "./session-list-row"
import type { SessionListSearchController } from "./session-list-search-controller"
import "./session-list-search.css"

const SESSION_LIST_SEARCH_RESULTS_ID = "session-list-search-results"

export function SessionListSearch(props: {
  readonly controller: SessionListSearchController
  readonly scope: SessionListScope
  readonly status: (item: SessionListItem) => SessionListStatus
  readonly statusLabel: (indicator: SessionListStatus["indicator"]) => string | undefined
  readonly sessionsLabel: string
  readonly loadingLabel: string
  readonly href: (sessionID: string) => string
}) {
  return (
    <div ref={props.controller.element.setRoot} data-component="session-list-search">
      <label data-slot="session-list-search-input">
        <Icon name="magnifying-glass" />
        <input
          data-slot="session-list-search-control"
          ref={props.controller.element.setInput}
          type="search"
          value={props.controller.query.value()}
          placeholder={props.controller.query.placeholder()}
          aria-label={props.controller.query.placeholder()}
          aria-expanded={props.controller.query.open()}
          aria-controls={SESSION_LIST_SEARCH_RESULTS_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            props.controller.result.active() && props.controller.query.open()
              ? `session-list-search-option-${props.controller.result.active()}`
              : undefined
          }
          onFocus={props.controller.query.focus}
          onInput={(event) => props.controller.query.input(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              props.controller.query.close()
              event.currentTarget.blur()
              return
            }
            if (
              !props.controller.query.open() ||
              props.controller.result.list().length === 0 ||
              event.altKey ||
              event.metaKey
            )
              return
            if (event.key === "ArrowDown") {
              event.preventDefault()
              props.controller.result.move(1)
              return
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              props.controller.result.move(-1)
              return
            }
            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault()
              props.controller.result.selectActive()
            }
          }}
        />
        <Show when={props.controller.query.value()}>
          <button
            type="button"
            data-slot="session-list-search-clear"
            aria-label="Clear session search"
            onClick={() => {
              props.controller.query.close()
              props.controller.query.focus()
            }}
          >
            ×
          </button>
        </Show>
      </label>
      <Show when={props.controller.query.open()}>
        <div data-slot="session-list-search-panel">
          <div id={SESSION_LIST_SEARCH_RESULTS_ID} role="listbox" ref={props.controller.element.setList}>
            <Show
              when={!props.controller.result.loading()}
              fallback={<p data-slot="session-list-search-empty">{props.loadingLabel}</p>}
            >
              <Show
                when={props.controller.result.list().length > 0}
                fallback={<p data-slot="session-list-search-empty">{props.controller.result.noResultsLabel()}</p>}
              >
                <p data-slot="session-list-search-label">{props.sessionsLabel}</p>
                <For each={props.controller.result.list()}>
                  {(item) => (
                    <SessionListRow
                      item={item}
                      href={props.href(item.id)}
                      scope={props.scope}
                      status={props.status}
                      statusLabel={props.statusLabel}
                      search={{
                        selected: props.controller.result.active() === item.key,
                        onHighlight: props.controller.result.highlight,
                      }}
                      onOpen={props.controller.result.select}
                    />
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
