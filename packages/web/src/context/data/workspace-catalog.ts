import type { ByMorningClient, SkillListOutput } from "@bymorning/client"
import type { Data } from "@bymorning/client/solid"
import type * as Workspace from "@bymorning/schema/workspace"
import { createStore } from "solid-js/store"

import { errorMessage } from "../../utils/error-message"
import type { DataState } from "./state"
import type { DataSync } from "./sync"
import type { ServerState } from "../../runtime/server/sync"

type WorkspaceData = {
  skill?: { state: DataState; items: ReadonlyArray<SkillListOutput[number]> }
}

export function createWorkspaceCatalog(config: {
  readonly client: ByMorningClient
  readonly workspace: Workspace.ID
  readonly resource: { readonly signal: AbortSignal }
  readonly sync: DataSync
  readonly shared: Data
  readonly sharedState?: () => ServerState
}) {
  const [store, setStore] = createStore<Record<Workspace.ID, WorkspaceData>>({})
  type RequestWindow = { readonly startedAt: number; readonly completedAt: number }
  const modelRequests: RequestWindow[] = []
  const [sharedState, setSharedState] = createStore<{ agent: DataState; model: DataState }>({
    agent: { state: "idle" },
    model: { state: "idle" },
  })
  const state = (kind: "agent" | "model"): DataState => {
    if (sharedState[kind].state !== "idle" || !config.sharedState) return sharedState[kind]
    const current = config.sharedState()
    if (current.state === "ready") return { state: "ready", refreshedAt: 0 }
    if (current.state === "error") return { state: "error", message: errorMessage(current.error, "Request failed") }
    return { state: "loading" }
  }
  const syncShared = async (kind: "agent" | "model") => {
    const previous = sharedState[kind]
    const refreshed =
      "refreshedAt" in previous && previous.refreshedAt !== undefined ? { refreshedAt: previous.refreshedAt } : {}
    setSharedState(kind, { state: "loading", ...refreshed })
    const startedAt = Date.now()
    try {
      await config.shared[kind].sync()
      if (kind === "model") {
        modelRequests.push({ startedAt, completedAt: Date.now() })
        if (modelRequests.length > 32) modelRequests.shift()
      }
      setSharedState(kind, { state: "ready", refreshedAt: Date.now() })
    } catch (cause) {
      setSharedState(kind, { state: "error", ...refreshed, message: errorMessage(cause, "Request failed") })
      throw cause
    }
  }
  const catalog = {
    agent: {
      list: () => {
        const rows = config.shared.agent.list()
        return rows.length || "refreshedAt" in state("agent") ? rows : undefined
      },
      state: (): DataState => state("agent"),
      sync: () => syncShared("agent"),
      invalidate: () => config.shared.agent.invalidate(),
    },
    model: {
      list(workspaceID = config.workspace) {
        if (config.shared.model.list().length === 0 && !("refreshedAt" in state("model"))) return undefined
        return config.shared.model
          .list()
          .filter((item) => item.enabled && item.unavailableReason === undefined)
          .map((item) => item.info)
      },
      rows(workspaceID = config.workspace) {
        return [...config.shared.model.list()]
      },
      /**
       * The Workspace's live default Model — the same one the server falls
       * back to when a Session request carries no explicit Model — so a
       * client can pre-select it without duplicating the server's fallback
       * logic (which also degrades to another usable Model when the
       * configured default is disabled or unavailable).
       */
      default(workspaceID = config.workspace) {
        return config.shared.model.list().find((item) => item.isEffectiveDefault)?.info
      },
      state(workspaceID = config.workspace): DataState {
        return state("model")
      },
      covers(createdAt: number, workspaceID = config.workspace) {
        return modelRequests.some((request) => createdAt >= request.startedAt && createdAt <= request.completedAt)
      },
      sync(workspaceID = config.workspace) {
        return syncShared("model")
      },
      invalidate(workspaceID = config.workspace) {
        config.shared.model.invalidate()
      },
    },
    skill: {
      list(workspaceID = config.workspace) {
        const skill = store[workspaceID]?.skill
        if (!skill || !("refreshedAt" in skill.state) || skill.state.refreshedAt === undefined) return undefined
        return skill.items
      },
      state(workspaceID = config.workspace): DataState {
        return store[workspaceID]?.skill?.state ?? { state: "idle" }
      },
      sync(workspaceID = config.workspace) {
        return config.sync.run(`workspace.skill:${workspaceID}`, async () => {
          const current = store[workspaceID]?.skill
          const refreshedAt = current && "refreshedAt" in current.state ? current.state.refreshedAt : undefined
          setStore(workspaceID, {
            ...store[workspaceID],
            skill: {
              state: { state: "loading", ...(refreshedAt === undefined ? {} : { refreshedAt }) },
              items: current?.items ?? [],
            },
          })
          try {
            const skills = await config.client.skill.list({ workspace: workspaceID }, config.resource)
            if (config.resource.signal.aborted) return
            setStore(workspaceID, {
              ...store[workspaceID],
              skill: { state: { state: "ready", refreshedAt: Date.now() }, items: skills },
            })
          } catch (cause) {
            if (config.resource.signal.aborted) return
            setStore(workspaceID, {
              ...store[workspaceID],
              skill: {
                state: {
                  state: "error",
                  ...(refreshedAt === undefined ? {} : { refreshedAt }),
                  message: errorMessage(cause, "Request failed"),
                },
                items: current?.items ?? [],
              },
            })
            throw cause
          }
        })
      },
      invalidate(workspaceID = config.workspace) {
        config.sync.invalidate(`workspace.skill:${workspaceID}`)
      },
    },
    sync(workspaceID = config.workspace) {
      return Promise.all([catalog.agent.sync(), catalog.model.sync(workspaceID), catalog.skill.sync(workspaceID)]).then(
        () => undefined,
      )
    },
    invalidate(workspaceID = config.workspace) {
      catalog.agent.invalidate()
      catalog.model.invalidate(workspaceID)
      catalog.skill.invalidate(workspaceID)
    },
  }
  return catalog
}
