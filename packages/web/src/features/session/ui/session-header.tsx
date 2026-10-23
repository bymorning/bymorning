import { createSignal, createUniqueId, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import type { DataSessionStatus } from "../../../context/data/session"
import { ActionMenu } from "../../../ui/components/action-menu"
import { Icon } from "../../../ui/components/icon"
import { IconButton } from "../../../ui/components/icon-button"
import { ProjectAvatar } from "../../../ui/components/project-avatar"
import { Tooltip } from "../../../ui/components/tooltip"
import { useI18n } from "../../../ui/context/i18n"
import { errorMessage } from "../../../utils/error-message"
import { sessionTitle } from "../../../utils/session-title"
import { SessionContextUsage } from "./session-context-usage"
import { BackgroundTasks } from "./subagent-background"
import type { SessionUI } from "./session-model"
import "./session-header.css"

export function SessionHeader(props: {
  readonly title: string
  readonly workspace: string
  readonly project?: { readonly name: string; readonly avatar?: string }
  readonly parent?: { readonly title: string; readonly href: string; readonly navigate: () => void }
  readonly status?: DataSessionStatus
  readonly usage?: {
    readonly tokens: number
    readonly cost: number
    readonly costComplete: boolean
    readonly percentage?: number
  }
  readonly backgroundTasks?: ReadonlyArray<SessionUI.BackgroundTask>
  readonly sessionHref?: (sessionID: string) => string | undefined
  readonly openSession?: (sessionID: string) => void
  readonly rename?: (title: string) => Promise<boolean>
  readonly archived?: boolean
  readonly archive?: () => Promise<boolean>
  readonly sidebarOpen: boolean
  readonly sidebarRef: (element: HTMLButtonElement) => void
  readonly toggleSidebar: () => void
}): JSX.Element {
  const i18n = useI18n()
  let titleInput!: HTMLInputElement
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [save, setSave] = createStore<{ saving: boolean; error?: string }>({ saving: false })
  const statusLabelID = createUniqueId()
  const heading = () => sessionTitle(props.title) ?? i18n.t("ui.session.untitled")
  const openEditor = () => {
    if (!props.rename || props.parent) return
    setDraft(heading())
    setSave("error", undefined)
    setEditing(true)
    requestAnimationFrame(() => {
      titleInput.focus()
      titleInput.select()
    })
  }
  const closeEditor = () => {
    if (!save.saving) setEditing(false)
  }
  const saveTitle = () => {
    const title = draft().trim().slice(0, 255)
    if (!props.rename || save.saving) return
    // An empty title is never valid; leave edit mode so the existing title shows again.
    if (!title) return setEditing(false)
    setSave("saving", true)
    setSave("error", undefined)
    void props
      .rename(title)
      .then((saved) => {
        if (saved) setEditing(false)
      })
      .catch((cause) => setSave("error", errorMessage(cause, i18n.t("ui.session.renameError"))))
      .finally(() => setSave("saving", false))
  }
  const archive = () => {
    if (!props.archive || save.saving) return
    setSave("saving", true)
    setSave("error", undefined)
    void props
      .archive()
      .catch((cause) =>
        setSave(
          "error",
          errorMessage(cause, i18n.t(props.archived ? "ui.session.unarchiveError" : "ui.session.archiveError")),
        ),
      )
      .finally(() => setSave("saving", false))
  }
  const identity = () => props.project?.name ?? props.workspace
  const status = () => (props.status === "running" ? i18n.t("ui.session.status.running") : undefined)
  const statusLabel = () => {
    const value = status()
    return value ? i18n.t("ui.session.statusLabel", { status: value }) : undefined
  }
  return (
    <header data-component="session-header" data-session-title>
      <div data-slot="session-header-row">
        <div data-slot="session-header-identity" title={`${identity()} · ${props.workspace}`}>
          <span
            data-slot="session-header-project"
            aria-label={`${i18n.t("ui.session.workspaceProject")} ${identity()} ${i18n.t("ui.session.workspaceProjectIn")} ${props.workspace}`}
          >
            <Show when={props.project} fallback={<Icon name="monitor" />}>
              {(project) => <ProjectAvatar fallback={project().name} src={project().avatar} aria-hidden="true" />}
            </Show>
          </span>
          <div data-slot="session-header-breadcrumb">
            <Show when={props.parent}>
              {(parent) => (
                <>
                  <a
                    href={parent().href}
                    data-slot="session-title-parent"
                    dir="auto"
                    onClick={(event) => {
                      if (
                        event.defaultPrevented ||
                        event.button !== 0 ||
                        event.altKey ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey
                      )
                        return
                      event.preventDefault()
                      parent().navigate()
                    }}
                  >
                    {sessionTitle(parent().title) ?? i18n.t("ui.session.untitled")}
                  </a>
                  <span data-slot="session-title-separator" aria-hidden="true">
                    /
                  </span>
                </>
              )}
            </Show>
            <Show
              when={editing()}
              fallback={
                <h1 dir="auto" data-slot={props.parent ? "session-title-child" : undefined}>
                  <Show when={props.rename && !props.parent} fallback={heading()}>
                    <button
                      type="button"
                      aria-label={`${i18n.t("ui.session.rename")} ${heading()}`}
                      onClick={openEditor}
                    >
                      {heading()}
                    </button>
                  </Show>
                </h1>
              }
            >
              <input
                ref={(element) => (titleInput = element)}
                data-slot="session-title-input"
                dir="auto"
                value={draft()}
                disabled={save.saving}
                aria-label={i18n.t("ui.session.title")}
                aria-invalid={save.error ? "true" : undefined}
                maxLength={255}
                onInput={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    saveTitle()
                    return
                  }
                  if (event.key !== "Escape") return
                  event.preventDefault()
                  closeEditor()
                }}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={closeEditor}
              />
            </Show>
          </div>
        </div>
        <div data-slot="session-header-actions">
          <Show when={save.error}>
            {(message) => (
              <span class="sr-only" role="alert">
                {message()}
              </span>
            )}
          </Show>
          <Show when={statusLabel()}>
            {(label) => (
              <span data-slot="session-header-status" role="status" aria-labelledby={statusLabelID} title={status()}>
                <span id={statusLabelID} class="sr-only">
                  {label()}
                </span>
                <span aria-hidden="true" />
              </span>
            )}
          </Show>
          <Show when={props.backgroundTasks?.length && props.sessionHref && props.openSession}>
            <BackgroundTasks
              tasks={props.backgroundTasks ?? []}
              sessionHref={props.sessionHref ?? (() => undefined)}
              openSession={props.openSession ?? (() => undefined)}
            />
          </Show>
          <Show when={props.usage}>{(usage) => <SessionContextUsage {...usage()} />}</Show>
          <Show when={props.archive}>
            <ActionMenu label={heading()} triggerLabel={i18n.t("ui.session.actions")} disabled={save.saving}>
              <ActionMenu.Item onSelect={archive}>
                {i18n.t(props.archived ? "ui.session.unarchive" : "ui.session.archive")}
              </ActionMenu.Item>
            </ActionMenu>
          </Show>
          <Tooltip value={i18n.t("ui.session.sidebar")} placement="bottom" disabled={props.sidebarOpen}>
            <IconButton
              ref={(element) => props.sidebarRef(element)}
              type="button"
              size="large"
              variant="ghost-muted"
              aria-label={i18n.t("ui.session.sidebar")}
              aria-pressed={props.sidebarOpen}
              data-expanded={props.sidebarOpen ? "" : undefined}
              hidden={props.sidebarOpen}
              onClick={props.toggleSidebar}
              icon={<Icon name="sidebar-right" />}
            />
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
