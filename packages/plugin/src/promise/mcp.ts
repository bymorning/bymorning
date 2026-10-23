import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface Server {
  readonly name: string
  readonly url?: string
  readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"
  readonly enabled: boolean
  readonly error?: string
  readonly integrationID?: string
}

export interface Editor {
  list(): readonly [string, DeepMutable<ConfigMCP.Remote>][]
  get(name: string): DeepMutable<ConfigMCP.Remote> | undefined
  set(name: string, config: ConfigMCP.Remote): void
  update(name: string, update: (config: DeepMutable<ConfigMCP.Remote>) => void): void
  remove(name: string): void
}

export interface MCPDomain {
  readonly list: () => Promise<readonly Server[]>
  readonly transform: Transform<Editor>
  readonly reload: () => Promise<void>
}
