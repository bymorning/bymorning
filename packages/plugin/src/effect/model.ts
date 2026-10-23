import type { GatewayInput, ModelError, SessionInput } from "@bymorning/schema/plugin-model"
import type { Tokens } from "@bymorning/schema/usage"
import type { Effect, Scope } from "effect"
import type { Registration } from "./registration.js"

/** Registration capabilities valid only while the invocation callback is running. */
export interface ModelScope {
  readonly onUsage: (callback: (tokens: Tokens) => Effect.Effect<void, ModelError>) => void
  readonly onClose: (finalizer: Effect.Effect<void>) => void
}

/** Session admission facts; the callback receives the invocation Scope. */
export type SessionInvocation = SessionInput & ModelScope
/** Gateway admission facts; the callback receives the invocation Scope. */
export type GatewayInvocation = GatewayInput & ModelScope

/** Register Session admission in the activation Scope. */
export type SessionHook = (
  name: "model.invoke",
  callback: (input: SessionInvocation) => Effect.Effect<void, ModelError, Scope.Scope>,
) => Effect.Effect<Registration, never, Scope.Scope>

/** Register Gateway admission in the activation Scope. */
export type GatewayHook = (
  name: "model.invoke",
  callback: (input: GatewayInvocation) => Effect.Effect<void, ModelError, Scope.Scope>,
) => Effect.Effect<Registration, never, Scope.Scope>
