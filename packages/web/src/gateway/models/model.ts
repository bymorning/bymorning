import type { ModelCreateInput, ModelInfo, ModelUpdateInput } from "@bymorning/client"
import { onCleanup } from "solid-js"

import { useData } from "../../context/data"
import { useOptionalWorkspaceEvent } from "../../context/workspace-event"
import { createProviderCatalog, watchProviderDirectory } from "../../integration/providers/model"
import { useServer } from "../../runtime/server/runtime"

/**
 * Feature model for the AI Gateway Models route. Rows and sync state stay on
 * `workspace.model` (Data owns models); the feature adds the feature-local
 * Provider directory, its Integration-driven refresh, and the model enable
 * toggle as a native mutation with `retry: false`.
 */
export function createGatewayModels() {
  const server = useServer()
  const data = useData()
  const events = useOptionalWorkspaceEvent()
  const resource = new AbortController()
  onCleanup(() => resource.abort())
  const catalog = createProviderCatalog({
    api: server.scope.api,
    workspace: server.scope.workspace,
    signal: resource.signal,
  })
  if (events) {
    watchProviderDirectory({ events, signal: resource.signal, catalog, model: data.workspace.model })
  }
  // Reconciles with server authority after a write, whether or not it succeeded, rather than
  // trusting or replaying the write itself.
  const reconcile = async (write: () => Promise<unknown>) => {
    try {
      await write()
      data.workspace.model.invalidate()
      await data.workspace.model.sync()
    } catch (cause) {
      data.workspace.model.invalidate()
      await data.workspace.model.sync().catch(() => undefined)
      throw cause
    }
  }
  const toggle = (input: { readonly provider: ModelInfo["provider"]; readonly id: string; readonly enabled: boolean }) =>
    reconcile(() =>
      server.scope.api.model.toggle({ workspace: server.scope.workspace, ...input }, { signal: resource.signal }),
    )
  const setDefault = (input: { readonly provider: ModelInfo["provider"]; readonly id: string }) =>
    reconcile(() =>
      server.scope.api.model.default({ workspace: server.scope.workspace, ...input }, { signal: resource.signal }),
    )
  type Custom = Omit<ModelUpdateInput, "workspace">
  const create = (input: Omit<ModelCreateInput, "workspace">) =>
    reconcile(() =>
      server.scope.api.model.create({ workspace: server.scope.workspace, ...input }, { signal: resource.signal }),
    )
  const update = (input: Custom) =>
    reconcile(() =>
      server.scope.api.model.update({ workspace: server.scope.workspace, ...input }, { signal: resource.signal }),
    )
  const remove = (input: { readonly provider: ModelInfo["provider"]; readonly id: string }) =>
    reconcile(() =>
      server.scope.api.model.delete({ workspace: server.scope.workspace, ...input }, { signal: resource.signal }),
    )
  return {
    catalog,
    rows: data.workspace.model.rows,
    state: () => data.workspace.model.state(),
    sync: () => Promise.all([data.workspace.model.sync(), catalog.sync()]).then(() => undefined),
    toggle,
    setDefault,
    create,
    update,
    remove,
  }
}

export type GatewayModels = ReturnType<typeof createGatewayModels>
