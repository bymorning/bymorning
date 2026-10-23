import type { WorkspaceEventItem } from "@bymorning/client"

/** Plugin-local live Event whitelist; unlike HTTP it has no connection marker. */
export interface EventDomain {
  readonly subscribe: () => AsyncIterable<Extract<WorkspaceEventItem, { type: "agent.created" | "agent.updated" | "plugin.added" | "plugin.updated" | "integration.updated" | "integration.connection.updated" | "config.updated" }>>
}
