import type { ApiConfigGetOutput, ByMorningClient } from "@bymorning/client"
import type * as Workspace from "@bymorning/schema/workspace"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

import { showToast } from "../ui/components/toast"
import { errorMessage } from "../utils/error-message"
import type { RoutingRule } from "./rule-dialog"

export type ConfigClient = ByMorningClient["api.config"]

interface State {
  readonly phase: "loading" | "ready" | "error"
  readonly config: ApiConfigGetOutput | undefined
  readonly loadError: string | undefined
  readonly pending: boolean
}

function replaceRouting(current: ApiConfigGetOutput, routing: ReadonlyArray<RoutingRule>) {
  const { default_model: _defaultModel, model_policy: _modelPolicy, ...writable } = current
  return { ...writable, routing: [...routing] }
}

const none: ReadonlyArray<RoutingRule> = []

/**
 * Workspace routing rules with read-modify-write persistence. Every change re-reads the current
 * Config first, so a change is computed against the latest rules rather than a stale page.
 */
export function createRoutingStore(input: { readonly client: ConfigClient; readonly workspaceID: Workspace.ID }) {
  const [state, setState] = createStore<State>({ phase: "loading", config: undefined, loadError: undefined, pending: false })
  let disposed = false
  let generation = 0
  onCleanup(() => {
    disposed = true
  })

  const refresh = async () => {
    if (state.pending) return
    const id = ++generation
    setState({ phase: "loading", loadError: undefined })
    try {
      const config = await input.client.get({ workspace: input.workspaceID })
      if (!disposed && id === generation) setState({ phase: "ready", config })
    } catch (cause) {
      if (disposed || id !== generation) return
      const message = errorMessage(cause, "Could not load routes.")
      setState({ phase: "error", loadError: message })
      showToast({ variant: "error", title: message })
    }
  }

  const persist = async (change: (current: ReadonlyArray<RoutingRule>) => ReadonlyArray<RoutingRule>) => {
    if (state.pending) throw new Error("Another routing change is already in progress.")
    const id = ++generation
    setState({ pending: true })
    try {
      const current = await input.client.get({ workspace: input.workspaceID })
      if (!disposed && id === generation) setState({ phase: "ready", config: current })
      const next = change(current.routing ?? none)
      const updated = await input.client.update({
        workspace: input.workspaceID,
        ...replaceRouting(current, next),
      } as Parameters<ConfigClient["update"]>[0])
      if (!disposed && id === generation) setState({ phase: "ready", config: updated })
      return updated
    } finally {
      if (!disposed && id === generation) setState({ pending: false })
    }
  }

  return {
    state,
    rules: () => state.config?.routing ?? none,
    refresh,
    persist,
    disposed: () => disposed,
  }
}
