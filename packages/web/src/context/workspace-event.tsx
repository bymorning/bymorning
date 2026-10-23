import type { SessionEventPayload, WorkspaceEventItem } from "@bymorning/client"
import { createStore } from "solid-js/store"
import { createEffect, onCleanup, type Accessor, type ParentProps } from "solid-js"

import { createMulticast } from "../runtime/workspace-event/channel"
import { useServer } from "../runtime/server/runtime"
import { errorMessage } from "../utils/error-message"
import { createSimpleContext } from "./helper"

export type WorkspaceSessionEvent = SessionEventPayload
export type SessionSyncItem = WorkspaceEventItem

export namespace WorkspaceEvent {
  export type ConnectionStatus = "connecting" | "connected" | "reconnecting"
  export type Item = WorkspaceEventItem

  /** The one live Workspace Event connection and its multicast feed. */
  export interface Interface {
    readonly status: Accessor<ConnectionStatus>
    readonly attempt: Accessor<number>
    readonly error: Accessor<string | undefined>
    /** The successful physical-stream generation, if a connection is live. */
    readonly current: Accessor<number | undefined>
    readonly subscribe: (options: { readonly signal: AbortSignal }) => AsyncIterable<Item>
    readonly reconnect: () => void
  }
}

function createWorkspaceEvent(): WorkspaceEvent.Interface {
  const { connection } = useServer()
  const [connectionState, setConnectionState] = createStore<{
    status: WorkspaceEvent.ConnectionStatus
    attempt: number
    error: string | undefined
    current: number | undefined
  }>({ status: "connecting", attempt: 0, error: undefined, current: undefined })
  const events = createMulticast<WorkspaceEvent.Item>(1_024)
  let connected: Extract<WorkspaceEvent.Item, { readonly type: "server.connected" }> | undefined

  let generation = 0
  connection.listen((item) => {
    if (item.type === "server.connected") {
      generation++
      if (connection.state().state === "connected") {
        connected = item
        setConnectionState({ status: "connected", attempt: 0, error: undefined, current: generation })
      }
    }
    events.send(item)
  })
  createEffect(() => {
    const state = connection.state()
    if (state.state === "connected") return
    connected = undefined
    setConnectionState({
      status: state.state === "connecting" ? "connecting" : "reconnecting",
      attempt: state.state === "reconnecting" ? state.attempt : 0,
      error: "error" in state ? errorMessage(state.error, "Workspace event connection failed") : undefined,
      current: undefined,
    })
  })
  onCleanup(() => {
    events.close()
  })

  return {
    status: () => connectionState.status,
    attempt: () => connectionState.attempt,
    error: () => connectionState.error,
    current: () => connectionState.current,
    subscribe: ({ signal }) => {
      // Register before yielding the retained boundary so no direct event can be lost
      // between subscription and the consumer's initial hydration.
      const feed = events.read(signal)
      const boundary = connected
      return (async function* () {
        if (boundary !== undefined) yield boundary
        yield* feed
      })()
    },
    reconnect: () => connection.retry(),
  }
}

const workspaceEventContext = createSimpleContext({
  name: "WorkspaceEvent",
  init: (_props: ParentProps) => createWorkspaceEvent(),
})
export const WorkspaceEventProvider = workspaceEventContext.provider
export const useWorkspaceEvent = workspaceEventContext.use
export const useOptionalWorkspaceEvent = workspaceEventContext.optional
