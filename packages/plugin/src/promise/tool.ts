export { CallID, Error } from "@bymorning/schema/tool"
export type { ElicitInput, ElicitResult, Metadata, Options, Result } from "@bymorning/schema/tool"

import { Tool } from "@bymorning/schema/tool"
import type { Agent } from "@bymorning/schema/agent"
import type { Session } from "@bymorning/schema/session"
import type { ID as MessageID } from "@bymorning/schema/message"
import type { Registration, Transform } from "./registration.js"
import type { Types } from "effect"
import type { Domain as OpenAPI } from "./openapi.js"

export interface ToolContext extends Omit<Tool.Context, "progress" | "permission"> {
  readonly progress: (update: Tool.Metadata) => Promise<void>
  readonly permission: (request: Parameters<Tool.Context["permission"]>[0]) => Promise<void>
}

type BaseInfo<
  Input extends Tool.ValueSchema<any> = Tool.ValueSchema<any>,
  Output extends Tool.ValueSchema<any> | undefined = Tool.ValueSchema<any> | undefined,
> = Omit<Tool.Info<Input, Output>, "execute"> & {
  readonly execute: (
    input: Parameters<Tool.Info<Input, Output>["execute"]>[0],
    context: ToolContext,
  ) => Promise<Tool.Result<Output>>
  readonly implementation?: never
}

export type Info<
  Input extends Tool.ValueSchema<any> = Tool.ValueSchema<any>,
  Output extends Tool.ValueSchema<any> | undefined = Tool.ValueSchema<any> | undefined,
> = BaseInfo<Input, Output> | Tool.SandboxRegistration<Input, Output>

export interface ToolEditor {
  readonly list: () => readonly (BaseInfo & { readonly id: string })[]
  readonly get: (id: string) => (BaseInfo & { readonly id: string }) | undefined
  readonly namespace: (value: Tool.Namespace) => void
  readonly update: (id: string, update: (tool: Types.Mutable<BaseInfo>) => void) => void
  readonly remove: (id: string) => void
  add<Input extends Tool.ValueSchema<any>, Output extends Tool.ValueSchema<any> | undefined>(
    tool: Info<Input, Output>,
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

export type ToolExecuteBefore = ToolHooks["execute.before"]
export type ToolExecuteAfter = ToolHooks["execute.after"]
export type ToolBeforeResult = Tool.Error | void

export interface ToolHook {
  (
    name: "execute.before",
    callback: (input: ToolExecuteBefore) => ToolBeforeResult | Promise<ToolBeforeResult>,
  ): Promise<Registration>
  (name: "execute.after", callback: (input: ToolExecuteAfter) => void | Promise<void>): Promise<Registration>
}

export interface ToolDomain extends OpenAPI {
  readonly transform: Transform<ToolEditor>
  readonly reload: () => Promise<void>
  readonly hook: ToolHook
}
