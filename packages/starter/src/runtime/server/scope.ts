import type { ByMorningClient } from "@bymorning/client"
import type { WorkspaceID } from "@bymorning/client/solid"

/** The complete identity boundary for one authenticated workspace. */
export type ServerScope = {
  readonly origin: string
  readonly identity: number
  readonly workspace: WorkspaceID
  readonly api: ByMorningClient
}

export function createScope(input: ServerScope): ServerScope {
  return input
}
