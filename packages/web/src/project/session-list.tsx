import type { SessionInfo } from "@bymorning/client"
import { Session } from "@bymorning/schema/session"
import { createEffect, createMemo, createResource, on, onCleanup } from "solid-js"
import { useScope, useServer } from "../runtime/server/runtime"
import { scopeKey } from "../runtime/server/scope"
import { archiveSession } from "../session/archive-toast"
import { createLifecycle } from "../session/lifecycle"
import { createStore } from "solid-js/store"

import { useDialog } from "../context/dialog"
import { useData } from "../context/data"
import { useSDK } from "../context/sdk"
import { mergeHomeSessionIndex, retainHomeSessions } from "./session-list-index"
import { createSimpleContext } from "../context/helper"
import { useLocation, useNavigate } from "@solidjs/router"
import { useWorkspace } from "../context/workspace"
import { useI18n } from "../ui/context/i18n"
import { normalizePathname, sessionRouteHref } from "../workspace-route-paths"
import type { SessionListItem, SessionListStatus } from "../features/session-list/session-list-model"
import { useProject, type ProjectModel } from "./model"
import {
  buildSessionRecords,
  groupSessionItemsByProject,
  groupSessions,
  toSessionListItem,
  type SessionListLanguage,
  type SessionRecord,
} from "./session-list-records"

const HOME_SESSION_LIMIT = 64

const language: SessionListLanguage = {
  t: (key, options) => {
    if (key === "common.loading") return "Loading sessions..."
    if (key === "command.session.new") return "New session"
    if (key === "home.sessions.empty") return "Nothing here yet"
    if (key === "home.sessions.empty.description") return "Create a session to get started"
    if (key === "home.sessions.archived") return "Archived"
    if (key === "home.sessions.archived.empty") return "No archived sessions"
    if (key === "home.sessions.archived.empty.description")
      return "Archived sessions stay hidden until you restore them."
    if (key === "home.sessions.group.today") return "Today"
    if (key === "home.sessions.group.yesterday") return "Yesterday"
    if (key === "home.sessions.group.older") return "Older"
    if (key === "home.sessions.search.placeholder.scoped") return `Search ${options?.scope ?? ""} sessions`.trim()
    if (key === "home.sessions.search.noResults") return `No sessions found for “${options?.query ?? ""}”`
    if (key === "home.sessions.search.sessions") return "Sessions"
    if (key === "sidebar.project.recentSessions") return "Recent sessions"
    return "Search sessions"
  },
}

export function createSessionListController(controller: ProjectModel) {
  const data = useData()
  const { client } = useSDK()
  const i18n = useI18n()
  const dialog = useDialog()
  const location = useLocation()
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const shared = useServer().data
  const [archiveView, setArchiveView] = createStore({
    open: false,
  })
  let archiveRequest: AbortController | undefined
  onCleanup(() => archiveRequest?.abort())
  const [archivedList, archiveActions] = createResource(
    () => archiveView.open && workspace.current().id,
    async (workspace) => {
      archiveRequest?.abort()
      const request = (archiveRequest = new AbortController())
      const sessions: SessionInfo[] = []
      let cursor: string | undefined
      do {
        const page = await client.session.list(
          { workspace, archived: true, parentID: null, limit: 100, ...(cursor ? { cursor } : {}) },
          { signal: request.signal },
        )
        sessions.push(...page.data)
        cursor = page.cursor
      } while (cursor !== undefined)
      return sessions
    },
  )
  const lifecycle = createLifecycle({
    client,
    shared,
    key: scopeKey(useScope()),
    refresh: async () => {
      if (archiveView.open) await archiveActions.refetch()
    },
  })
  // Another client (or tab) archiving or restoring a Session changes the active index; keep the archive in step.
  createEffect(
    on(
      () =>
        archiveView.open &&
        data.session
          .list()
          .map((session) => session.id)
          .join(),
      (key) => {
        if (key !== false) void archiveActions.refetch()
      },
      { defer: true },
    ),
  )
  // A child Session is not listed itself, so its parent's row stands for it while the child is open.
  const openRootID = () => {
    const prefix = sessionRouteHref(workspace.current().id, "")
    const pathname = normalizePathname(location.pathname)
    if (!pathname.startsWith(prefix)) return undefined
    const id = pathname.slice(prefix.length)
    return id.includes("/") ? undefined : (data.session.get(id)?.parentID ?? id)
  }
  const indexedSessions = createMemo(() =>
    archiveView.open
      ? (archivedList() ?? [])
      : retainHomeSessions(mergeHomeSessionIndex([], data.session.list()), HOME_SESSION_LIMIT, Date.now()),
  )
  const projectByID = createMemo(
    () => new Map(controller.project.list().map((project) => [project.id, project] as const)),
  )
  const allRecords = createMemo(() =>
    buildSessionRecords({
      sessions: indexedSessions,
      selected: controller.selection.project,
      projectByID,
    }),
  )
  const workspaceRecords = createMemo(() =>
    buildSessionRecords({
      sessions: () => mergeHomeSessionIndex([], data.session.list()),
      selected: () => undefined,
      projectByID,
    }),
  )
  const itemsByProject = createMemo(() => groupSessionItemsByProject(workspaceRecords()))
  const records = createMemo(() => allRecords().slice(0, HOME_SESSION_LIMIT))
  const groups = createMemo(() => groupSessions(records(), language))
  const items = createMemo(() => records().map(toSessionListItem))
  const searchItems = createMemo(() => allRecords().map(toSessionListItem))
  const recordByID = createMemo(
    () => new Map<string, SessionRecord>(workspaceRecords().map((record) => [record.session.id, record])),
  )

  return {
    copy: {
      language,
      searchPlaceholder: () => {
        const project = controller.selection.project()
        return project
          ? language.t("home.sessions.search.placeholder.scoped", { scope: project.name ?? "Untitled" })
          : "Search sessions"
      },
      searchNoResults: (query: string) => language.t("home.sessions.search.noResults", { query }),
      statusLabel: (indicator: SessionListStatus["indicator"]) => {
        if (indicator === "idle") return undefined
        const status =
          indicator === "attention"
            ? i18n.t("ui.session.status.attention")
            : indicator === "unread"
              ? i18n.t("ui.session.status.unread")
              : i18n.t("ui.session.status.working")
        return i18n.t("ui.session.statusLabel", { status })
      },
    },
    data: {
      groups,
      items,
      searchItems,
      itemsByProject,
      scope: () => (controller.selection.project() === undefined ? "workspace" : "project"),
      archived: () => archiveView.open,
      // Initial bootstrap is owned by BootstrapGate; only this later,
      // user-triggered archive fetch belongs to the Session list.
      loading: () => archiveView.open && archivedList.loading,
    },
    view: {
      showArchived: (open: boolean) => {
        if (!open) archiveRequest?.abort()
        setArchiveView("open", open)
      },
    },
    session: {
      canCreate: controller.session.canCreate,
      createDisabled: controller.session.createDisabled,
      createMessage: controller.session.createMessage,
      create: controller.session.create,
      href: (sessionID: string) => sessionRouteHref(workspace.current().id, sessionID),
      archive: async (sessionID: string, archived: boolean) => {
        const id = Session.ID.make(sessionID)
        if (lifecycle.pending(id)) return
        if (!archived) {
          await lifecycle.update({ sessionID: id, archived })
          return
        }
        await archiveSession({
          i18n,
          dialog,
          session: data.session.get(id) ?? archivedList()?.find((item) => item.id === id),
          sessionID: id,
          update: lifecycle.update,
          viewing: () => normalizePathname(location.pathname) === sessionRouteHref(workspace.current().id, id),
          leave: () => navigate(`/w/${workspace.current().id}`),
        })
      },
      pending: (sessionID: string) => lifecycle.pending(Session.ID.make(sessionID)),
      error: (sessionID: string) => lifecycle.error(Session.ID.make(sessionID)),
      open: (sessionID: string) => {
        const record = recordByID().get(sessionID)
        const session = record?.session ?? archivedList()?.find((item) => item.id === sessionID)
        if (session) {
          data.session.view(session.id)
        }
        navigate(sessionRouteHref(workspace.current().id, sessionID))
      },
      status: (item: SessionListItem): SessionListStatus => {
        const record = recordByID().get(item.id)
        const sessionID = record?.session.id ?? Session.ID.make(item.id)
        return {
          open: openRootID() === sessionID,
          indicator: record
            ? data.session.attention(record.session.id)
              ? "attention"
              : data.session.unread(record.session.id)
                ? "unread"
                : data.session.status(record.session.id) === "idle"
                  ? "idle"
                  : "working"
            : "idle",
        }
      },
    },
  }
}

export type SessionListController = ReturnType<typeof createSessionListController>

export const { provider: SessionListProvider, use: useSessionList } = createSimpleContext({
  name: "SessionList",
  init: () => createSessionListController(useProject()),
})
