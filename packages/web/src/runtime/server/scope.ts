import type { ByMorningClient } from "@bymorning/client"
import type { WorkspaceID } from "@bymorning/client/solid"

export interface ServerScope {
  readonly origin: string
  readonly identity: string
  readonly workspace: WorkspaceID
  readonly api: ByMorningClient
}

export const scopeKey = (scope: ServerScope) => [scope.origin, scope.identity, scope.workspace] as const
