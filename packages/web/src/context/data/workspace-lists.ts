import type { ByMorningClient } from "@bymorning/client"
import type * as Workspace from "@bymorning/schema/workspace"

import { createWorkspaceListCatalog } from "./list-catalog"
import type { DataSync } from "./sync"

/**
 * Workspace-lifetime list catalogs for the gateway and administration routes. Each entry follows
 * the `createWorkspaceCatalog` slice interface (`list`/`state`/`sync`/`invalidate`); none of them
 * participate in the aggregate workspace sync so existing consumers stay on their request budget.
 */
export function createWorkspaceLists(config: {
  readonly client: ByMorningClient
  readonly workspace: Workspace.ID
  readonly resource: { readonly signal: AbortSignal }
  readonly sync: DataSync
}) {
  const catalog = {
    workspace: config.workspace,
    resource: config.resource,
    sync: config.sync,
  }
  return {
    serviceAccount: createWorkspaceListCatalog({
      ...catalog,
      name: "serviceAccount",
      fetch: (workspace, resource) => config.client.serviceAccount.list({ workspace }, resource),
    }),
    budget: createWorkspaceListCatalog({
      ...catalog,
      name: "budget",
      fetch: (workspace, resource) => config.client.budget.status({ workspace }, resource),
    }),
    mcpServer: createWorkspaceListCatalog({
      ...catalog,
      name: "mcpServer",
      fetch: (workspace, resource) => config.client.mcp.servers.list({ workspace }, resource),
    }),
    mcpTool: createWorkspaceListCatalog({
      ...catalog,
      name: "mcpTool",
      fetch: (workspace, resource) => config.client.mcp.tools.list({ workspace }, resource),
    }),
    member: createWorkspaceListCatalog({
      ...catalog,
      name: "member",
      fetch: (workspace, resource) => config.client.user.list({ workspace }, resource),
    }),
    scheduledTask: createWorkspaceListCatalog({
      ...catalog,
      name: "scheduledTask",
      fetch: (workspace, resource) => config.client.scheduledTask.list({ workspace }, resource),
    }),
  }
}

export type WorkspaceLists = ReturnType<typeof createWorkspaceLists>
