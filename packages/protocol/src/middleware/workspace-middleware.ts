import type { Actor } from "@bymorning/schema/actor"
import * as Workspace from "@bymorning/schema/workspace"
import { Context, Schema } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from "../errors.js"

/** Workspace authority selected for the current browser request. */
export class CurrentActor extends Context.Service<CurrentActor, Actor.Caller>()("@bymorning/protocol/CurrentActor") {}

/** Shared optional Workspace selector for browser control-plane requests. */
export const WorkspaceQuery = Schema.Struct({
  workspace: Schema.optionalKey(Workspace.ID),
})

/** Portable Workspace selection and runtime-binding contract. */
export class WorkspaceMiddleware extends HttpApiMiddleware.Service<
  WorkspaceMiddleware,
  {
    provides: CurrentActor
    requires: import("./account-middleware.js").CurrentAccount
  }
>()("@bymorning/protocol/WorkspaceMiddleware", {
  error: [UnauthorizedError, ForbiddenError, ServiceUnavailableError],
}) {}
