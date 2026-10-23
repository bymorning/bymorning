import { Tool } from "@bymorning/schema/tool"
import type { User } from "@bymorning/schema/user"
import type { Registration } from "./registration.js"
import type { GatewayRequest } from "../gateway-hooks.js"
import type { HookResult, GatewayHook as InvocationHook } from "./model.js"

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

export type GatewayToolExecuteBefore = GatewayHooks["tool.execute.before"]
export type GatewayToolExecuteAfter = GatewayHooks["tool.execute.after"]
export type GatewayToolBeforeResult = Tool.Error | void

export interface GatewayHook {
  (
    name: "model.request",
    callback: (input: GatewayRequest) => HookResult | Promise<HookResult>,
  ): Promise<Registration>
  (
    name: "tool.execute.before",
    callback: (input: GatewayToolExecuteBefore) => GatewayToolBeforeResult | Promise<GatewayToolBeforeResult>,
  ): Promise<Registration>
  (
    name: "tool.execute.after",
    callback: (input: GatewayToolExecuteAfter) => void | Promise<void>,
  ): Promise<Registration>
}

export interface GatewayDomain {
  readonly hook: GatewayHook & InvocationHook
}
