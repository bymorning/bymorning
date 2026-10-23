import type { WorkspaceEventItem } from "@bymorning/client"
import { onCleanup, onMount, type Accessor } from "solid-js"

/** The Right Sidebar state an agent asked for by calling the `sidebar` Tool. */
export interface SidebarRequest {
  readonly open: boolean
  readonly path?: string
}

const tool = "sidebar"

/**
 * Reads a `sidebar` Tool result without trusting its shape. The payload crosses
 * the wire as free-form JSON, so every field is checked before it reaches layout state.
 */
export function parseSidebar(result: unknown): SidebarRequest | undefined {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined
  const open = Reflect.get(result, "open")
  if (typeof open !== "boolean") return undefined
  if (!open) return { open: false }
  const path = Reflect.get(result, "path")
  return typeof path === "string" && path.length > 0 ? { open: true, path } : { open: true }
}

/**
 * Applies Right Sidebar requests the agent makes during this Session.
 *
 * Live Workspace Events are the only trigger. They are never replayed, so reopening or
 * reloading a Session does not re-apply an earlier request; the participant keeps whatever
 * sidebar state they last chose.
 */
export function createSidebarController(input: {
  readonly subscribe: (options: { readonly signal: AbortSignal }) => AsyncIterable<WorkspaceEventItem>
  readonly sessionID: Accessor<string>
  readonly apply: (request: SidebarRequest) => void
}): void {
  onMount(() => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    void (async () => {
      for await (const event of input.subscribe({ signal: controller.signal })) {
        if (controller.signal.aborted) return
        if (event.type !== "session.tool.success" || event.data.name !== tool) continue
        if (event.data.sessionID !== input.sessionID()) continue
        const request = parseSidebar(event.data.result)
        if (request !== undefined) input.apply(request)
      }
    })().catch((cause) => {
      if (!controller.signal.aborted) console.error("Right sidebar control events failed", cause)
    })
  })
}
