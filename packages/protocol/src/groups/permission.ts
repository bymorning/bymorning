import * as Permission from "@bymorning/schema/permission"
import * as Session from "@bymorning/schema/session"
import * as User from "@bymorning/schema/user"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InputError, InternalError, PermissionNotFoundError, SessionNotFoundError } from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

/** Protocol-only body for creating a Session-owned Permission ask. */
export const CreateBody = Schema.Struct({
  id: Permission.AssertInput.fields.id,
  action: Permission.AssertInput.fields.action,
  resources: Permission.AssertInput.fields.resources,
  save: Permission.AssertInput.fields.save,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  source: Permission.AssertInput.fields.source,
  agent: Permission.AssertInput.fields.agent,
})

/** Protocol-only body for replying to a Permission ask. */
export const ReplyBody = Schema.Struct({
  reply: Permission.Reply,
  message: Permission.ReplyInput.fields.message,
})

/** JSON transport projection of one pending Permission request. */
export const Request = Schema.Struct({
  id: Permission.ID,
  sessionID: Session.ID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  save: Permission.Request.fields.save,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  source: Permission.Request.fields.source,
}).annotate({ identifier: "Permission.Request" })

export const ToolPermission = Schema.Struct({
  name: Schema.String,
  action: Schema.String,
  description: Schema.String,
  effect: Permission.Effect,
})

export const ToolPermissionUpdate = Schema.Struct({
  action: Schema.String,
  effect: Permission.Effect,
})

/** Tool Permission controls for either Workspace scope or one selected User. */
export const ToolPermissionPatch = Schema.Struct({
  user: Schema.optionalKey(User.ID),
  tools: Schema.Array(ToolPermissionUpdate),
})

/** Optional User scope for Tool Permission discovery. */
export const ToolPermissionQuery = Schema.Struct({
  workspace: WorkspaceQuery.fields.workspace,
  user: Schema.optionalKey(User.ID),
})

/** Authoritative pending and saved Permission HTTP contracts. */
export const makePermissionGroup = <
  WorkspaceId extends HttpApiMiddleware.AnyId,
  WorkspaceService,
  PersistedSessionId extends HttpApiMiddleware.AnyId,
  PersistedSessionService,
>(
  workspaceMiddleware: Context.Key<WorkspaceId, WorkspaceService>,
  persistedSessionMiddleware: Context.Key<PersistedSessionId, PersistedSessionService>,
) =>
  HttpApiGroup.make("api.permission")
    .add(
      HttpApiEndpoint.get("permission.request.list", "/permission/request", {
        query: WorkspaceQuery,
        success: Schema.Array(Request),
        error: [InputError, InternalError],
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.permission.request.list" })),
    )
    .add(
      HttpApiEndpoint.get("permission.saved.list", "/permission/saved", {
        query: WorkspaceQuery,
        success: Schema.Array(Permission.Saved),
        error: [InputError, InternalError],
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.permission.saved.list" })),
    )
    .add(
      HttpApiEndpoint.delete("permission.saved.remove", "/permission/saved/:savedID", {
        params: { savedID: Permission.SavedID },
        query: WorkspaceQuery,
        success: HttpApiSchema.NoContent,
        error: [InputError, InternalError],
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.permission.saved.remove" })),
    )
    .add(
      HttpApiEndpoint.get("permission.tools.list", "/permission/tool", {
        query: ToolPermissionQuery,
        success: Schema.Array(ToolPermission),
        error: [InputError, InternalError],
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.permission.tools.list" })),
    )
    .add(
      HttpApiEndpoint.put("permission.tools.update", "/permission/tool", {
        query: WorkspaceQuery,
        payload: ToolPermissionPatch,
        success: Schema.Array(ToolPermission),
        error: [InputError, InternalError],
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.permission.tools.update" })),
    )
    // Effect applies group middleware only to endpoints already added.
    .middleware(workspaceMiddleware)
    .add(
      HttpApiEndpoint.post("session.permission.create", "/session/:sessionID/permission", {
        params: { sessionID: Session.ID },
        payload: CreateBody,
        success: Permission.AskResult,
        error: [InputError, SessionNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.permission.create" })),
    )
    .add(
      HttpApiEndpoint.get("session.permission.list", "/session/:sessionID/permission", {
        params: { sessionID: Session.ID },
        success: Schema.Array(Request),
        error: [InputError, SessionNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.permission.list" })),
    )
    .add(
      HttpApiEndpoint.get("session.permission.get", "/session/:sessionID/permission/:requestID", {
        params: { sessionID: Session.ID, requestID: Permission.ID },
        success: Request,
        error: [InputError, SessionNotFoundError, PermissionNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.permission.get" })),
    )
    .add(
      HttpApiEndpoint.post("session.permission.reply", "/session/:sessionID/permission/:requestID/reply", {
        params: { sessionID: Session.ID, requestID: Permission.ID },
        payload: ReplyBody,
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, PermissionNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.permission.reply" })),
    )
    .prefix("/api")
