import type {
  ByMorningClient,
  ServiceAccountGetOutput,
  ServiceAccountKeyListOutput,
  ToolUsageListOutput,
  UsageLeaderboardOutput,
  UsageOverviewInput,
  UsageOverviewOutput,
  UsageRecordsOutput,
} from "@bymorning/client"
import type * as ServiceAccount from "@bymorning/schema/service-account"
import type * as Workspace from "@bymorning/schema/workspace"

import { createWorkspaceQuery } from "./query"

type UsageDays = UsageOverviewInput["days"]

/**
 * Parameterised workspace reads for the gateway routes, keyed by their non-workspace arguments so
 * pages (cursor) and ranges (days) each hold their own entry.
 */
export function createGatewayData(config: {
  readonly client: ByMorningClient
  readonly workspace: Workspace.ID
  readonly resource: { readonly signal: AbortSignal }
}) {
  const workspace = () => config.workspace
  return {
    usage: createWorkspaceQuery<{ days: UsageDays }, UsageOverviewOutput>({
      workspace,
      resource: config.resource,
      key: (args) => `${args.days}`,
      fetch: (workspaceID, args, resource) =>
        config.client.usage.overview({ workspace: workspaceID, days: args.days }, resource),
    }),
    records: createWorkspaceQuery<{ cursor?: string | undefined; limit: number }, UsageRecordsOutput>({
      workspace,
      resource: config.resource,
      key: (args) => args.cursor ?? "head",
      fetch: (workspaceID, args, resource) =>
        config.client.usage.records(
          { workspace: workspaceID, limit: args.limit, ...(args.cursor === undefined ? {} : { cursor: args.cursor }) },
          resource,
        ),
    }),
    leaderboard: createWorkspaceQuery<{ days: UsageDays }, UsageLeaderboardOutput>({
      workspace,
      resource: config.resource,
      key: (args) => `${args.days}`,
      fetch: (workspaceID, args, resource) =>
        config.client.usage.leaderboard({ workspace: workspaceID, days: args.days }, resource),
    }),
    serviceAccount: createWorkspaceQuery<{ id: ServiceAccount.ID }, ServiceAccountGetOutput>({
      workspace,
      resource: config.resource,
      key: (args) => args.id,
      fetch: (workspaceID, args, resource) =>
        config.client.serviceAccount.get({ workspace: workspaceID, id: args.id }, resource),
    }),
    serviceAccountKeys: createWorkspaceQuery<{ id: ServiceAccount.ID }, ServiceAccountKeyListOutput>({
      workspace,
      resource: config.resource,
      key: (args) => args.id,
      fetch: (workspaceID, args, resource) =>
        config.client.serviceAccount.key.list({ workspace: workspaceID, id: args.id }, resource),
    }),
    toolUsage: createWorkspaceQuery<{ cursor?: string | undefined; limit: number }, ToolUsageListOutput>({
      workspace,
      resource: config.resource,
      key: (args) => args.cursor ?? "head",
      fetch: (workspaceID, args, resource) =>
        config.client.tool.usage.list(
          { workspace: workspaceID, limit: args.limit, ...(args.cursor === undefined ? {} : { cursor: args.cursor }) },
          resource,
        ),
    }),
  }
}

export type GatewayData = ReturnType<typeof createGatewayData>
