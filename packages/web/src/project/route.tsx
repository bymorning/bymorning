import { Project } from "@bymorning/schema/project"
import { useParams } from "@solidjs/router"
import { Option, Schema } from "effect"
import { createEffect, createMemo, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { createSessionListScrollController } from "../features/session-list/session-list-scroll-controller"
import { createSessionListSearchController } from "../features/session-list/session-list-search-controller"
import { HomeLayout } from "../home/layout"
import { HomeSessionsRegion } from "../home/sessions/region"
import { useServer } from "../runtime/server/runtime"
import { useCommand } from "../shell/commands/context"
import { WorkspacePage } from "../home/workspace-page"
import { Button } from "../ui/components/button"
import { SegmentedControl, SegmentedControlItem } from "../ui/components/segmented-control"
import { useWorkspace } from "../context/workspace"
import { workspaceRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"
import { errorMessage } from "../utils/error-message"
import { createArchivedProject, projectName } from "./archive"
import { useProject } from "./model"
import { useSessionList } from "./session-list"
import "./route.css"

export function ProjectRoute(): JSX.Element {
  const params = useParams<{ projectID?: string }>()
  const server = useServer()
  const controller = useProject()
  const sessions = useSessionList()
  const search = createSessionListSearchController({
    items: sessions.data.searchItems,
    placeholder: sessions.copy.searchPlaceholder,
    noResultsLabel: sessions.copy.searchNoResults,
    loading: sessions.data.loading,
    openSession: sessions.session.open,
  })
  const scroll = createSessionListScrollController(sessions.data.groups)
  const command = useCommand()
  const projectID = createMemo(() => Option.getOrUndefined(Schema.decodeUnknownOption(Project.ID)(params.projectID)))
  const project = createMemo(() => {
    const id = projectID()
    return id ? server.data.project.get(id) : undefined
  })
  const state = () => server.bootstrapState()
  const archived = createArchivedProject(server, projectID)
  const pending = () => !project() && (state().state === "loading" || archived.loading())
  const [restoring, setRestoring] = createStore<{ pending: boolean; error: string | undefined }>({
    pending: false,
    error: undefined,
  })
  const restore = async (id: Project.ID) => {
    if (restoring.pending) return
    setRestoring({ pending: true, error: undefined })
    try {
      await controller.project.restore(id)
      setRestoring("pending", false)
    } catch (cause) {
      setRestoring({ pending: false, error: errorMessage(cause, "Project could not be restored.") })
    }
  }

  // The Session list is shared with Overview, which has no archive view; always start from the active Sessions.
  createEffect(on(projectID, () => sessions.view.showArchived(false)))
  onCleanup(() => sessions.view.showArchived(false))

  command.register("project.sessions", () => [
    {
      id: "project.sessions.search.focus",
      title: sessions.copy.searchPlaceholder(),
      keybind: "mod+f",
      hidden: true,
      onSelect: search.query.focus,
    },
  ])

  return (
    <Switch>
      <Match when={!projectID()}>
        <ProjectRouteMessage title="Invalid project" message="This project URL is not valid." />
      </Match>
      <Match when={project()}>
        {(current) => (
          <HomeLayout
            title={current().name ?? "Untitled"}
            description="Sessions in this project."
            actions={
              <div data-slot="project-actions">
                <Button
                  variant="outline"
                  aria-label="Edit project"
                  disabled={!controller.project.confirmed()}
                  onClick={() => controller.project.edit(current().id)}
                >
                  Edit
                </Button>
                <Button
                  variant="primary"
                  icon="central-plus-small"
                  disabled={!controller.project.confirmed()}
                  onClick={() => controller.session.createForProject(current().id)}
                >
                  New session
                </Button>
              </div>
            }
            scroll={scroll}
            before={
              <SegmentedControl
                data-slot="project-sessions-view"
                aria-label="Session view"
                value={sessions.data.archived() ? "archived" : "active"}
                onChange={(value) => sessions.view.showArchived(value === "archived")}
              >
                <SegmentedControlItem value="active">Active</SegmentedControlItem>
                <SegmentedControlItem value="archived">Archived</SegmentedControlItem>
              </SegmentedControl>
            }
            main={
              <>
                <Show when={state().state === "error"}>
                  <p data-slot="project-cache-warning" role="status">
                    Showing saved project data. Refresh failed.
                  </p>
                </Show>
                <HomeSessionsRegion sessions={sessions} search={search} scroll={scroll} />
              </>
            }
          />
        )}
      </Match>
      <Match when={archived.project()}>
        {(current) => (
          <HomeLayout
            title={projectName(current())}
            description="Archived projects are read-only and hidden with their sessions."
            scroll={scroll}
            main={
              <div data-slot="project-archived" role="status">
                <span>This project is archived</span>
                <Button
                  size="small"
                  variant="neutral"
                  disabled={restoring.pending}
                  onClick={() => void restore(current().id)}
                >
                  Restore
                </Button>
                <Show when={restoring.error}>{(message) => <p role="alert">{message()}</p>}</Show>
              </div>
            }
          />
        )}
      </Match>
      <Match when={pending()}>
        <ProjectRouteMessage title="Project" message="Loading project…" loading />
      </Match>
      <Match when={state().state === "error"}>
        <ProjectRouteMessage
          title="Project unavailable"
          message="Projects could not be loaded."
          onRetry={() => server.bootstrap()}
        />
      </Match>
      <Match when={state().state === "ready"}>
        <ProjectRouteMessage title="Project not found" message="This project does not exist in this workspace." />
      </Match>
    </Switch>
  )
}

function ProjectRouteMessage(props: {
  readonly title: string
  readonly message: string
  readonly loading?: boolean
  readonly onRetry?: () => Promise<void>
}) {
  const workspace = useWorkspace()
  return (
    <WorkspacePage
      eyebrow="Project"
      title={props.title}
      back={{ href: workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.overview), label: "Overview" }}
    >
      <p data-slot="project-route-message" role={props.loading ? "status" : props.onRetry ? "alert" : undefined}>
        {props.message}
      </p>
      {props.onRetry && (
        <Button variant="outline" onClick={() => void props.onRetry?.()}>
          Retry
        </Button>
      )}
    </WorkspacePage>
  )
}
