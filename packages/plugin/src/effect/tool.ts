import { Tool } from "@bymorning/schema/tool"
export type { ElicitInput, ElicitResult } from "@bymorning/schema/tool"
import type { Agent } from "@bymorning/schema/agent"
import type { Session } from "@bymorning/schema/session"
import type { ID as MessageID } from "@bymorning/schema/message"
import type { Hooks, Transform } from "./registration.js"
import type { Effect, Types } from "effect"
import type { Domain as OpenAPI } from "./openapi.js"

export interface ToolEditor {
  readonly list: () => readonly (Tool.Info & { readonly id: string })[]
  readonly get: (id: string) => (Tool.Info & { readonly id: string }) | undefined
  readonly namespace: (value: Tool.Namespace) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
  add<Input extends Tool.ValueSchema<any>, Output extends Tool.ValueSchema<any> | undefined>(
    tool: Tool.Registration<Input, Output>,
  ): void
}

export interface ToolHooks {
  readonly "execute.before": {
    tool: string
    readonly sessionID: Session.ID
    readonly agent: Agent.ID
    readonly messageID: MessageID
    readonly id: Tool.CallID
    input: unknown
  }
  readonly "execute.after": {
    readonly tool: string
    readonly sessionID: Session.ID
    readonly agent: Agent.ID
    readonly messageID: MessageID
    readonly id: Tool.CallID
    readonly input: unknown
  } & (
    | {
        readonly status: "completed"
        result: Tool.Result
      }
    | {
        readonly status: "error"
        error: Tool.Error
      }
  )
}

// Only execute.before may fail: a Tool.Error rejects the call before the tool runs.
export interface ToolFailures extends Record<keyof ToolHooks, unknown> {
  readonly "execute.before": Tool.Error
  readonly "execute.after": never
}

export interface ToolDomain extends OpenAPI {
  readonly transform: Transform<ToolEditor>
  readonly reload: () => Effect.Effect<void>
  readonly hook: Hooks<ToolHooks, ToolFailures>
}
