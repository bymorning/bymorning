export * as Runtime from "./runtime.js"

import type { Actor } from "@bymorning/schema/actor"
import { Context } from "effect"
import type { Effect, Scope } from "effect"
import type { UnavailableError } from "./failure.js"
import type { Member } from "./member.js"

export interface Interface {
  /** Acquire the retained member runtime for one authenticated caller. */
  readonly acquire: (
    actor: Extract<Actor.Caller, { readonly type: "user" }>,
  ) => Effect.Effect<Member.Interface, UnavailableError, Scope.Scope>
}

/** Host binding seam for retained member runtimes. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/gateway/ToolGateway.Runtime") {}
