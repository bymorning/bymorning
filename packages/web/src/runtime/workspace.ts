import type { ByMorningClient } from "@bymorning/client"
import { queryOptions } from "@tanstack/solid-query"
import { queryPolicy } from "./server/query"

export const workspaceQuery = (scope: {
  readonly origin: string
  readonly identity: string
  readonly api: ByMorningClient
}) =>
  queryOptions({
    ...queryPolicy,
    queryKey: [scope.origin, scope.identity, "workspace"] as const,
    queryFn: ({ signal }) => scope.api.workspace.list({ signal }),
  })
