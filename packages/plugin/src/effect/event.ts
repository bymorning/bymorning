import type { WorkspaceEventItem } from "@bymorning/client"
import type { Scope, Stream } from "effect"

/** Plugin-local live Event whitelist; unlike HTTP it has no connection marker. */
export interface EventDomain {
  readonly subscribe: () => Stream.Stream<Extract<WorkspaceEventItem, { type: "agent.created" | "agent.updated" | "plugin.added" | "plugin.updated" | "integration.updated" | "integration.connection.updated" | "config.updated" }>, never, Scope.Scope>
}
