import { createMemo, Show } from "solid-js"

import { ActionMenu } from "../../ui/components/action-menu"
import { Button } from "../../ui/components/button"
import { Icon } from "../../ui/components/icon"
import { ProjectAvatar } from "../../ui/components/project-avatar"
import { Spinner } from "../../ui/components/spinner"
import { useI18n } from "../../ui/context/i18n"
import type { SessionListItem, SessionListScope, SessionListStatus } from "./session-list-model"
import "./session-list-row.css"

export function SessionListRow(props: {
  readonly item: SessionListItem
  readonly scope: SessionListScope
  readonly showProjectName?: boolean | undefined
  readonly showAvatar?: boolean | undefined
  readonly status: (item: SessionListItem) => SessionListStatus
  readonly statusLabel: (indicator: SessionListStatus["indicator"]) => string | undefined
  readonly updatedAtLabel?:
    | {
        readonly compact: string
        readonly full: string
      }
    | undefined
  readonly search?: {
    readonly selected: boolean
    readonly onHighlight: (item: SessionListItem) => void
  }
  readonly href: string
  readonly onOpen: (item: SessionListItem) => void
  readonly archive?: {
    readonly archived: boolean
    readonly pending?: (item: SessionListItem) => boolean
    readonly error?: (item: SessionListItem) => string | undefined
    readonly onSelect: (item: SessionListItem) => void
  }
}) {
  const i18n = useI18n()
  const status = createMemo(() => props.status(props.item))
  const current = () => status().open
  const showProjectName = () => (props.showProjectName ?? props.scope === "workspace") && props.item.project.name
  const statusLabel = () => props.statusLabel(status().indicator)
  const stopRow = (event: Event) => {
    event.stopPropagation()
  }

  return (
    <>
      <div
        data-slot="session-list-row-wrap"
        data-actions={props.archive ? "" : undefined}
        data-current={current() ? "" : undefined}
      >
        <a
          href={props.href}
          id={props.search ? `session-list-search-option-${props.item.key}` : undefined}
          data-component="session-list-row"
          data-key={props.search ? props.item.key : undefined}
          data-selected={props.search?.selected ? "" : undefined}
          data-current={current() ? "" : undefined}
          data-has-leading
          role={props.search ? "option" : undefined}
          aria-current={current() ? "page" : undefined}
          aria-selected={props.search?.selected}
          onMouseEnter={() => props.search?.onHighlight(props.item)}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            props.onOpen(props.item)
          }}
        >
          <div data-slot="session-list-row-leading" aria-hidden="true">
            <Show
              when={props.showAvatar !== false}
              fallback={
                <Show when={status().indicator !== "idle"}>
                  <span data-slot="session-list-row-status" data-indicator={status().indicator} aria-hidden="true">
                    <Show
                      when={status().indicator === "working"}
                      fallback={<span data-slot="session-list-row-status-dot" />}
                    >
                      <Spinner size={14} />
                    </Show>
                  </span>
                </Show>
              }
            >
              <span
                data-slot="session-list-row-avatar"
                data-loading={status().indicator === "working" ? "" : undefined}
              >
                <ProjectAvatar
                  fallback={props.item.project.name}
                  src={props.item.project.avatar}
                  unread={status().indicator === "attention" || status().indicator === "unread"}
                  title={showProjectName() ? props.item.project.name : undefined}
                />
                <Show when={status().indicator === "working"}>
                  <span data-slot="session-list-row-spinner">
                    <Spinner size={14} />
                  </span>
                </Show>
              </span>
            </Show>
          </div>
          <span data-slot="session-list-row-title" title={props.item.title}>
            {props.item.title}
            <Show when={props.item.scheduledTask}>
              <span data-slot="session-list-row-scheduled" title="Started by a scheduled task">
                <Icon name="central-clock" size="small" aria-hidden="true" />
              </span>
            </Show>
          </span>
          <Show when={props.updatedAtLabel}>
            {(label) => (
              <time
                data-slot="session-list-row-updated-at"
                dateTime={props.item.updatedAt.toISOString()}
                title={label().full}
                aria-label={label().full}
              >
                {label().compact}
              </time>
            )}
          </Show>
          <Show when={statusLabel()}>{(label) => <span class="sr-only">{label()}</span>}</Show>
          <Show when={showProjectName()}>
            <span data-slot="session-list-row-project">{props.item.project.name}</span>
          </Show>
        </a>
        <Show when={props.archive}>
          {(archive) => (
            <div
              data-slot="session-list-row-actions"
              aria-busy={archive().pending?.(props.item)}
              onClick={stopRow}
              onPointerDown={stopRow}
            >
              <Show when={archive().pending?.(props.item)}>
                <Spinner size={14} />
              </Show>
              <Show
                when={archive().archived}
                fallback={
                  <ActionMenu
                    label={props.item.title}
                    disabled={archive().pending?.(props.item) ?? false}
                    triggerLabel={i18n.t("ui.session.actions")}
                  >
                    <ActionMenu.Item
                      disabled={archive().pending?.(props.item) ?? false}
                      onSelect={() => archive().onSelect(props.item)}
                    >
                      {i18n.t("ui.session.archive")}
                    </ActionMenu.Item>
                  </ActionMenu>
                }
              >
                <Button
                  variant="outline"
                  size="small"
                  aria-label={`${i18n.t("ui.session.unarchive")}: ${props.item.title}`}
                  disabled={archive().pending?.(props.item) ?? false}
                  onClick={() => archive().onSelect(props.item)}
                >
                  Restore
                </Button>
              </Show>
            </div>
          )}
        </Show>
      </div>
      <Show when={props.archive?.error?.(props.item)}>
        {(error) => (
          <p data-slot="session-list-row-error" role="alert">
            {error()}
          </p>
        )}
      </Show>
    </>
  )
}
