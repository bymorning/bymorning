import { Project } from "@bymorning/schema/project"
import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { Option, Schema } from "effect"
import { useMutation } from "@tanstack/solid-query"
import { createComponent, createMemo, createSignal } from "solid-js"

import { useCommand } from "../shell/commands/context"
import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { createSimpleContext } from "../context/helper"
import { useServer } from "../runtime/server/runtime"
import { scopeKey } from "../runtime/server/scope"
import { useWorkspaceRuntime } from "../context/workspace-runtime"
import { useWorkspace } from "../context/workspace"
import { Persist, persisted, type SyncStorage } from "../runtime/persistence/storage"
import { archiveProject, defaultProjectReason, setProjectArchived } from "./archive"
import { ProjectDialog } from "./dialog"
import { RestoreProjectDialog } from "./restore-dialog"
import { projectRouteHref, projectRouteIDFromPath } from "../workspace-route-paths"

/** Ordering shared by every project inventory consumer. */
const byCreated = (a: { readonly time_created: number; readonly id: string }, b: typeof a) =>
  a.time_created - b.time_created || a.id.localeCompare(b.id)

export function createProjectModel(props: { readonly storage?: SyncStorage } = {}) {
  const data = useData()
  const server = useServer()
  const command = useCommand()
  const dialog = useDialog()
  const workspace = useWorkspace()
  const runtime = useWorkspaceRuntime()
  const location = useLocation()
  const navigate = useNavigate()
  const projects = createMemo(() => server.data.project.list().toSorted(byCreated))
  const selection = createSignal<Project.ID | undefined>()
  // Explicit signal typing selects the signal overload across the signal/store union.
  // oxlint-disable-next-line typescript-eslint/no-unnecessary-type-arguments
  const selected = persisted<Project.ID | undefined, typeof selection>(
    Persist.workspace(workspace.current().id, "project"),
    selection,
    {
      storage: props.storage,
      serialize: (value) => value ?? "",
      deserialize: (value) => Option.getOrUndefined(Schema.decodeUnknownOption(Project.ID)(value)),
    },
  )
  const [search] = useSearchParams<{ draftId?: string }>()
  const routeDraft = createMemo(() =>
    location.pathname.endsWith("/new-session") && search.draftId ? runtime.draft.get(search.draftId) : undefined,
  )
  const routeSession = createMemo(() => {
    const id = location.pathname.match(/\/session\/([^/]+)$/)?.[1]
    return id ? data.session.get(id) : undefined
  })
  const routeProjectID = createMemo(() => projectRouteIDFromPath(location.pathname))
  const persistedProject = createMemo(() => {
    const projectID = selected[0]()
    return projectID === undefined ? undefined : server.data.project.get(projectID)
  })
  const selectedProjectID = () =>
    routeDraft()?.projectID ?? routeSession()?.projectID ?? routeProjectID() ?? selected[0]()
  const selectedProject = createMemo(() => {
    const projectID = selectedProjectID()
    return projectID === undefined ? undefined : server.data.project.get(projectID)
  })
  const target = createMemo(() => {
    const projectID = routeDraft()?.projectID ?? routeSession()?.projectID ?? routeProjectID()
    if (projectID) return server.data.project.get(projectID)
    const persisted = persistedProject()
    if (persisted) return persisted
    return projects()[0]
  })
  const confirmed = createMemo(() => server.bootstrapState().state === "ready")
  const createDisabled = createMemo((): string | undefined => {
    const state = server.bootstrapState().state
    if (state === "loading") return "Workspace is still loading"
    if (state === "error") return "Workspace is unavailable"
    if (target() === undefined) return "Create a project first"
    return undefined
  })
  const createMessage = createMemo(() => (server.bootstrapState().state === "loading" ? undefined : createDisabled()))
  const createProject = useMutation(() => ({
    mutationKey: [...scopeKey(server.scope), "project", "create"],
    retry: false,
    mutationFn: (input: Project.CreateInput) =>
      server.data.project.create({ ...input, workspace: workspace.current().id }),
    onSuccess: (project) => navigate(projectRouteHref(workspace.current().id, project.id)),
  }))
  const updateProject = useMutation(() => ({
    mutationKey: [...scopeKey(server.scope), "project", "update"],
    retry: false,
    mutationFn: (input: Project.UpdateInput) =>
      server.scope.api.project.update({ ...input, workspace: workspace.current().id }),
    onSuccess: async () => {
      server.data.project.invalidate()
      await server.data.project.sync()
    },
  }))
  // The Default Project cannot be archived, so it stays the first active Project.
  const isDefault = (projectID: Project.ID) => projects()[0]?.id === projectID
  const restoreProject = async (projectID: Project.ID) => {
    const project = await setProjectArchived(server, projectID, false)
    navigate(projectRouteHref(workspace.current().id, project.id))
    return project
  }
  const showCreate = () =>
    dialog.show(() =>
      createComponent(ProjectDialog, {
        mode: {
          type: "create",
          submit: (input) => createProject.mutateAsync(input),
          restore: showRestore,
        },
      }),
    )
  const showRestore = () =>
    dialog.show(() =>
      createComponent(RestoreProjectDialog, {
        list: () => server.scope.api.project.list({ workspace: workspace.current().id, archived: true }),
        restore: (project) => restoreProject(project.id),
        back: showCreate,
      }),
    )
  let pendingDraftID: string | undefined
  const openDraft = (projectID: Project.ID, initial?: Parameters<typeof runtime.draft.create>[2]) => {
    const pending = pendingDraftID ? runtime.draft.get(pendingDraftID) : undefined
    const draft = pending ?? runtime.draft.create(workspace.current().id, projectID, initial)
    pendingDraftID = draft.id
    navigate(`/w/${workspace.current().id}/new-session?draftId=${encodeURIComponent(draft.id)}`)
  }
  const createForProject = (projectID: Project.ID) => {
    if (!confirmed() || !server.data.project.get(projectID)) return false
    openDraft(projectID)
    return true
  }
  /** Open a draft seeded with `initial`; without it, the current Session's selection is inherited. */
  const createWith = (initial?: Parameters<typeof runtime.draft.create>[2]) => {
    const project = target()
    if (!confirmed() || !project) return false
    const currentSession = routeSession()
    const inherited = currentSession
      ? runtime
          .prompt({
            workspaceID: workspace.current().id,
            projectID: currentSession.projectID,
            sessionID: currentSession.id,
          })
          .selection.current()
      : undefined
    openDraft(project.id, initial ?? inherited)
    return true
  }
  // Event handlers pass their event as the first argument, so the plain form takes none.
  const createSession = () => createWith()
  const returnHomeFromRoute = () => {
    if (routeDraft() || routeSession()) navigate(`/w/${workspace.current().id}`)
  }

  command.register("project", () => [
    {
      id: "session.new",
      title: "New session",
      category: "Session",
      // mod+n and mod+t are reserved by Chromium browsers for opening a new
      // window/tab and never reach page JavaScript, so they can never fire.
      keybind: "mod+shift+o",
      evenWhileTyping: true,
      disabled: createDisabled() !== undefined,
      onSelect: createSession,
    },
  ])

  return {
    selection: {
      projectID: selectedProjectID,
      project: selectedProject,
      select: (projectID: Project.ID) => {
        selected[1](selected[0]() === projectID ? undefined : projectID)
        returnHomeFromRoute()
      },
      clear: () => {
        selected[1](undefined)
        returnHomeFromRoute()
      },
    },
    project: {
      list: projects,
      confirmed,
      create: () => {
        if (!confirmed()) return
        showCreate()
      },
      edit: (projectID: string) => {
        if (!confirmed()) return
        const project = projects().find((item) => item.id === projectID)
        if (!project) return
        dialog.show(() =>
          createComponent(ProjectDialog, {
            mode: {
              type: "update",
              project,
              submit: (input) => updateProject.mutateAsync(input),
              archive: {
                disabled: isDefault(project.id) ? defaultProjectReason : undefined,
                run: () =>
                  void archiveProject({
                    server,
                    dialog,
                    project,
                    leave: () => navigate(`/w/${workspace.current().id}`),
                  }),
              },
            },
          }),
        )
      },
      /** Restore an archived Project and open it. */
      restore: restoreProject,
    },
    session: {
      target,
      canCreate: () => createDisabled() === undefined,
      createDisabled,
      createMessage,
      create: createSession,
      createWith,
      createForProject,
    },
  }
}

export type ProjectModel = ReturnType<typeof createProjectModel>

export const { provider: ProjectProvider, use: useProject } = createSimpleContext({
  name: "Project",
  init: createProjectModel,
})
