import type * as Workspace from "@bymorning/schema/workspace"
import { Integration } from "@bymorning/schema/integration"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useOptionalIntegration } from "../context/integration"
import { internalSkill } from "../features/skill-list/skill-list-model"
import { useWorkspace } from "../context/workspace"
import { useOptionalWorkspaceEvent } from "../context/workspace-event"
import { useProviderManagement } from "../integration/providers/management"
import { createProviderCatalog, watchProviderDirectory, type ProviderCatalog } from "../integration/providers/model"
import { Persist, persisted, type SyncStorage } from "../runtime/persistence/storage"
import { useServer } from "../runtime/server/runtime"
import { showToast } from "../ui/components/toast"

/** Checklist items, in display order. */
export const stepIDs = ["provider", "session", "skills", "budget", "tools", "apps"] as const
export type StepID = (typeof stepIDs)[number]

/** Whether the outcome exists in the Workspace. `loading` until the owning read has settled once. */
export type StepState = "done" | "skipped" | "pending" | "loading"

export interface Step {
  readonly id: StepID
  readonly state: StepState
}

interface Preference {
  checklist?: "dismissed"
  skipped: Partial<Record<StepID, true>>
}

export const preferenceTarget = (workspaceID: Workspace.ID) => Persist.workspace(workspaceID, "getting-started.v1")

/**
 * Browser-local Getting Started preference. Like Picker Visibility it records
 * only what the person chose to skip or dismiss; completion is never stored.
 */
export function createGettingStartedPreference(workspaceID: Workspace.ID, storage?: SyncStorage) {
  const store = createStore<Preference>({ skipped: {} })
  // Explicit store typing selects the store overload across the signal/store union.
  // oxlint-disable-next-line typescript-eslint/no-unnecessary-type-arguments
  const [state, setState] = persisted<Preference, typeof store>(
    preferenceTarget(workspaceID),
    store,
    storage ? { storage } : {},
  )
  return {
    dismissed: () => state.checklist === "dismissed",
    skipped: (id: StepID) => state.skipped?.[id] === true,
    dismiss: () => setState("checklist", "dismissed"),
    restore: () => setState("checklist", undefined),
    skip: (id: StepID) => setState("skipped", (skipped = {}) => ({ ...skipped, [id]: true })),
    // Setting a store key to undefined removes it; a returned object would merge instead.
    unskip: (id: StepID) => setState("skipped", id, undefined),
  }
}

export type GettingStartedPreference = ReturnType<typeof createGettingStartedPreference>

/**
 * Derived Getting Started state for the current Workspace. Every step reads the
 * outcome it stands for from existing Workspace data; nothing here writes to the
 * server. Reads are only started for administrators, who are the only people
 * that see Getting Started.
 */
export function createGettingStarted(props: { readonly storage?: SyncStorage } = {}) {
  const workspace = useWorkspace()
  const data = useData()
  const server = useServer()
  // Both are mounted by AppLayout; their absence only means live refresh and web search detection are off.
  const events = useOptionalWorkspaceEvent()
  const integration = useOptionalIntegration()
  const admin = () => workspace.current().role === "admin"
  const preference = createGettingStartedPreference(workspace.current().id, props.storage)
  // Dialogs live as long as their opener. Step actions unmount the moment a step
  // completes, so every Getting Started dialog is opened from this owner instead.
  const dialog = useDialog()

  const resource = new AbortController()
  onCleanup(() => resource.abort())
  const catalog: ProviderCatalog = createProviderCatalog({
    api: server.scope.api,
    workspace: server.scope.workspace,
    signal: resource.signal,
  })
  const manage = useProviderManagement(catalog)

  const sync = () => {
    catalog.invalidate()
    void catalog.sync().catch(() => undefined)
    void data.workspace.model.sync().catch(() => undefined)
    void data.workspace.budget.sync().catch(() => undefined)
    void data.workspace.skill.sync().catch(() => undefined)
    void data.workspace.serviceAccount.sync().catch(() => undefined)
    void data.workspace.mcpServer.sync().catch(() => undefined)
    void integration?.refetch()
  }

  onMount(() => {
    if (!admin()) return
    sync()
    if (!events) return
    watchProviderDirectory({ events, signal: resource.signal, catalog, model: data.workspace.model })
    void (async () => {
      for await (const event of events.subscribe({ signal: resource.signal })) {
        if (event.type === "mcp.status.changed") {
          data.workspace.mcpServer.invalidate()
          void data.workspace.mcpServer.sync().catch(() => undefined)
        }
      }
    })().catch(() => undefined)
  })

  const settled = (state: { readonly state: string; readonly refreshedAt?: number }) =>
    state.state === "ready" || state.refreshedAt !== undefined

  const providerState = createMemo((): StepState => {
    const activation = catalog.activation()
    if (activation.state === "ready") return "done"
    if (activation.state === "empty") return preference.skipped("provider") ? "skipped" : "pending"
    return "loading"
  })
  const modelCount = createMemo(() => data.workspace.model.list()?.length)

  const sessionState = createMemo((): StepState => {
    if (data.session.state().state !== "ready") return "loading"
    if (data.session.list().length > 0) return "done"
    return preference.skipped("session") ? "skipped" : "pending"
  })

  /**
   * Skills contributed by the installation are always present, so only Skills
   * the Workspace itself owns count as a library the administrator has started.
   */
  const skillsState = createMemo((): StepState => {
    const skills = data.workspace.skill.list()
    if (skills === undefined) return settled(data.workspace.skill.state()) ? "pending" : "loading"
    if (skills.some((skill) => !internalSkill(skill.id))) return "done"
    return preference.skipped("skills") ? "skipped" : "pending"
  })

  const budgetState = createMemo((): StepState => {
    const standings = data.workspace.budget.list()?.standings
    if (standings === undefined) return settled(data.workspace.budget.state()) ? "pending" : "loading"
    if (standings.some((standing) => standing.target.type === "workspace" && standing.limit !== undefined))
      return "done"
    return preference.skipped("budget") ? "skipped" : "pending"
  })

  /** True/false once both reads settle; undefined while pending; false when web search cannot be read at all. */
  const websearchConnected = createMemo(() => {
    if (!integration) return false
    const providers = integration.websearch()
    const list = integration.list()
    if (providers.state === "error" || list.state === "error") return false
    if (providers.state !== "ready" || list.state !== "ready") return undefined
    return providers.data.some(
      (provider) =>
        (list.data.find((item) => item.id === Integration.ID.make(provider.id))?.connections.length ?? 0) > 0,
    )
  })
  const toolsState = createMemo((): StepState => {
    const servers = data.workspace.mcpServer.list()
    const websearch = websearchConnected()
    if ((servers?.length ?? 0) > 0 || websearch === true) return "done"
    if (servers === undefined && !settled(data.workspace.mcpServer.state())) return "loading"
    if (websearch === undefined) return "loading"
    return preference.skipped("tools") ? "skipped" : "pending"
  })

  const appsState = createMemo((): StepState => {
    const accounts = data.workspace.serviceAccount.list()
    if (accounts === undefined) return settled(data.workspace.serviceAccount.state()) ? "pending" : "loading"
    if (accounts.some((account) => account.keyCount > 0)) return "done"
    return preference.skipped("apps") ? "skipped" : "pending"
  })

  const steps = createMemo((): ReadonlyArray<Step> => [
    { id: "provider", state: providerState() },
    { id: "session", state: sessionState() },
    { id: "skills", state: skillsState() },
    { id: "budget", state: budgetState() },
    { id: "tools", state: toolsState() },
    { id: "apps", state: appsState() },
  ])
  const complete = createMemo(() => steps().filter((step) => step.state === "done" || step.state === "skipped").length)
  const finished = createMemo(() => steps().every((step) => step.state === "done" || step.state === "skipped"))

  // The card disappears when the last step resolves, so acknowledge it. Only a checklist seen with an open
  // step can complete; one that loads already finished stays quiet.
  let sawOpen = false
  createEffect(() => {
    if (!admin() || preference.dismissed()) return
    if (steps().some((step) => step.state === "pending")) sawOpen = true
    if (finished() && sawOpen) {
      sawOpen = false
      showToast({ variant: "success", title: "Getting started complete" })
    }
  })

  /** The checklist shows to administrators until dismissed or every step has an outcome. */
  const visible = createMemo(() => admin() && !preference.dismissed() && !finished())

  return {
    admin,
    preference,
    dialog,
    catalog,
    /** Open the connection editor for a Provider directory entry. */
    manage,
    steps,
    step: (id: StepID) => steps().find((step) => step.id === id)?.state ?? "loading",
    complete,
    total: stepIDs.length,
    finished,
    visible,
    modelCount,
    sync,
  }
}

export type GettingStarted = ReturnType<typeof createGettingStarted>
