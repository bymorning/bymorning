import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface Server {
  readonly name: string
  readonly url?: string
  readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"
  readonly enabled: boolean
  readonly error?: string
  readonly integrationID?: string
}

export interface Editor {
  list(): readonly [string, Types.DeepMutable<ConfigMCP.Remote>][]
  get(name: string): Types.DeepMutable<ConfigMCP.Remote> | undefined
  set(name: string, config: ConfigMCP.Remote): void
  update(name: string, update: (config: Types.DeepMutable<ConfigMCP.Remote>) => void): void
  remove(name: string): void
}

export interface MCPDomain {
  readonly list: () => Effect.Effect<readonly Server[]>
  readonly transform: Transform<Editor>
  readonly reload: () => Effect.Effect<void>
}
