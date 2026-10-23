import * as Message from "@bymorning/schema/message"
import * as Session from "@bymorning/schema/session"
import * as SessionInbox from "@bymorning/schema/session-inbox"
import * as InstructionEntry from "@bymorning/schema/instruction-entry"
import { Context, Schema, SchemaTransformation } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  CompactionConflictError,
  EmptyInput,
  InputError,
  InternalError,
  InvalidCursorError,
  PromptConflictError,
  ProjectArchivedError,
  ProjectNotFoundError,
  SessionNotFoundError,
  SyntheticConflictError,
} from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

const canonicalInteger = <S extends Schema.Codec<number, number>>(schema: S) =>
  Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)$/)).pipe(
    Schema.decodeTo(
      schema,
      SchemaTransformation.transform({
        decode: (value) => Number(value),
        encode: (value) => String(value),
      }),
    ),
  )

const Limit = canonicalInteger(Session.ListInput.fields.limit.schema)
const Null = Schema.Literal("null").pipe(
  Schema.decodeTo(Schema.Null, SchemaTransformation.transform({ decode: () => null, encode: () => "null" as const })),
)
const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) => value === "true",
      encode: (value) => (value ? ("true" as const) : ("false" as const)),
    }),
  ),
)
const EntryList = Schema.Struct({ data: Schema.Array(InstructionEntry.Info) }).annotate({
  identifier: "InstructionEntry.ListResponse",
})
// Keep the 201 annotation from creating a second OpenAPI owner for canonical Session.Info.
const SessionCreated = Schema.suspend(() => Session.Info).pipe(HttpApiSchema.status(201))
const SessionActive = Schema.Struct({
  type: Schema.Literal("running"),
}).annotate({ identifier: "SessionActive" })
const ActiveSessions = Schema.Record(Session.ID, SessionActive).annotate({
  identifier: "SessionActiveMap",
})

/** Protocol-owned URL query codecs for Session operations. */
export const SessionQuery = {
  /** Decode Session list query strings into shared application input. */
  List: Schema.Struct({
    cursor: Schema.optionalKey(Session.ListInput.fields.cursor.schema),
    limit: Schema.optionalKey(Limit),
    search: Schema.optionalKey(Session.ListInput.fields.search.schema),
    parentID: Schema.optionalKey(Schema.Union([Session.ID, Null])),
    archived: Schema.optionalKey(BooleanFromString),
  }),
} as const

/** Authoritative Session lifecycle, transcript, prompt, and cancellation HTTP contracts. */
export const makeSessionGroup = <
  WorkspaceId extends HttpApiMiddleware.AnyId,
  WorkspaceService,
  PersistedSessionId extends HttpApiMiddleware.AnyId,
  PersistedSessionService,
>(
  workspaceMiddleware: Context.Key<WorkspaceId, WorkspaceService>,
  persistedSessionMiddleware: Context.Key<PersistedSessionId, PersistedSessionService>,
) =>
  HttpApiGroup.make("api.session")
    .add(
      HttpApiEndpoint.post("session.create", "/session", {
        payload: Session.CreateInput,
        query: WorkspaceQuery,
        success: SessionCreated,
        error: [InputError, ProjectNotFoundError, ProjectArchivedError, InternalError],
      }),
    )
    .add(
      HttpApiEndpoint.get("session.list", "/session", {
        query: Schema.Struct({ ...SessionQuery.List.fields, ...WorkspaceQuery.fields }),
        success: Session.Page,
        error: [InputError, InvalidCursorError, InternalError],
      }),
    )
    .add(
      HttpApiEndpoint.get("session.active", "/session/active", {
        query: WorkspaceQuery,
        success: ActiveSessions,
        error: [InputError, InternalError],
      }),
    )
    // Effect applies group middleware only to endpoints already added.
    .middleware(workspaceMiddleware)
    .add(
      HttpApiEndpoint.get("session.get", "/session/:sessionID", {
        params: { sessionID: Session.ID },
        success: Session.Detail,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.patch("session.update", "/session/:sessionID", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          title: Session.UpdateInput.fields.title,
          projectID: Session.UpdateInput.fields.projectID,
          archived: Session.UpdateInput.fields.archived,
        }),
        success: Session.Info,
        error: [InputError, SessionNotFoundError, ProjectNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.delete("session.delete", "/session/:sessionID", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.get("session.inbox.list", "/session/:sessionID/inbox", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(SessionInbox.Info) }),
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.prompt", "/session/:sessionID/prompt", {
        params: { sessionID: Session.ID },
        payload: Message.Input,
        success: Message.Admitted.pipe(HttpApiSchema.status(202)),
        error: [InputError, SessionNotFoundError, PromptConflictError, ProjectArchivedError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.compact", "/session/:sessionID/compact", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ id: Session.CompactInput.fields.id }),
        success: Message.Admitted.pipe(HttpApiSchema.status(202)),
        error: [InputError, SessionNotFoundError, CompactionConflictError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.interrupt", "/session/:sessionID/interrupt", {
        params: { sessionID: Session.ID },
        payload: EmptyInput,
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.background", "/session/:sessionID/background", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.switchAgent", "/session/:sessionID/agent", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ agent: Session.AgentInput.fields.agent }),
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.switchAgent" })),
    )
    .add(
      HttpApiEndpoint.post("session.switchModel", "/session/:sessionID/model", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ model: Session.ModelInput.fields.model }),
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      })
        .middleware(persistedSessionMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "v2.session.switchModel" })),
    )
    .add(
      HttpApiEndpoint.post("session.rename", "/session/:sessionID/rename", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ title: Schema.String }),
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.command", "/session/:sessionID/command", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: Schema.optionalKey(Message.ID),
          command: Schema.String,
          arguments: Schema.optionalKey(Schema.String),
        }),
        success: Message.Admitted.pipe(HttpApiSchema.status(202)),
        error: [InputError, SessionNotFoundError, PromptConflictError, ProjectArchivedError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.synthetic", "/session/:sessionID/synthetic", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: Schema.optionalKey(Message.ID),
          ...SessionInbox.SyntheticPayload.fields,
          delivery: Schema.optionalKey(SessionInbox.Delivery),
          resume: Schema.optionalKey(Schema.Boolean),
        }),
        success: Schema.Struct({ data: SessionInbox.Synthetic }),
        error: [InputError, SessionNotFoundError, SyntheticConflictError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.wait", "/session/:sessionID/wait", {
        params: { sessionID: Session.ID },
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.post("session.generate", "/session/:sessionID/generate", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({ prompt: Schema.String }),
        success: Schema.Struct({ data: Schema.Struct({ text: Schema.String }) }),
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.get("session.entry.list", "/session/:sessionID/instructions/entries", {
        params: { sessionID: Session.ID },
        success: EntryList,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.put("session.entry.put", "/session/:sessionID/instructions/entries/:key", {
        params: { sessionID: Session.ID, key: InstructionEntry.Key },
        payload: Schema.Struct({ value: Schema.Json }),
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InstructionEntry.SizeError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .add(
      HttpApiEndpoint.delete("session.entry.remove", "/session/:sessionID/instructions/entries/:key", {
        params: { sessionID: Session.ID, key: InstructionEntry.Key },
        success: HttpApiSchema.NoContent,
        error: [InputError, SessionNotFoundError, InternalError],
      }).middleware(persistedSessionMiddleware),
    )
    .prefix("/api")
