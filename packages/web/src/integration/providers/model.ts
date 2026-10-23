import type { ByMorningClient, ProviderDirectoryEntry, ProviderInfo } from "@bymorning/client"
import type * as Workspace from "@bymorning/schema/workspace"
import { createStore } from "solid-js/store"

import type { DataState } from "../../context/data"
import type { WorkspaceEvent } from "../../context/workspace-event"
import { errorMessage } from "../../utils/error-message"

/**
 * Feature-local Provider directory resource. `@bymorning/client/solid` Data owns
 * agents and models and has no provider catalog, so provider features own this
 * read: it fetches `client.provider.list` only, deduplicates in-flight and
 * settled requests until invalidated, retains successful items through refresh
 * failures, and invalidation never fetches on its own.
 */
export function createProviderCatalog(input: {
  readonly api: ByMorningClient
  readonly workspace: Workspace.ID
  readonly signal?: AbortSignal
}) {
  const resource: { readonly signal?: AbortSignal } = input.signal !== undefined ? { signal: input.signal } : {}
  const [store, setStore] = createStore<{ state: DataState; items: ProviderDirectoryEntry[] }>({
    state: { state: "idle" },
    items: [],
  })
  type RequestWindow = { readonly startedAt: number; readonly completedAt: number }
  const windows: RequestWindow[] = []
  type Pending = { promise: Promise<void>; invalidated: boolean }
  let pending: Pending | undefined
  let settled = false
  const covers = (createdAt: number) =>
    windows.some((window) => createdAt >= window.startedAt && createdAt <= window.completedAt)

  const run = async () => {
    const current = store.state
    const refreshedAt = "refreshedAt" in current ? current.refreshedAt : undefined
    setStore("state", { state: "loading", ...(refreshedAt === undefined ? {} : { refreshedAt }) })
    const startedAt = Date.now()
    try {
      const items = await input.api.provider.list({ workspace: input.workspace }, resource)
      if (resource.signal?.aborted) return
      windows.push({ startedAt, completedAt: Date.now() })
      if (windows.length > 32) windows.shift()
      setStore({ state: { state: "ready", refreshedAt: Date.now() }, items })
    } catch (cause) {
      if (resource.signal?.aborted) return
      setStore("state", {
        state: "error",
        ...(refreshedAt === undefined ? {} : { refreshedAt }),
        message: errorMessage(cause, "Request failed"),
      })
      throw cause
    }
  }

  const sync = (): Promise<void> => {
    if (pending) {
      // An invalidated read is stale; a new request follows it after it settles.
      if (!pending.invalidated) return pending.promise
    } else if (settled) {
      return Promise.resolve()
    }
    const previous = pending
    const entry: Pending = { promise: Promise.resolve(), invalidated: false }
    pending = entry
    entry.promise = (previous
      ? previous.promise.catch(() => undefined).then(run)
      : run()
    ).then(
      () => {
        if (pending !== entry || entry.invalidated) return
        pending = undefined
        settled = true
      },
      (cause) => {
        if (pending === entry) pending = undefined
        throw cause
      },
    )
    return entry.promise
  }

  const invalidate = () => {
    settled = false
    if (pending) pending.invalidated = true
  }

  const result = {
    state: () => store.state,
    directory: () => store.items,
    activation: () => {
      const state = store.state
      const refreshed = "refreshedAt" in state && state.refreshedAt !== undefined
      if (!refreshed) {
        return state.state === "error"
          ? ({ state: "error", message: state.message } as const)
          : ({ state: "loading" } as const)
      }
      const snapshot = store.items.filter((entry) => entry.active).length
      const refresh =
        state.state === "loading"
          ? ({ state: "loading" } as const)
          : state.state === "error"
            ? ({ state: "error", message: state.message } as const)
            : ({ state: "idle" } as const)
      return snapshot === 0
        ? ({ state: "empty", refresh } as const)
        : ({ state: "ready", count: snapshot, refresh } as const)
    },
    /** Active providers once a sync has started; undefined while idle. */
    list: (): ReadonlyArray<ProviderInfo> | undefined =>
      store.state.state === "idle"
        ? undefined
        : store.items.filter((entry) => entry.active).map((entry) => entry.info),
    /** True when the event was created inside a request window, so the response already carries it. */
    covers,
    sync,
    invalidate,
  }
  return result
}

export type ProviderCatalog = ReturnType<typeof createProviderCatalog>

/**
 * Refresh a mounted feature-owned directory on Integration changes, mirroring the
 * previous Data-owned loop: reads in flight or covered by their own windows are
 * skipped, and a model-affecting change also refreshes Data-owned models.
 */
export function watchProviderDirectory(input: {
  readonly events: WorkspaceEvent.Interface
  readonly signal: AbortSignal
  readonly catalog: ProviderCatalog
  readonly model?: {
    readonly state: () => DataState
    readonly covers: (createdAt: number) => boolean
    readonly invalidate: () => void
    readonly sync: () => Promise<void>
  }
}): void {
  let refreshing = false
  let requested = false
  const refresh = async () => {
    input.catalog.invalidate()
    const refreshes: Array<Promise<unknown>> = [input.catalog.sync()]
    if (input.model) {
      input.model.invalidate()
      refreshes.push(input.model.sync())
    }
    await Promise.all(refreshes).catch(() => undefined)
  }
  const drain = async () => {
    while (requested && !input.signal.aborted) {
      requested = false
      await refresh()
    }
  }
  void (async () => {
    for await (const event of input.events.subscribe({ signal: input.signal })) {
      if (
        event.type !== "config.updated" &&
        event.type !== "integration.updated" &&
        event.type !== "integration.connection.updated"
      )
        continue
      requested = true
      if (refreshing) continue
      refreshing = true
      void drain().finally(() => {
        refreshing = false
      })
    }
  })().catch(() => undefined)
}
