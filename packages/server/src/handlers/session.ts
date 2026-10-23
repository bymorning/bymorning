import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import {
  CompactionConflictError,
  InvalidCursorError,
  InputError,
  InternalError,
  ProjectArchivedError,
  ProjectNotFoundError,
  PromptConflictError,
  SessionNotFoundError,
  SyntheticConflictError,
} from "@bymorning/protocol/errors"
import { Project } from "@bymorning/core/project"
import { Session } from "@bymorning/core/session"
import { InstructionEntry } from "@bymorning/core/instruction-entry"
import { SessionOperations } from "@bymorning/core/session-operations"
import { Api } from "../api.js"

/** Session endpoint implementations. */
export const SessionHandler = HttpApiBuilder.group(Api, "api.session", (handlers) => {
  const notFound = (error: Session.NotFoundError) =>
    new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` })
  const invalidCursor = () => new InvalidCursorError({ message: "Invalid pagination cursor" })
  const projectNotFound = (error: Project.NotFoundError) =>
    new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` })
  const projectArchived = (error: Project.ArchivedError) =>
    new ProjectArchivedError({
      projectID: error.projectID,
      message: "This project is archived. Restore it to make changes.",
    })
  const promptConflict = (error: Session.PromptConflictError) =>
    new PromptConflictError({
      sessionID: error.sessionID,
      messageID: error.messageID,
      message: `Message ID is already in use: ${error.messageID}`,
    })
  const compactionConflict = (error: Session.CompactionConflictError) =>
    new CompactionConflictError({
      sessionID: error.sessionID,
      messageID: error.messageID,
      message: `Message ID is already in use: ${error.messageID}`,
    })
  const syntheticConflict = (error: Session.SyntheticConflictError) =>
    new SyntheticConflictError({
      sessionID: error.sessionID,
      messageID: error.messageID,
      message: `Message ID is already in use: ${error.messageID}`,
    })

  return handlers
    .handle("session.create", ({ payload }) =>
      Session.Service.use((session) =>
        session.create(payload).pipe(
          Effect.catchTags({ "Project.NotFoundError": projectNotFound, "Project.ArchivedError": projectArchived }),
        ),
      ),
    )
    .handle("session.list", ({ query }) =>
      Session.Service.use((session) =>
        session.list(query).pipe(Effect.catchTag("Session.InvalidCursorError", invalidCursor)),
      ),
    )
    .handle("session.active", () =>
      Session.Service.use((session) =>
        session.active.pipe(
          Effect.map((active) =>
            Object.fromEntries(
              Array.from(active, (sessionID) => [sessionID, { type: "running" as const }]),
            ),
          ),
        ),
      ),
    )
    .handle("session.get", ({ params }) =>
      Session.Service.use((session) =>
        session.get(params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", notFound)),
      ),
    )
    .handle("session.update", ({ params, payload }) =>
      Session.Service.use((session) =>
        session.update({ sessionID: params.sessionID, ...payload }).pipe(
          Effect.catchTags({
            "Session.NotFoundError": notFound,
            "Project.NotFoundError": projectNotFound,
          }),
        ),
      ),
    )
    .handle("session.delete", ({ params }) =>
      Session.Service.use((session) =>
        session
          .delete(params.sessionID)
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.inbox.list", ({ params }) =>
      Session.Service.use((session) =>
        session.inbox(params.sessionID).pipe(
          Effect.map((data) => ({ data })),
          Effect.catchTag("Session.NotFoundError", notFound),
        ),
      ),
    )
    .handle("session.prompt", ({ params, payload }) =>
      Session.Service.use((session) =>
        session.prompt({ sessionID: params.sessionID, ...payload }).pipe(
          Effect.catchTags({
            "Session.NotFoundError": notFound,
            "Session.PromptConflictError": promptConflict,
            "Project.ArchivedError": projectArchived,
          }),
        ),
      ),
    )
    .handle("session.compact", ({ params, payload }) =>
      Session.Service.use((session) =>
        session.compact({ sessionID: params.sessionID, ...payload }).pipe(
          Effect.catchTags({
            "Session.NotFoundError": notFound,
            "Session.CompactionConflictError": compactionConflict,
          }),
        ),
      ),
    )
    .handle("session.interrupt", ({ params }) =>
      Session.Service.use((session) =>
        session
          .interrupt(params.sessionID, "user")
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.background", ({ params }) =>
      Session.Service.use((session) =>
        session
          .background(params.sessionID)
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.switchAgent", ({ params, payload }) =>
      Session.Service.use((session) =>
        session
          .switchAgent({ sessionID: params.sessionID, agent: payload.agent })
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.switchModel", ({ params, payload }) =>
      Session.Service.use((session) =>
        session
          .switchModel({ sessionID: params.sessionID, model: payload.model })
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.rename", ({ params, payload }) =>
      SessionOperations.Service.use((operations) =>
        operations
          .rename({ sessionID: params.sessionID, title: payload.title })
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.command", ({ params, payload }) =>
      SessionOperations.Service.use((operations) =>
        operations.command({ sessionID: params.sessionID, ...payload }).pipe(
          Effect.catchTags({
            "Session.NotFoundError": notFound,
            "Session.PromptConflictError": promptConflict,
            "Project.ArchivedError": projectArchived,
            "Command.NotFoundError": (error) => new InputError({ error: error.message }),
            "Command.EvaluationError": (error) => new InputError({ error: error.message }),
          }),
        ),
      ),
    )
    .handle("session.synthetic", ({ params, payload }) =>
      SessionOperations.Service.use((operations) =>
        operations.synthetic({ sessionID: params.sessionID, ...payload }).pipe(
          Effect.map((data) => ({ data })),
          Effect.catchTags({
            "Session.NotFoundError": notFound,
            "Session.SyntheticConflictError": syntheticConflict,
          }),
        ),
      ),
    )
    .handle("session.wait", ({ params }) =>
      SessionOperations.Service.use((operations) =>
        operations
          .wait(params.sessionID)
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.generate", ({ params, payload }) =>
      SessionOperations.Service.use((operations) =>
        operations.generate({ sessionID: params.sessionID, prompt: payload.prompt }).pipe(
          Effect.map((text) => ({ data: { text } })),
          Effect.catchTag("Session.NotFoundError", notFound),
          Effect.catchTags({
            "Model.NotFoundError": (error) => new InternalError({ error: String(error) }),
            "Provider.FailureError": (error) => new InternalError({ error: String(error.cause) }),
            "Provider.ContextOverflowError": (error) => new InternalError({ error: String(error.cause) }),
          }),
        ),
      ),
    )
    .handle("session.entry.list", ({ params }) =>
      InstructionEntry.Service.use((entries) =>
        entries.list(params.sessionID).pipe(
          Effect.catchTag("Session.NotFoundError", notFound),
          Effect.map((data) => ({ data })),
        ),
      ),
    )
    .handle("session.entry.put", ({ params, payload }) =>
      InstructionEntry.Service.use((entries) =>
        entries
          .put({ sessionID: params.sessionID, key: params.key, value: payload.value })
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("session.entry.remove", ({ params }) =>
      InstructionEntry.Service.use((entries) =>
        entries
          .remove({ sessionID: params.sessionID, key: params.key })
          .pipe(Effect.catchTag("Session.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
})
