import { useLocation } from "@solidjs/router"
import { Option, Schema } from "effect"
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useServer } from "../../runtime/server/runtime"
import { useWorkspace } from "../../context/workspace"
import { SessionList } from "../../features/session-list/session-list"
import type { SessionListItem, SessionListStatus } from "../../features/session-list/session-list-model"
import { createSessionListScrollController } from "../../features/session-list/session-list-scroll-controller"
import { Persist, safeSyncStorage, type SyncStorage } from "../../runtime/persistence/storage"
import { Button } from "../../ui/components/button"
import { Icon } from "../../ui/components/icon"
import { Avatar } from "../../ui/components/avatar"
import { Tooltip } from "../../ui/components/tooltip"
import { projectRouteHref } from "../../workspace-route-paths"
import { useProject } from "../model"
import { useSessionList } from "../session-list"
import "./projects-region.css"

const INITIAL_SESSION_COUNT = 6
const SESSION_COUNT_INCREMENT = 6
const DisclosureState = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    projectsOpen: Schema.Boolean,
    expandedProjectIDs: Schema.Array(Schema.String),
  }),
)

export function SidebarProjectsRegion(props: {
  readonly onDismiss: () => void
  readonly storage?: SyncStorage
}): JSX.Element {
  const model = useProject()
  const server = useServer()
  const sessions = useSessionList()
  const workspace = useWorkspace()
  const location = useLocation()
  const storage = safeSyncStorage(props.storage)
  const target = Persist.workspace(workspace.current().id, "project-sidebar-disclosure")
  const stored = Option.getOrUndefined(Schema.decodeUnknownOption(DisclosureState)(storage.getItem(target.key)))
  const [disclosure, setDisclosure] = createStore({
    projectsOpen: stored?.projectsOpen ?? true,
    expandedProjectIDs: stored?.expandedProjectIDs ?? [],
  })
  const [now, setNow] = createSignal(new Date())
  const clock = setInterval(() => setNow(new Date()), 60_000)
  const revealedRoutes = new Set<string>()
  const projectsID = `sidebar-projects-${encodeURIComponent(workspace.current().id)}`
  onCleanup(() => clearInterval(clock))

  createEffect(() =>
    storage.setItem(
      target.key,
      Schema.encodeSync(DisclosureState)({
        version: 1,
        projectsOpen: disclosure.projectsOpen,
        expandedProjectIDs: disclosure.expandedProjectIDs,
      }),
    ),
  )
  createEffect(
    on(
      () => server.bootstrapState().state,
      (state) => {
        if (state !== "ready") return
        const available = new Set<string>(model.project.list().map((project) => project.id))
        setDisclosure("expandedProjectIDs", (ids) => ids.filter((id) => available.has(id)))
      },
    ),
  )
  createEffect(
    on(
      () => [location.pathname, location.search, model.selection.project()] as const,
      ([pathname, search, project]) => {
        if (!/\/(session\/[^/]+|new-session)$/.test(pathname)) return
        if (!project) return
        const route = `${pathname}${search}`
        if (revealedRoutes.has(route)) return
        revealedRoutes.add(route)
        setDisclosure("projectsOpen", true)
        setDisclosure("expandedProjectIDs", (ids) => (ids.includes(project.id) ? ids : [...ids, project.id]))
      },
    ),
  )

  const openSession = (sessionID: string) => {
    sessions.session.open(sessionID)
    props.onDismiss()
  }
  const openProject = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    props.onDismiss()
  }
  const toggleProject = (projectID: string) =>
    setDisclosure("expandedProjectIDs", (ids) =>
      ids.includes(projectID) ? ids.filter((id) => id !== projectID) : [...ids, projectID],
    )
  const state = () => server.bootstrapState()
  const loading = () => model.project.list().length === 0 && state().state === "loading"
  const failed = () => model.project.list().length === 0 && state().state === "error"

  return (
    <li data-component="sidebar-projects-region">
      <div data-slot="sidebar-projects-heading">
        <button
          type="button"
          data-slot="sidebar-projects-trigger"
          aria-expanded={disclosure.projectsOpen}
          aria-controls={projectsID}
          onClick={() => setDisclosure("projectsOpen", (open) => !open)}
        >
          <span data-slot="project-sidebar-nav-icon">
            <span data-slot="sidebar-projects-folder-icon" aria-hidden="true">
              <Icon name="central-folder-closed" data-state={disclosure.projectsOpen ? "inactive" : "active"} />
              <Icon name="central-folder-open" data-state={disclosure.projectsOpen ? "active" : "inactive"} />
            </span>
          </span>
          <span data-slot="sidebar-projects-title">Projects</span>
        </button>
        <Tooltip value="Create project" placement="top">
          <button
            type="button"
            data-slot="sidebar-project-create"
            aria-label="Create project"
            disabled={!model.project.confirmed()}
            onClick={model.project.create}
          >
            <Icon name="central-plus-small" size="small" />
          </button>
        </Tooltip>
      </div>
      <Show when={disclosure.projectsOpen}>
        <div id={projectsID} data-slot="sidebar-projects-content">
          <Show
            when={!loading()}
            fallback={
              <p data-slot="sidebar-projects-status" role="status">
                Loading projects
              </p>
            }
          >
            <Show
              when={!failed()}
              fallback={
                <div data-slot="sidebar-projects-status" role="alert">
                  Projects unavailable.
                </div>
              }
            >
              <Show
                when={model.project.list().length > 0}
                fallback={
                  <div data-slot="sidebar-projects-empty">
                    No projects yet.{" "}
                    <Button
                      type="button"
                      variant="ghost"
                      size="small"
                      disabled={!model.project.confirmed()}
                      onClick={model.project.create}
                    >
                      Create project
                    </Button>
                  </div>
                }
              >
                <ul data-slot="sidebar-project-list">
                  <For each={model.project.list()}>
                    {(project) => {
                      const contentID = `${projectsID}-${encodeURIComponent(project.id)}`
                      const open = () => disclosure.expandedProjectIDs.includes(project.id)
                      const items = () => sessions.data.itemsByProject().get(project.id) ?? []
                      const name = () => project.name ?? "Untitled"
                      return (
                        <li data-slot="sidebar-project">
                          <div data-slot="sidebar-project-row">
                            <button
                              type="button"
                              aria-label={`${open() ? "Collapse" : "Expand"} sessions for ${name()}`}
                              aria-expanded={open()}
                              aria-controls={contentID}
                              onClick={() => toggleProject(project.id)}
                            >
                              <span data-slot="sidebar-project-leading" aria-hidden="true">
                                <span data-slot="sidebar-project-leading-avatar">
                                  <Avatar
                                    fallback={name()}
                                    src={(project.icon?.override?.href ?? project.icon?.url?.href)!}
                                    size="normal"
                                    kind="org"
                                    aria-hidden="true"
                                  />
                                </span>
                                <Icon name="central-chevron-right-small" size="small" />
                              </span>
                              <span>{name()}</span>
                            </button>
                            <a
                              href={projectRouteHref(workspace.current().id, project.id)}
                              aria-label={`Project settings for ${name()}`}
                              onClick={openProject}
                            >
                              <Icon name="settings-gear" size="small" />
                            </a>
                          </div>
                          <Show when={open()}>
                            <ProjectSessions
                              id={contentID}
                              items={items()}
                              now={now()}
                              status={sessions.session.status}
                              statusLabel={sessions.copy.statusLabel}
                              href={sessions.session.href}
                              onOpen={openSession}
                              onArchive={(sessionID) => void sessions.session.archive(sessionID, true)}
                            />
                          </Show>
                        </li>
                      )
                    }}
                  </For>
                </ul>
                <Show when={state().state === "error"}>
                  <p data-slot="sidebar-projects-cache-status">Showing saved projects</p>
                </Show>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </li>
  )
}

function ProjectSessions(props: {
  readonly id: string
  readonly items: ReadonlyArray<SessionListItem>
  readonly now: Date
  readonly status: (item: SessionListItem) => SessionListStatus
  readonly statusLabel: (indicator: SessionListStatus["indicator"]) => string | undefined
  readonly href: (sessionID: string) => string
  readonly onOpen: (sessionID: string) => void
  readonly onArchive: (sessionID: string) => void
}) {
  const [visible, setVisible] = createSignal(INITIAL_SESSION_COUNT)
  const scroll = createSessionListScrollController(() => [])
  const remaining = () => Math.max(0, props.items.length - visible())
  return (
    <div id={props.id} data-slot="sidebar-project-sessions">
      <SessionList
        items={props.items.slice(0, visible())}
        loading={false}
        loadingLabel=""
        scope="project"
        showProjectName={false}
        showAvatar={false}
        hidden={false}
        status={props.status}
        statusLabel={props.statusLabel}
        formatUpdatedAt={(updatedAt) => formatSidebarSessionDate(updatedAt, props.now)}
        href={props.href}
        onOpen={props.onOpen}
        archive={{ archived: false, onSelect: props.onArchive }}
        scroll={scroll}
        empty={<p data-slot="sidebar-project-sessions-empty">No sessions yet</p>}
      />
      <Show when={remaining() > 0}>
        <button
          type="button"
          data-slot="sidebar-project-show-more"
          onClick={() => setVisible((count) => count + SESSION_COUNT_INCREMENT)}
        >
          Load more
        </button>
      </Show>
    </div>
  )
}

export function formatSidebarSessionDate(updatedAt: Date, now: Date, locale?: string) {
  const elapsed = Math.max(0, now.valueOf() - updatedAt.valueOf())
  const sameDay =
    updatedAt.getFullYear() === now.getFullYear() &&
    updatedAt.getMonth() === now.getMonth() &&
    updatedAt.getDate() === now.getDate()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const previousDay =
    updatedAt.getFullYear() === yesterday.getFullYear() &&
    updatedAt.getMonth() === yesterday.getMonth() &&
    updatedAt.getDate() === yesterday.getDate()
  const compact =
    updatedAt > now
      ? "now"
      : previousDay
        ? "Yesterday"
        : elapsed < 60_000
          ? "now"
          : elapsed < 3_600_000
            ? `${Math.floor(elapsed / 60_000)}m`
            : sameDay
              ? `${Math.floor(elapsed / 3_600_000)}h`
              : new Intl.DateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                  ...(updatedAt.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
                }).format(updatedAt)
  return {
    compact,
    full: `Updated ${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(updatedAt)}`,
  }
}
