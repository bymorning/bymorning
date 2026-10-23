import * as Form from "@bymorning/schema/form"
import * as Session from "@bymorning/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  FormAlreadyExistsError,
  FormAlreadySettledError,
  FormInvalidAnswerError,
  FormNotFoundError,
  InputError,
  InternalError,
  SessionNotFoundError,
} from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

export const CreateBody = Schema.Struct({
  id: Schema.optionalKey(Form.ID),
  title: Form.Info.fields.title,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  fields: Form.Fields,
})
export const ReplyBody = Form.Reply

export const makeFormGroup = <
  WorkspaceId extends HttpApiMiddleware.AnyId,
  WorkspaceService,
  PersistedSessionId extends HttpApiMiddleware.AnyId,
  PersistedSessionService,
>(
  workspaceMiddleware: Context.Key<WorkspaceId, WorkspaceService>,
  persistedSessionMiddleware: Context.Key<PersistedSessionId, PersistedSessionService>,
) =>
  HttpApiGroup.make("api.form")
    .add(
      HttpApiEndpoint.get("form.request.list", "/form/request", {
        query: WorkspaceQuery,
        success: Schema.Array(Form.Info),
        error: [InputError, InternalError],
      }).annotateMerge(OpenApi.annotations({ identifier: "v2.form.request.list" })),
    )
    .middleware(workspaceMiddleware)
    .add(
      HttpApiEndpoint.get("form.caller.list", "/form", {
        query: WorkspaceQuery,
        success: Schema.Array(Form.Info),
        error: [InternalError],
      }).middleware(workspaceMiddleware).annotateMerge(OpenApi.annotations({ identifier: "v2.form.caller.list" })),
    )
    .add(
      HttpApiEndpoint.get("form.caller.get", "/form/:formID", {
        params: { formID: Form.ID },
        query: WorkspaceQuery,
        success: Form.Info,
        error: [FormNotFoundError, InternalError],
      }).middleware(workspaceMiddleware).annotateMerge(OpenApi.annotations({ identifier: "v2.form.caller.get" })),
    )
    .add(
      HttpApiEndpoint.get("form.caller.state", "/form/:formID/state", {
        params: { formID: Form.ID },
        query: WorkspaceQuery,
        success: Form.State,
        error: [FormNotFoundError, InternalError],
      }).middleware(workspaceMiddleware).annotateMerge(OpenApi.annotations({ identifier: "v2.form.caller.state" })),
    )
    .add(
      HttpApiEndpoint.post("form.caller.reply", "/form/:formID/reply", {
        params: { formID: Form.ID },
        query: WorkspaceQuery,
        payload: ReplyBody,
        success: HttpApiSchema.NoContent,
        error: [FormNotFoundError, FormAlreadySettledError, FormInvalidAnswerError, InternalError],
      }).middleware(workspaceMiddleware).annotateMerge(OpenApi.annotations({ identifier: "v2.form.caller.reply" })),
    )
    .add(
      HttpApiEndpoint.post("form.caller.cancel", "/form/:formID/cancel", {
        params: { formID: Form.ID },
        query: WorkspaceQuery,
        success: HttpApiSchema.NoContent,
        error: [FormNotFoundError, FormAlreadySettledError, InternalError],
      }).middleware(workspaceMiddleware).annotateMerge(OpenApi.annotations({ identifier: "v2.form.caller.cancel" })),
    )
    .add(
      HttpApiEndpoint.get("session.form.list", "/session/:sessionID/form", {
        params: { sessionID: Session.ID },
        success: Schema.Array(Form.Info),
        error: [InputError, SessionNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.form.list" })),
    )
    .add(
      HttpApiEndpoint.post("session.form.create", "/session/:sessionID/form", {
        params: { sessionID: Session.ID },
        payload: CreateBody,
        success: Form.Info,
        error: [InputError, SessionNotFoundError, FormAlreadyExistsError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.form.create" })),
    )
    .add(
      HttpApiEndpoint.get("session.form.get", "/session/:sessionID/form/:formID", {
        params: { sessionID: Session.ID, formID: Form.ID },
        success: Form.Info,
        error: [InputError, SessionNotFoundError, FormNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.form.get" })),
    )
    .add(
      HttpApiEndpoint.get("session.form.state", "/session/:sessionID/form/:formID/state", {
        params: { sessionID: Session.ID, formID: Form.ID },
        success: Form.State,
        error: [InputError, SessionNotFoundError, FormNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.form.state" })),
    )
    .add(
      HttpApiEndpoint.post("session.form.reply", "/session/:sessionID/form/:formID/reply", {
        params: { sessionID: Session.ID, formID: Form.ID },
        payload: ReplyBody,
        success: HttpApiSchema.NoContent,
        error: [
          InputError,
          SessionNotFoundError,
          FormNotFoundError,
          FormAlreadySettledError,
          FormInvalidAnswerError,
          InternalError,
        ],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.form.reply" })),
    )
    .add(
      HttpApiEndpoint.post("session.form.cancel", "/session/:sessionID/form/:formID/cancel", {
        params: { sessionID: Session.ID, formID: Form.ID },
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, FormNotFoundError, FormAlreadySettledError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.form.cancel" })),
    )
    .prefix("/api")
