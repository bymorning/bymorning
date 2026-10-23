export * as Binding from "./binding.js"

import type { Account } from "@bymorning/schema/account"
import { UserActor } from "@bymorning/schema/actor"
import { User } from "@bymorning/schema/user"
import type { Workspace } from "@bymorning/schema/workspace"
import { tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Context, Effect, Option, Schema } from "effect"

/**
 * Verified member identity supplied while constructing one retained member graph.
 * The Role is the membership's Role at construction; `WorkspaceMap` retires the
 * retained graph when the Role changes, and every edge supplies the Role it
 * freshly resolved.
 */
export interface Value {
  readonly workspaceID: Workspace.ID
  readonly accountID: Account.ID
  readonly userID: User.ID
  readonly role: User.Role
}

/** Construction input; it is bound by WorkspaceMap and is not a request context. */
export class Service extends Context.Service<Service, Value>()("@bymorning/core/Actor.Binding") {}

/** Canonical member binding declaration. */
export const node = LayerNode.unbound(Service, tags.values.workspace)

/** A Workspace-administrator-only mutation was attempted without the admin Role. */
export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()("Actor.ForbiddenError", {
  message: Schema.String,
}) {}

/** The bound member as the User Actor it was verified from. */
export const actor = (value: Value) => new UserActor({ type: "user", properties: value })

/**
 * Fail unless the bound member is a Workspace administrator. A caller-less
 * construction (no Binding) is an internal system context and is trusted: every
 * model-driven edge acquires its graph through WorkspaceMap, which always binds
 * a verified member.
 */
export const requireAdmin = (
  binding: Option.Option<Value>,
  message = "Workspace administrator required",
): Effect.Effect<void, ForbiddenError> =>
  Option.isNone(binding) || binding.value.role === "admin" ? Effect.void : Effect.fail(new ForbiddenError({ message }))
