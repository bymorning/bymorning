import { useNavigate } from "@solidjs/router"
import { createEffect, type JSX } from "solid-js"

import { useServer } from "../runtime/server/runtime"
import { useWorkspace } from "../context/workspace"
import { workspaceRouteHref, projectRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"
import { useProject } from "./model"

export function LegacyProjectRoute(): JSX.Element {
  const server = useServer()
  const model = useProject()
  const workspace = useWorkspace()
  const navigate = useNavigate()

  createEffect(() => {
    const state = server.bootstrapState()
    if (state.state === "loading") return
    if (state.state === "error") {
      navigate(workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.overview), { replace: true })
      return
    }
    const selected = model.selection.project()
    const project = selected ?? model.project.list()[0]
    navigate(
      project
        ? projectRouteHref(workspace.current().id, project.id)
        : workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.overview),
      { replace: true },
    )
  })

  return <p role="status">Loading projects…</p>
}
