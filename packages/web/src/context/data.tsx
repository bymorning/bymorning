import type { ByMorningClient } from "@bymorning/client"
import type { Data as SharedData } from "@bymorning/client/solid"
import type * as Workspace from "@bymorning/schema/workspace"
import { createEffect, getOwner, on, onCleanup, runWithOwner } from "solid-js"
import { useQueryClient, type QueryClient } from "@tanstack/solid-query"
import { useScope, useServer } from "../runtime/server/runtime"
import { scopeKey, type ServerScope } from "../runtime/server/scope"
import type { ServerState } from "../runtime/server/sync"

import { createProjectDirectoryData } from "./data/project-directory"
import { createSessionData } from "./data/session"
import { createDataSync } from "./data/sync"
import { createWorkspaceCatalog } from "./data/workspace-catalog"
import { createGatewayData } from "./data/gateway"
import { createWorkspaceLists } from "./data/workspace-lists"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useWorkspace } from "./workspace"
import { useOptionalWorkspaceEvent, type WorkspaceEvent } from "./workspace-event"

export type { DataState } from "./data/state"
export type { QueryState } from "./data/query"

export type CreateDataInput = {
  readonly api: () => ByMorningClient
  readonly workspace: Workspace.ID
  readonly event?: WorkspaceEvent.Interface
  readonly directory: { readonly scope: ServerScope; readonly query: QueryClient; readonly ready: () => boolean }
  readonly shared: SharedData
  readonly key: readonly unknown[]
  readonly sharedState?: () => ServerState
}

export function createData(config: CreateDataInput) {
  const owner = getOwner()
  let directory: ReturnType<typeof createProjectDirectoryData> | undefined
  const client = config.api()
  const events = config.event
  const resourceController = new AbortController()
  const resource = { signal: resourceController.signal }
  const sync = createDataSync()
  const result = {
    workspace: {
      ...createWorkspaceCatalog({
        client,
        workspace: config.workspace,
        resource,
        sync,
        shared: config.shared,
        ...(config.sharedState ? { sharedState: config.sharedState } : {}),
      }),
      ...createWorkspaceLists({
        client,
        workspace: config.workspace,
        resource,
        sync,
      }),
    },
    shared: config.shared,
    get projectDirectory() {
      // Construct only when files are used, with the subscription bound to Data's
      // owner rather than the first file consumer's shorter lifetime.
      directory ??= runWithOwner(owner, () => createProjectDirectoryData(config.directory))
      if (!directory) throw new Error("Project Directory initialization failed")
      return directory
    },
    session: createSessionData({
      client,
      workspace: config.workspace,
      resource,
      shared: config.shared,
      ...(config.sharedState ? { sharedState: config.sharedState } : {}),
    }),
    gateway: createGatewayData({ client, workspace: config.workspace, resource }),
  }

  if (events) {
    void (async () => {
      for await (const event of events.subscribe(resource)) {
        if (event.type === "agent.created" || event.type === "agent.updated" || event.type === "agent.deleted") {
          result.workspace.agent.invalidate()
          void result.workspace.agent.sync().catch(() => undefined)
          continue
        }
        if (event.type === "plugin.added" || event.type === "plugin.updated") {
          result.workspace.agent.invalidate()
          result.workspace.model.invalidate()
          result.workspace.skill.invalidate()
          void Promise.all([
            result.workspace.agent.sync(),
            result.workspace.model.sync(),
            result.workspace.skill.sync(),
          ]).catch(() => undefined)
          continue
        }
        // Integration events refresh the provider directory owned by provider
        // features; Data only refreshes shared models through config updates.
        if (event.type === "config.updated") {
          // A catalog read can discover and publish configuration changes before its
          // response settles. That response already contains the change, so feeding
          // the event back into the active read would create an unbounded read loop.
          if (result.workspace.model.state().state === "loading" || result.workspace.model.covers(event.created))
            continue
          result.workspace.model.invalidate()
          void result.workspace.model.sync().catch(() => undefined)
          continue
        }
        if (event.type === "scheduledTask.updated" || event.type === "scheduledTask.deleted") {
          // Only refresh the catalog when a consumer has already loaded it.
          if (result.workspace.scheduledTask.state().state === "idle") continue
          result.workspace.scheduledTask.invalidate()
          void result.workspace.scheduledTask.sync().catch(() => undefined)
          continue
        }
        if (event.type === "mcp.status.changed") {
          // Only refresh catalogs a consumer has already loaded; idle entries would fetch unprompted.
          const loaded = [result.workspace.mcpServer, result.workspace.mcpTool].filter(
            (catalog) => catalog.state().state !== "idle",
          )
          for (const catalog of loaded) catalog.invalidate()
          void Promise.all(loaded.map((catalog) => catalog.sync())).catch(() => undefined)
          continue
        }
        if (event.type === "project.file.changed") {
          // Without a constructed directory nothing is cached, so there is nothing to refresh.
          void directory?.apply(event).catch(() => undefined)
        }
      }
    })().catch(() => undefined)

    createEffect(
      on(events.status, (status) => {
        if (status === "connected") return
        sync.invalidate()
      }),
    )
  }
  onCleanup(() => resourceController.abort())

  return result
}

export type Data = ReturnType<typeof createData>

function createContextData(input: { readonly directory?: CreateDataInput["directory"] }) {
  const { client } = useSDK()
  const event = useOptionalWorkspaceEvent()
  return createData({
    api: () => client,
    workspace: useWorkspace().current().id,
    get directory() {
      return input.directory ?? { scope: useScope(), query: useQueryClient(), ready: useServer().queryReady }
    },
    shared: useServer().data,
    key: scopeKey(useServer().scope),
    sharedState: useServer().bootstrapState,
    ...(event ? { event } : {}),
  })
}

export const { provider: DataProvider, use: useData } = createSimpleContext({ name: "Data", init: createContextData })
