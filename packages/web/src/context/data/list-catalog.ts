import type * as Workspace from "@bymorning/schema/workspace"
import { createStore } from "solid-js/store"

import { errorMessage } from "../../utils/error-message"
import type { DataState } from "./state"
import type { DataSync } from "./sync"

export type WorkspaceListCatalog<T> = {
  /** The workspace-scoped value once a sync has succeeded; retained while a refresh is in flight. */
  list: () => T | undefined
  state: () => DataState
  sync: () => Promise<void>
  invalidate: () => void
}

/**
 * One workspace-lifetime catalog slice, mirroring the slices of `createWorkspaceCatalog`:
 * idle → loading (retaining the previous value) → ready, or error (retaining the previous
 * value), with the same cross-workspace sync deduplication through `DataSync`.
 */
export function createWorkspaceListCatalog<T>(config: {
  readonly name: string
  readonly workspace: Workspace.ID
  readonly resource: { readonly signal: AbortSignal }
  readonly sync: DataSync
  readonly fetch: (workspace: Workspace.ID, resource: { readonly signal: AbortSignal }) => Promise<T>
}): WorkspaceListCatalog<T> {
  const [store, setStore] = createStore<Record<Workspace.ID, { state: DataState; value?: T }>>({})
  const key = `workspace.${config.name}:${config.workspace}`
  const sync = () =>
    config.sync.run(key, async () => {
      const current = store[config.workspace]
      const refreshedAt = current && "refreshedAt" in current.state ? current.state.refreshedAt : undefined
      setStore(config.workspace, {
        state: { state: "loading", ...(refreshedAt === undefined ? {} : { refreshedAt }) },
        ...(current?.value === undefined ? {} : { value: current.value }),
      })
      try {
        const value = await config.fetch(config.workspace, config.resource)
        if (config.resource.signal.aborted) return
        setStore(config.workspace, { state: { state: "ready", refreshedAt: Date.now() }, value })
      } catch (cause) {
        if (config.resource.signal.aborted) return
        setStore(config.workspace, {
          state: {
            state: "error",
            ...(refreshedAt === undefined ? {} : { refreshedAt }),
            message: errorMessage(cause, "Request failed"),
          },
          ...(current?.value === undefined ? {} : { value: current.value }),
        })
        throw cause
      }
    })
  return {
    list() {
      const current = store[config.workspace]
      if (!current || !("refreshedAt" in current.state) || current.state.refreshedAt === undefined) return undefined
      return current.value
    },
    state() {
      return store[config.workspace]?.state ?? { state: "idle" }
    },
    sync,
    invalidate() {
      config.sync.invalidate(key)
    },
  }
}
