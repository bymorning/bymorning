import type { QueryClient } from "@tanstack/solid-query"
import {
  createConnection,
  createData,
  type Connection,
  type Data,
  type SessionID,
  type WorkspaceID,
} from "@bymorning/client/solid"
import { createEffect, createSignal, getOwner, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServerScope } from "@/runtime/server/scope.js"

type Catalog = {
  projects: boolean
  agents: boolean
  models: boolean
  sessions: boolean
}

export interface ServerSync {
  readonly workspace: WorkspaceID
  readonly data: Data
  readonly connection: Connection
  readonly state: { readonly boot: "loading" | "ready" | "error"; readonly error?: unknown }
  /** Whether file queries and controls may start new work in this application scope. */
  readonly queryReady: () => boolean
  readonly catalog: () => Catalog
  readonly bootstrap: () => Promise<void>
  readonly select: (sessionID: SessionID | undefined) => Promise<void>
  /** Stops recovery work while the owning provider drains its Query requests. */
  readonly close: () => void
  readonly dispose: () => void
}

/** Coordinates explicit Data reads for one server scope; Data still owns all projections. */
export function createSync(input: ServerScope): ServerSync
export function createSync(input: ServerScope, query: QueryClient): ServerSync
export function createSync(input: ServerScope, query?: QueryClient): ServerSync {
  if (!getOwner()) throw new Error("createSync must run under a Solid owner")

  const connection = createConnection({ api: input.api, workspace: input.workspace, report: console.error })
  const data = createData({
    api: () => input.api,
    workspace: input.workspace,
    event: connection,
    connection,
    report: console.error,
  })
  const [state, setState] = createStore<{ boot: "loading" | "ready" | "error"; error?: unknown }>({ boot: "loading" })
  const [catalog, setCatalog] = createStore<Catalog>({ projects: false, agents: false, models: false, sessions: false })
  const [queryReady, setQueryReady] = createSignal(false)
  let selected: SessionID | undefined
  let started = false
  let initialConnection = false
  let bootstrapSettled = false
  let closing = false
  let disposed = false
  let selection = Promise.resolve()

  const report = (error: unknown) => {
    if (!disposed) setState({ boot: "error", error })
  }
  // Transport loss immediately closes the application file gate. It never opens
  // from raw transport state: server.connected chooses the safe recovery point.
  createEffect(() => {
    if (connection.state().state !== "connected") setQueryReady(false)
  })
  const releaseQueries = () => {
    if (!closing && !disposed && initialConnection && bootstrapSettled && connection.state().state === "connected")
      setQueryReady(true)
  }
  const syncCatalog = async () => {
    await Promise.all([
      data.project.sync().then(() => setCatalog("projects", true)),
      data.agent.sync().then(() => setCatalog("agents", true)),
      data.model.sync().then(() => setCatalog("models", true)),
      data.session.sync().then(() => setCatalog("sessions", true)),
    ])
  }
  const syncSelected = async (sessionID: SessionID) => {
    await Promise.all([
      data.session.detail.sync(sessionID),
      data.session.message.sync(sessionID),
      data.session.inbox.sync(sessionID),
      data.session.permission.sync(sessionID),
      data.session.form.sync(sessionID),
      data.session.active.sync(),
    ])
  }
  const recover = async () => {
    try {
      await syncCatalog()
      if (selected) await syncSelected(selected)
      if (!disposed) setState({ boot: "ready", error: undefined })
    } catch (error) {
      report(error)
      throw error
    }
  }
  const bootstrap = () => {
    started = true
    setState({ boot: "loading", error: undefined })
    return recover().finally(() => {
      bootstrapSettled = true
      releaseQueries()
    })
  }
  const select = (sessionID: SessionID | undefined) => {
    const current = selection.then(async () => {
      if (disposed || closing || selected === sessionID) return
      const prior = selected
      selected = sessionID
      if (prior) data.session.evict(prior)
      if (sessionID && started) await syncSelected(sessionID)
    })
    selection = current.catch(report)
    return current
  }
  const scopedFile = (item: { readonly queryKey: readonly unknown[] }) => {
    const key = item.queryKey
    return (
      key[0] === input.origin &&
      key[1] === input.identity &&
      key[2] === input.workspace &&
      (key[3] === "project-directory" || key[3] === "project-directory-content")
    )
  }
  const reconnect = async () => {
    if (!query || closing || disposed) return
    try {
      await query.invalidateQueries({
        predicate: scopedFile,
        refetchType: "none",
      })
      if (closing || disposed) return
      try {
        await recover()
      } catch {
        // recover records Data failures in application state; file observers own theirs.
      }
      if (closing || disposed) return
      await query.refetchQueries({ predicate: scopedFile, type: "active" })
    } finally {
      // A catalog failure must not leave independent file recovery permanently gated.
      releaseQueries()
    }
  }
  const unlisten = connection.on("server.connected", () => {
    // A handshake received while bootstrap is still reading has no missed window.
    // If bootstrap already settled offline, this first handshake must instead
    // recover the selected history just like every later reconnect.
    if (!initialConnection) {
      initialConnection = true
      if (!bootstrapSettled) {
        releaseQueries()
        return
      }
    }
    if (!started || closing || disposed) return
    setQueryReady(false)
    void reconnect().catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error)
    })
  })
  const close = () => {
    if (closing || disposed) return
    closing = true
    unlisten()
  }
  const dispose = () => {
    if (disposed) return
    close()
    disposed = true
    data.dispose()
    connection.dispose()
  }
  // ServerProvider owns resource disposal so it can await Query cancellation.
  // Direct callers still stop recovery when their Solid owner is destroyed.
  onCleanup(close)

  return {
    workspace: input.workspace,
    data,
    connection,
    state,
    queryReady,
    catalog: () => catalog,
    bootstrap,
    select,
    close,
    dispose,
  }
}
