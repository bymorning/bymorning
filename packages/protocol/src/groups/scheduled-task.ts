import * as ScheduledTask from "@bymorning/schema/scheduled-task"
import * as Session from "@bymorning/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import {
  InputError,
  InternalError,
  ProjectArchivedError,
  ProjectNotFoundError,
  ScheduledTaskLimitError,
  ScheduledTaskNotFoundError,
  ScheduledTaskRunError,
  ScheduledTaskScheduleError,
} from "../errors.js"
import { WorkspaceQuery } from "../middleware/workspace-middleware.js"

const Patch = Schema.Struct({
  name: ScheduledTask.UpdateInput.fields.name,
  prompt: ScheduledTask.UpdateInput.fields.prompt,
  cron: ScheduledTask.UpdateInput.fields.cron,
  timezone: ScheduledTask.UpdateInput.fields.timezone,
  projectID: ScheduledTask.UpdateInput.fields.projectID,
  model: ScheduledTask.UpdateInput.fields.model,
  enabled: ScheduledTask.UpdateInput.fields.enabled,
})

// Keep the 201 annotation from creating a second OpenAPI owner for canonical Session.Info.
const SessionCreated = Schema.suspend(() => Session.Info).pipe(HttpApiSchema.status(201))

/** Workspace-authenticated Scheduled Task CRUD and run contracts. */
export const ScheduledTaskGroup = HttpApiGroup.make("api.scheduledTask")
  .add(
    HttpApiEndpoint.post("scheduledTask.create", "/scheduled-task", {
      query: WorkspaceQuery,
      payload: ScheduledTask.CreateInput,
      success: ScheduledTask.Info.pipe(HttpApiSchema.status(201)),
      error: [
        InputError,
        ScheduledTaskScheduleError,
        ScheduledTaskLimitError,
        ProjectNotFoundError,
        ProjectArchivedError,
        InternalError,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.get("scheduledTask.list", "/scheduled-task", {
      query: WorkspaceQuery,
      success: Schema.Array(ScheduledTask.Info),
    }),
  )
  .add(
    HttpApiEndpoint.get("scheduledTask.get", "/scheduled-task/:taskID", {
      params: { taskID: ScheduledTask.ID },
      query: WorkspaceQuery,
      success: ScheduledTask.Info,
      error: [InputError, ScheduledTaskNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("scheduledTask.update", "/scheduled-task/:taskID", {
      params: { taskID: ScheduledTask.ID },
      query: WorkspaceQuery,
      payload: Patch,
      success: ScheduledTask.Info,
      error: [
        InputError,
        ScheduledTaskNotFoundError,
        ScheduledTaskScheduleError,
        ProjectNotFoundError,
        InternalError,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("scheduledTask.delete", "/scheduled-task/:taskID", {
      params: { taskID: ScheduledTask.ID },
      query: WorkspaceQuery,
      success: HttpApiSchema.NoContent,
      error: [InputError, ScheduledTaskNotFoundError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("scheduledTask.run", "/scheduled-task/:taskID/run", {
      params: { taskID: ScheduledTask.ID },
      query: WorkspaceQuery,
      success: SessionCreated,
      error: [InputError, ScheduledTaskNotFoundError, ScheduledTaskRunError, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.post("scheduledTask.dismiss", "/scheduled-task/:taskID/dismiss", {
      params: { taskID: ScheduledTask.ID },
      query: WorkspaceQuery,
      success: ScheduledTask.Info,
      error: [InputError, ScheduledTaskNotFoundError, InternalError],
    }),
  )
  .prefix("/api")
