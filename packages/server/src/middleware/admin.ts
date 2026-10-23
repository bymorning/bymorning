import { ForbiddenError } from "@bymorning/protocol/errors"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { Effect } from "effect"

/** Require an authenticated Workspace administrator before invoking an operation. */
export const requireAdmin = Effect.gen(function* () {
  const actor = yield* CurrentActor
  if (actor.type !== "user" || actor.properties.role !== "admin") {
    return yield* new ForbiddenError({ message: "Workspace administrator required" })
  }
  return actor
})

/**
 * Present a Core admin-authority refusal (`Actor.ForbiddenError`) as the
 * protocol's 403. Handlers gate with `requireAdmin` first, so this is the
 * defense-in-depth mapping for the domain seam's own refusal.
 */
export const forbidden = (error: { readonly message: string }) =>
  Effect.fail(new ForbiddenError({ message: error.message }))
