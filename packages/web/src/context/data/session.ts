import type { ByMorningClient, SessionEventPayload } from "@bymorning/client"
import type { Data } from "@bymorning/client/solid"
import type { Session } from "@bymorning/schema/session"
import type * as Workspace from "@bymorning/schema/workspace"
import { createEffect, createMemo, on, onCleanup, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import type { DataState } from "./state"
import type { ServerState } from "../../runtime/server/sync"
import { errorMessage } from "../../utils/error-message"

export type DataSessionStatus = "idle" | "running"
export interface SessionPresentation {
  readonly open: boolean
  readonly foreground: boolean
}

/** Presentation only: shared Data owns every server record and running state. */
export function createSessionData(config: {
  readonly client: ByMorningClient
  readonly workspace: Workspace.ID
  readonly resource: { readonly signal: AbortSignal }
  readonly shared: Data
  readonly sharedState?: () => ServerState
}) {
  const [store, setStore] = createStore({
    unread: {} as Record<string, boolean>,
    attentionRevision: {} as Record<string, number>,
    attention: {} as Record<string, boolean>,
    // Server list rows only learn a Session's new activity time on the next read;
    // live activity Events carry it, so the latest one overrides the row's updatedAt.
    touched: {} as Record<string, number>,
  })
  type Row = ReturnType<typeof config.shared.session.list>[number]
  const rows = () => config.shared.session.list()
  let attentionRead: AbortController | undefined
  let attentionPending: Promise<void> | undefined
  let attentionQueued = false
  const readAttention = async () => {
    const current = (attentionRead = new AbortController())
    const requests = await config.client.permission.request
      .list({ workspace: config.workspace }, { signal: current.signal })
      .catch((cause) => {
        if (current.signal.aborted) return undefined
        throw cause
      })
    if (current.signal.aborted || config.resource.signal.aborted) return
    if (requests)
      setStore("attention", reconcile(Object.fromEntries(requests.map((request) => [request.sessionID, true]))))
  }
  // One read is in flight at a time; a burst of permission events coalesces
  // into a single trailing read that observes everything the burst changed.
  const syncAttention = () => {
    if (attentionPending) {
      attentionQueued = true
      return attentionPending
    }
    attentionPending = (async () => {
      do {
        attentionQueued = false
        await readAttention()
      } while (attentionQueued && !config.resource.signal.aborted)
    })().finally(() => {
      attentionPending = undefined
    })
    return attentionPending
  }
  onCleanup(() => attentionRead?.abort())
  // Rows are only cloned when a live Event is newer than the server's updatedAt, and the
  // clone is reused until either side changes, so unrelated rows keep their identity.
  const overridden = new WeakMap<object, { time: number; row: Row }>()
  const sessions = createMemo(() => {
    const effective = (row: Row) => Math.max(row.updatedAt.valueOf(), store.touched[row.id] ?? 0)
    return rows()
      .toSorted((left, right) => effective(right) - effective(left) || left.id.localeCompare(right.id))
      .map((row) => {
        const time = effective(row)
        if (time === row.updatedAt.valueOf()) return row
        const cached = overridden.get(row)
        if (cached?.time === time) return cached.row
        const next = { ...row, updatedAt: new Date(time) }
        overridden.set(row, { time, row: next })
        return next
      })
  })
  // A touched time is only a stopgap until the server row catches up.
  createEffect(
    on(rows, (list) =>
      untrack(() => {
        const caught = list.filter((row) => {
          const touched = store.touched[row.id]
          return touched !== undefined && touched <= row.updatedAt.valueOf()
        })
        if (caught.length)
          setStore(
            "touched",
            produce((draft) => {
              for (const row of caught) delete draft[row.id]
            }),
          )
      }),
    ),
  )
  return {
    state: (): DataState => {
      const state = config.sharedState?.()
      if (state?.state === "error") return { state: "error", message: errorMessage(state.error, "Request failed") }
      return config.shared.session.loading() || state?.state === "loading"
        ? { state: "loading" }
        : { state: "ready", refreshedAt: 0 }
    },
    list: sessions,
    get: (sessionID: string) =>
      config.shared.session.get(sessionID as Session.ID) ?? sessions().find((row) => row.id === sessionID),
    detail: config.shared.session.get,
    create: (input: Session.CreateInput) => config.shared.session.create({ ...input, workspace: config.workspace }),
    status: (sessionID: Session.ID): DataSessionStatus => config.shared.session.active.get(sessionID) ?? "idle",
    syncAttention,
    attention: (sessionID: Session.ID) => store.attention[sessionID] ?? false,
    attentionRevision: (sessionID: Session.ID) => store.attentionRevision[sessionID] ?? 0,
    unread: (sessionID: Session.ID) => store.unread[sessionID] ?? false,
    applyWorkspaceEvent(event: SessionEventPayload, presentation: SessionPresentation) {
      const sessionID = event.data.sessionID
      if (sessionID === undefined) return
      if (event.type === "session.updated" && event.data.session.archivedAt)
        setStore(
          "touched",
          produce((draft) => void delete draft[sessionID]),
        )
      if (event.type === "session.deleted") {
        attentionRead?.abort()
        setStore(
          produce((draft) => {
            delete draft.unread[sessionID]
            delete draft.attentionRevision[sessionID]
            delete draft.attention[sessionID]
            delete draft.touched[sessionID]
          }),
        )
      }
      if (
        event.type === "session.input.admitted" ||
        event.type === "session.input.promoted" ||
        event.type === "session.run.started" ||
        event.type === "session.run.succeeded" ||
        event.type === "session.run.failed" ||
        event.type === "session.run.interrupted"
      )
        setStore("touched", sessionID, (value = 0) => Math.max(value, event.created))
      if (event.type === "permission.v2.asked" || event.type === "permission.v2.replied") {
        if (event.type === "permission.v2.asked") setStore("attention", sessionID, true)
        setStore("attentionRevision", sessionID, (value = 0) => value + 1)
        void syncAttention().catch((cause) => {
          if (!config.resource.signal.aborted && !(cause instanceof DOMException && cause.name === "AbortError"))
            console.error("Session attention refresh failed", cause)
        })
      }
      if (
        event.type === "session.run.succeeded" ||
        event.type === "session.run.failed" ||
        event.type === "session.run.interrupted"
      ) {
        if (presentation.foreground) setStore("unread", sessionID, false)
        else if (presentation.open) setStore("unread", sessionID, true)
      }
    },
    view(sessionID: Session.ID | undefined) {
      if (sessionID) setStore("unread", sessionID, false)
    },
  }
}
