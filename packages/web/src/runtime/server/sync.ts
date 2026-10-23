import { createConnection, createData, type Connection, type Data, type SessionID } from "@bymorning/client/solid"
import type { QueryClient } from "@tanstack/solid-query"
import { createRoot, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { matchesScope, recoverDirectory } from "./query"
import type { ServerScope } from "./scope"

export type ServerState =
  { readonly state: "loading" } | { readonly state: "ready" } | { readonly state: "error"; readonly error: unknown }
export interface ServerSync {
  readonly scope: ServerScope
  readonly data: Data
  readonly connection: Connection
  readonly state: Accessor<ServerState>
  readonly bootstrapState: Accessor<ServerState>
  readonly queryReady: Accessor<boolean>
  readonly bootstrap: () => Promise<void>
  readonly select: (id: SessionID | undefined) => Promise<void>
  /** Drop this Session only when it is still the routed selection. */
  readonly release: (id: SessionID) => void
  readonly close: () => Promise<void>
  readonly dispose: () => Promise<void>
}

/** The detached root survives provider cleanup until Query cancellation finishes. */
export function createServer(scope: ServerScope, query: QueryClient): ServerSync {
  return createRoot((release) => {
    const connection = createConnection({ api: scope.api, workspace: scope.workspace })
    const data = createData({ api: () => scope.api, workspace: scope.workspace, event: connection, connection })
    const [store, setStore] = createStore<{ state: ServerState; selected: ServerState; closed: boolean }>({
      state: { state: "loading" },
      selected: { state: "ready" },
      closed: false,
    })
    let activated = false
    let connected = false
    let selected: SessionID | undefined
    let generation = 0
    let selection = 0
    let closing: Promise<void> | undefined
    const catalog = [data.project, data.agent, data.model, data.session, data.session.active]
    // The route renders once detail and the Message window have landed; inbox,
    // permission, and form lists fill in afterwards through the same store.
    const primary = [data.session.detail, data.session.message]
    const secondary = [data.session.inbox, data.session.permission, data.session.form]
    const detail = [...primary, ...secondary]
    const hydrating = new Map<SessionID, number>()
    const pending = new Set<SessionID>()
    const hold = (id: SessionID) => hydrating.set(id, (hydrating.get(id) ?? 0) + 1)
    const drop = (id: SessionID) => {
      const next = (hydrating.get(id) ?? 1) - 1
      if (next <= 0) hydrating.delete(id)
      else hydrating.set(id, next)
    }
    const kept = (id: SessionID) => id === selected || pending.has(id) || hydrating.has(id)
    const hydrate = (id: SessionID) => {
      hold(id)
      // Every read starts in one round trip; the hold lasts until all of them settle
      // so live events cannot evict the Session while its lists are still loading.
      const ready = Promise.all(primary.map((part) => part.sync(id)))
      const rest = Promise.all(secondary.map((part) => part.sync(id)))
      void Promise.allSettled([ready, rest]).then(() => drop(id))
      rest.catch(() => undefined)
      return ready.then(() => undefined)
    }
    const bootstrap = async () => {
      if (store.closed) return
      activated = true
      const current = ++generation
      setStore("state", reconcile({ state: "loading" }))
      try {
        await Promise.all(catalog.map((part) => part.sync()))
        // Existing Overview and project navigation search the complete root
        // inventory. Pagination stays in Data, never a second web record list.
        while (!store.closed && current === generation && data.session.more()) await data.session.load()
        if (!store.closed && current === generation) setStore("state", reconcile({ state: "ready" }))
      } catch (error) {
        if (!store.closed && current === generation) setStore("state", reconcile({ state: "error", error }))
        throw error
      }
    }
    const select = async (id: SessionID | undefined) => {
      if (store.closed) return
      if (id) pending.add(id)
      const current = ++selection
      const previous = selected
      selected = id
      if (previous && previous !== id && (id !== undefined || !pending.has(previous))) data.session.evict(previous)
      setStore("selected", reconcile({ state: id ? "loading" : "ready" }))
      if (!id) return
      const load = async () => {
        await hydrate(id)
        if (!store.closed && current === selection && selected === id && !data.session.get(id)) await hydrate(id)
      }
      try {
        await load()
        if (!store.closed && current === selection) setStore("selected", reconcile({ state: "ready" }))
      } catch (error) {
        let failure = error
        const retryable = error instanceof DOMException && error.name === "AbortError"
        if (retryable && !store.closed && current === selection && selected === id) {
          try {
            await load()
            if (!store.closed && current === selection) {
              setStore("selected", reconcile({ state: "ready" }))
              return
            }
          } catch (retry) {
            failure = retry
          }
        }
        if (!store.closed && current === selection) setStore("selected", reconcile({ state: "error", error: failure }))
        throw failure
      } finally {
        pending.delete(id)
        if (selected !== id) data.session.evict(id)
      }
    }
    const releaseSelection = (id: SessionID) => {
      queueMicrotask(() => {
        if (store.closed || selected !== id) return
        void select(undefined)
      })
    }
    // Connection delivery may establish a live projection before the application
    // has visited that Session. Only the routed selection retains history here;
    // eviction leaves shared failed/uncertain Submissions under Data's ownership.
    connection.listen((event) => {
      if (!("sessionID" in event.data)) return
      const id = event.data.sessionID
      if (id && !kept(id)) data.session.evict(id)
    })
    connection.on("server.connected", () => {
      if (store.closed) return
      const reconnect = connected
      connected = true
      // Bootstrap remains explicit until each legacy read owner has cut over.
      if (activated) {
        catalog.forEach((part) => part.invalidate())
        void bootstrap().catch(() => undefined)
      }
      if (selected) {
        const id = selected
        detail.forEach((part) => part.invalidate(id))
        void select(id).catch(() => undefined)
      }
      // Initial enabled observers already fetch after the first handshake.
      if (reconnect) void recoverDirectory(query, scope)
    })
    const close = () => {
      if (closing) return closing
      setStore("closed", true)
      generation++
      selection++
      closing = query.cancelQueries({ predicate: (entry) => matchesScope(scope, entry.queryKey) }).finally(() => {
        query.removeQueries({ predicate: (entry) => matchesScope(scope, entry.queryKey) })
        const mutations = query.getMutationCache()
        for (const mutation of mutations.getAll())
          if (matchesScope(scope, mutation.options.mutationKey ?? [])) mutations.remove(mutation)
        release()
      })
      return closing
    }
    return {
      scope,
      data,
      connection,
      bootstrap,
      select,
      release: releaseSelection,
      close,
      dispose: close,
      state: () => {
        const transport = connection.state()
        if (transport.state === "blocked") return { state: "error", error: transport.error }
        if (store.state.state === "error") return store.state
        if (store.selected.state !== "ready") return store.selected
        return store.state
      },
      queryReady: () => !store.closed && connection.state().state === "connected",
      bootstrapState: () => store.state,
    }
  }, null)
}
