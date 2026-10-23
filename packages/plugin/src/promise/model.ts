import type { GatewayInput, ModelError, SessionInput } from "@bymorning/schema/plugin-model"
import type { Tokens } from "@bymorning/schema/usage"
import type { Registration } from "./registration.js"

/** Expected result of an inference hook. */
export type HookResult = void | ModelError

/** Registration capabilities valid only while the invocation callback is running. */
export interface ModelScope {
  readonly signal: AbortSignal
  readonly onUsage: (callback: (tokens: Tokens) => HookResult | Promise<HookResult>) => void
  readonly onClose: (callback: () => void | Promise<void>) => void
}

/** Session admission facts and invocation lifetime. */
export type SessionInvocation = SessionInput & ModelScope
/** Gateway admission facts and invocation lifetime. */
export type GatewayInvocation = GatewayInput & ModelScope

/** Register Session admission on the activation lifetime. */
export type SessionHook = (
  name: "model.invoke",
  callback: (input: SessionInvocation) => HookResult | Promise<HookResult>,
) => Promise<Registration>

/** Register Gateway admission on the activation lifetime. */
export type GatewayHook = (
  name: "model.invoke",
  callback: (input: GatewayInvocation) => HookResult | Promise<HookResult>,
) => Promise<Registration>
