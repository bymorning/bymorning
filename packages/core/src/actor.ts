export * as Actor from "./actor.js"

export {
  AccountActor,
  Caller,
  Info,
  ServiceAccountActor,
  SystemActor,
  UserActor,
  WorkspaceActor,
} from "@bymorning/schema/actor"

export * as Binding from "./actor/binding.js"

import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import type { Array as Arr } from "effect"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { OAuth } from "./oauth.js"
import { ServiceAccount } from "./service-account.js"
import type { Info as ActorInfo } from "@bymorning/schema/actor"
import { ServiceAccountActor, UserActor } from "@bymorning/schema/actor"
import { Holder } from "@bymorning/schema/budget"
import type { ServiceAccount as ServiceAccountSchema } from "@bymorning/schema/service-account"
import type { User } from "@bymorning/schema/user"
import type { Workspace } from "@bymorning/schema/workspace"

/** Canonical construction-time member identity declaration. */
export { node as binding } from "./actor/binding.js"

/** Budget Holder keys for each identity kind. Budget never interprets them; only this module composes them. */
export const holder = {
  workspace: (workspaceID: Workspace.ID): Holder => Holder.make(`workspace:${workspaceID}`),
  user: (workspaceID: Workspace.ID, userID: User.ID): Holder => Holder.make(`user:${workspaceID}:${userID}`),
  serviceAccount: (workspaceID: Workspace.ID, serviceAccountID: ServiceAccountSchema.ID): Holder =>
    Holder.make(`service-account:${workspaceID}:${serviceAccountID}`),
} as const

/** Budget Holders one Actor implies, Workspace first so the widest exhausted Spend Limit is the one reported. */
export const holders = (actor: ActorInfo): Arr.NonEmptyReadonlyArray<Holder> => {
  const workspace = holder.workspace(actor.properties.workspaceID)
  switch (actor.type) {
    case "user":
      return [workspace, holder.user(actor.properties.workspaceID, actor.properties.userID)]
    case "service_account":
      return [workspace, holder.serviceAccount(actor.properties.workspaceID, actor.properties.serviceAccountID)]
    case "workspace":
    case "system":
      return [workspace]
  }
}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()("Actor.UnauthorizedError", {}) {}

export { ForbiddenError } from "./actor/binding.js"
import { ForbiddenError } from "./actor/binding.js"

/**
 * The Workspace administrator authorization rule for one Core operation: a User
 * Actor needs the admin Role; System and Workspace Actors are ByMorning itself
 * and pass; a Service Account Actor is never a Workspace administrator.
 */
export const requireAdmin = (
  actor: ActorInfo,
  message = "Workspace administrator required",
): Effect.Effect<void, ForbiddenError> =>
  actor.type === "system" ||
  actor.type === "workspace" ||
  (actor.type === "user" && actor.properties.role === "admin")
    ? Effect.void
    : Effect.fail(new ForbiddenError({ message }))

/** Resolves a Token into the complete caller Actor. */
export interface Interface {
  readonly resolve: (
    token: Redacted.Redacted<string> | undefined,
  ) => Effect.Effect<import("@bymorning/schema/actor").Caller, UnauthorizedError>
}

/** Token-to-caller resolution authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Actor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const oauth = yield* OAuth.Service
    const serviceAccounts = yield* ServiceAccount.Service
    return Service.of({
      resolve: Effect.fn("Actor.resolve")(function* (token) {
        if (token === undefined) return yield* new UnauthorizedError()
        const value = Redacted.value(token)
        if (value.startsWith("bm_")) {
          const verified = yield* serviceAccounts.key.verify(value)
          if (verified === undefined) return yield* new UnauthorizedError()
          return new ServiceAccountActor({
            type: "service_account",
            properties: {
              workspaceID: verified.workspaceID,
              serviceAccountID: verified.account.id,
              keyID: verified.keyID,
            },
          })
        }
        const authority = yield* oauth.resolveAccess(value)
        if (authority === undefined) return yield* new UnauthorizedError()
        return new UserActor({ type: "user", properties: authority })
      }),
    })
  }),
)

/** Canonical Actor node. */
export const node = makeGlobalNode({ service: Service, layer, deps: [OAuth.node, ServiceAccount.node] })
