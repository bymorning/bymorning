import { useLocation } from "@solidjs/router"
import type { SessionEventPayload } from "@bymorning/client"
import { onCleanup, onMount } from "solid-js"
import { useData } from "../../context/data"
import { useWorkspace } from "../../context/workspace"
import { useWorkspaceEvent } from "../../context/workspace-event"
import { sessionRouteHref } from "../../workspace-route-paths"

export function SessionSync() {
  const events = useWorkspaceEvent()
  const data = useData()
  const workspace = useWorkspace()
  const location = useLocation()

  onMount(() => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    void (async () => {
      for await (const event of events.subscribe({ signal: controller.signal })) {
        if (controller.signal.aborted) return
        if (event.type === "server.connected") {
          void data.session.syncAttention().catch((cause) => console.error("Session attention refresh failed", cause))
          continue
        }
        if (!("sessionID" in event.data) || event.data.sessionID === undefined) continue
        const sessionID = event.data.sessionID
        const workspaceID = workspace.current().id
        const foreground = location.pathname === sessionRouteHref(workspaceID, sessionID)
        data.session.applyWorkspaceEvent(event as SessionEventPayload, { open: foreground, foreground })
      }
    })().catch((cause) => {
      if (!controller.signal.aborted) console.error("Session presentation events failed", cause)
    })
  })
  return <></>
}
