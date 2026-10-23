import { useNavigate } from "@solidjs/router"
import { createEffect, on, Show, type JSX, type ParentProps } from "solid-js"

import { useWorkspace } from "../context/workspace"
import { workspaceRouteHref, WorkspaceRoutePath } from "../workspace-route-paths"
import "./gate.css"

/**
 * Reserve the Console section for the workspace admin Role.
 *
 * Admins render the routed Console child. Members are redirected to the
 * workspace overview with replace, and nothing mounts while the decision is
 * neither allowed nor routed away, so a Console child never mounts unresolved.
 * The current Workspace is re-read reactively, so switching to a workspace
 * whose Role lacks Console access dismisses the mounted child.
 */
export function ConsoleGate(props: ParentProps): JSX.Element {
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const denied = () => workspace.current().role !== "admin"
  const overview = () => workspaceRouteHref(workspace.current().id, WorkspaceRoutePath.overview)
  createEffect(
    on(denied, (isDenied) => {
      if (isDenied) navigate(overview(), { replace: true })
    }),
  )
  return (
    <Show when={!denied()}>
      <div data-component="console-view">
        <div data-slot="console-view-content">{props.children}</div>
      </div>
    </Show>
  )
}
