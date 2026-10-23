import { For, Show, type JSX } from "solid-js"

import type {
  SessionListGroup as SessionListGroupModel,
  SessionListItem,
  SessionListScope,
  SessionListStatus,
} from "./session-list-model"
import { SessionListRow } from "./session-list-row"
import type { SessionListScrollController } from "./session-list-scroll-controller"
import "./session-list.css"

export function SessionList(props: {
  readonly groups?: ReadonlyArray<SessionListGroupModel>
  readonly items?: ReadonlyArray<SessionListItem>
  readonly loading: boolean
  readonly loadingLabel: string
  readonly scope: SessionListScope
  readonly showProjectName?: boolean
  readonly showAvatar?: boolean
  readonly hidden: boolean
  readonly status: (item: SessionListItem) => SessionListStatus
  readonly statusLabel: (indicator: SessionListStatus["indicator"]) => string | undefined
  readonly formatUpdatedAt?: ((updatedAt: Date) => { readonly compact: string; readonly full: string }) | undefined
  readonly href: (sessionID: string) => string
  readonly onOpen: (sessionID: string) => void
  readonly archive?: {
    readonly archived: boolean
    readonly pending?: (sessionID: string) => boolean
    readonly error?: (sessionID: string) => string | undefined
    readonly onSelect: (sessionID: string) => void
  }
  readonly scroll: SessionListScrollController
  readonly empty: JSX.Element
}) {
  return (
    <div data-component="session-list">
      <Show
        when={!props.loading}
        fallback={
          <p data-slot="session-list-loading" role="status">
            {props.loadingLabel}
          </p>
        }
      >
        <Show when={(props.items?.length ?? props.groups?.length ?? 0) > 0} fallback={props.empty}>
          <div
            ref={props.scroll.header.setContent}
            data-slot="session-list-content"
            aria-hidden={props.hidden ? "true" : undefined}
          >
            <Show when={props.items}>
              {(items) => (
                <ul data-slot="session-list-items">
                  <For each={items()}>
                    {(item) => (
                      <li>
                        <SessionListRow
                          item={item}
                          href={props.href(item.id)}
                          scope={props.scope}
                          showProjectName={props.showProjectName}
                          showAvatar={props.showAvatar}
                          status={props.status}
                          statusLabel={props.statusLabel}
                          updatedAtLabel={props.formatUpdatedAt?.(item.updatedAt)}
                          onOpen={(selected) => props.onOpen(selected.id)}
                          {...(props.archive
                            ? {
                                archive: {
                                  archived: props.archive.archived,
                                  pending: (selected) => props.archive?.pending?.(selected.id) ?? false,
                                  error: (selected) => props.archive?.error?.(selected.id),
                                  onSelect: (selected) => props.archive!.onSelect(selected.id),
                                },
                              }
                            : {})}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Show>
            <For each={props.groups ?? []}>
              {(group, index) => (
                <section data-slot="session-list-group" aria-labelledby={`session-list-group-${group.id}`}>
                  <div
                    ref={(element) => props.scroll.header.setHeader(group.id, element)}
                    id={`session-list-group-${group.id}`}
                    data-slot="session-list-group-header"
                    data-elevated={index() === 0 ? "" : undefined}
                    style={{ opacity: props.scroll.header.titleOpacity(group.id) }}
                  >
                    {group.title}
                  </div>
                  <ul data-slot="session-list-group-items">
                    <For each={group.items}>
                      {(item) => (
                        <li>
                          <SessionListRow
                            item={item}
                            href={props.href(item.id)}
                            scope={props.scope}
                            showProjectName={props.showProjectName}
                            showAvatar={props.showAvatar}
                            status={props.status}
                            statusLabel={props.statusLabel}
                            onOpen={(selected) => props.onOpen(selected.id)}
                            {...(props.archive
                              ? {
                                  archive: {
                                    archived: props.archive.archived,
                                    pending: (selected) => props.archive?.pending?.(selected.id) ?? false,
                                    error: (selected) => props.archive?.error?.(selected.id),
                                    onSelect: (selected) => props.archive!.onSelect(selected.id),
                                  },
                                }
                              : {})}
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
