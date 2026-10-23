import * as User from "@bymorning/schema/user"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { ForbiddenError, InputError, InternalError, ServiceUnavailableError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Workspace-authenticated membership discovery contracts. */
export const UserGroup = HttpApiGroup.make("api.user")
  .add(
    HttpApiEndpoint.get("user.list", "/users", {
      query: WorkspaceQuery,
      success: User.MemberList,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("user.invite", "/users", {
      query: WorkspaceQuery,
      payload: User.InviteInput,
      success: User.Member,
      error: [ForbiddenError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("user.remove", "/users/:userID", {
      params: { userID: User.ID },
      query: WorkspaceQuery,
      success: Schema.Void.pipe(HttpApiSchema.status(204)),
      error: [ForbiddenError, InputError, ServiceUnavailableError, InternalError],
    }),
  )
  .prefix("/api")
