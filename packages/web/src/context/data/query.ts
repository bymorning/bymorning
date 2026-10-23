import type * as Workspace from "@bymorning/schema/workspace"
import { createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

import { errorMessage } from "../../utils/error-message"
import type { DataState } from "./state"

export type QueryState<T> = DataState & { readonly data?: T }

export type WorkspaceQuery<A, T> = (
  args: () => A | undefined,
) => {
  readonly state: () => QueryState<T>
  readonly refetch: () => void
}

/**
 * Parameterised workspace read, the single owner of the stale-workspace guard the drifted routes
 * used to hand-roll. Every result is stored under `${workspace}:${key(args)}`, so switching to
 * unseen arguments shows a fresh entry (never a previous entry's data), refetching keeps the
 * previous data while loading, and results fetched for another Workspace are unreachable. One
 * request per query instance: starting a new one aborts the previous attempt, and unmounting
 * aborts the active one.
 */
export function createWorkspaceQuery<A, T>(config: {
  readonly workspace: () => Workspace.ID
  readonly resource: { readonly signal: AbortSignal }
  readonly key: (args: A) => string
  readonly fetch: (workspace: Workspace.ID, args: A, resource: { readonly signal: AbortSignal }) => Promise<T>
}): WorkspaceQuery<A, T> {
  const [entries, setEntries] = createStore<Record<string, { state: DataState; data?: T }>>({})
  return (args) => {
    const owner = new AbortController()
    onCleanup(() => owner.abort())
    let inFlight: AbortController | undefined
    const [, { refetch }] = createResource(
      () => {
        const current = args()
        const workspace = config.workspace()
        if (current === undefined || owner.signal.aborted || config.resource.signal.aborted) return undefined
        return { id: `${workspace}:${config.key(current)}`, workspace, args: current }
      },
      async (source) => {
        inFlight?.abort()
        const attempt = new AbortController()
        inFlight = attempt
        if (config.resource.signal.aborted || owner.signal.aborted) attempt.abort()
        config.resource.signal.addEventListener("abort", () => attempt.abort(), { once: true })
        owner.signal.addEventListener("abort", () => attempt.abort(), { once: true })
        const current = entries[source.id]
        const refreshedAt = current && "refreshedAt" in current.state ? current.state.refreshedAt : undefined
        setEntries(source.id, {
          state: { state: "loading", ...(refreshedAt === undefined ? {} : { refreshedAt }) },
          ...(current?.data === undefined ? {} : { data: current.data }),
        })
        try {
          const data = await config.fetch(source.workspace, source.args, attempt)
          if (attempt.signal.aborted) return
          setEntries(source.id, { state: { state: "ready", refreshedAt: Date.now() }, data })
        } catch (cause) {
          if (attempt.signal.aborted) return
          setEntries(source.id, {
            state: {
              state: "error",
              ...(refreshedAt === undefined ? {} : { refreshedAt }),
              message: errorMessage(cause, "Request failed"),
            },
            ...(current?.data === undefined ? {} : { data: current.data }),
          })
          throw cause
        }
      },
    )
    return {
      state: (): QueryState<T> => {
        const current = args()
        const entry = current === undefined ? undefined : entries[`${config.workspace()}:${config.key(current)}`]
        if (entry === undefined) return { state: "idle" }
        return { ...entry.state, ...(entry.data === undefined ? {} : { data: entry.data }) }
      },
      refetch: () => {
        if (args() === undefined) return
        void refetch()
      },
    }
  }
}
