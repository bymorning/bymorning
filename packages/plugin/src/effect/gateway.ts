import type { Tool } from "@bymorning/schema/tool"
import type { User } from "@bymorning/schema/user"
import type { Hooks } from "./registration.js"
import type { GatewayRequest } from "../gateway-hooks.js"
import type { ModelError } from "@bymorning/schema/plugin-model"
import type { GatewayHook } from "./model.js"

export interface GatewayHooks {
  readonly "model.request": GatewayRequest
  readonly "tool.execute.before": {
    readonly id: Tool.CallID
    readonly userID: User.ID
    readonly tool: string
    input: unknown
  }
  readonly "tool.execute.after": {
    readonly id: Tool.CallID
    readonly userID: User.ID
    readonly tool: string
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

// Only tool.execute.before may fail: a Tool.Error rejects the call before the tool runs.
export interface GatewayFailures extends Record<keyof GatewayHooks, unknown> {
  readonly "model.request": ModelError
  readonly "tool.execute.before": Tool.Error
  readonly "tool.execute.after": never
}

export type GatewayToolExecuteBefore = GatewayHooks["tool.execute.before"]
export type GatewayToolExecuteAfter = GatewayHooks["tool.execute.after"]

export interface GatewayDomain {
  readonly hook: Hooks<GatewayHooks, GatewayFailures> & GatewayHook
}
