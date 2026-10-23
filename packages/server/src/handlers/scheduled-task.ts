import { Project } from "@bymorning/core/project"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import {
  ProjectArchivedError,
  ProjectNotFoundError,
  ScheduledTaskLimitError,
  ScheduledTaskNotFoundError,
  ScheduledTaskRunError,
  ScheduledTaskScheduleError,
} from "@bymorning/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api.js"

const notFound = (error: ScheduledTask.NotFoundError) =>
  new ScheduledTaskNotFoundError({ taskID: error.taskID, message: `Scheduled Task not found: ${error.taskID}` })
const invalidSchedule = (error: ScheduledTask.ScheduleError) => new ScheduledTaskScheduleError({ message: error.message })
const limitReached = (error: ScheduledTask.LimitError) =>
  new ScheduledTaskLimitError({ limit: error.limit, message: `Scheduled Task limit reached: ${error.limit}` })
const projectNotFound = (error: Project.NotFoundError) =>
  new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` })
const projectArchived = (error: Project.ArchivedError) =>
  new ProjectArchivedError({
    projectID: error.projectID,
    message: "This project is archived. Restore it to make changes.",
  })
const runFailed = (error: ScheduledTask.RunError) =>
  new ScheduledTaskRunError({ taskID: error.taskID, message: error.message })

/** Scheduled Task endpoint implementations. */
export const ScheduledTaskHandler = HttpApiBuilder.group(Api, "api.scheduledTask", (handlers) =>
  handlers
    .handle("scheduledTask.create", ({ payload }) =>
      ScheduledTask.Service.use((tasks) =>
        tasks.create(payload).pipe(
          Effect.catchTags({
            "ScheduledTask.ScheduleError": invalidSchedule,
            "ScheduledTask.LimitError": limitReached,
            "Project.NotFoundError": projectNotFound,
            "Project.ArchivedError": projectArchived,
          }),
        ),
      ),
    )
    .handle("scheduledTask.list", () => ScheduledTask.Service.use((tasks) => tasks.list))
    .handle("scheduledTask.get", ({ params }) =>
      ScheduledTask.Service.use((tasks) =>
        tasks.get(params.taskID).pipe(Effect.catchTag("ScheduledTask.NotFoundError", notFound)),
      ),
    )
    .handle("scheduledTask.update", ({ params, payload }) =>
      ScheduledTask.Service.use((tasks) =>
        tasks.update({ taskID: params.taskID, ...payload }).pipe(
          Effect.catchTags({
            "ScheduledTask.NotFoundError": notFound,
            "ScheduledTask.ScheduleError": invalidSchedule,
            "Project.NotFoundError": projectNotFound,
          }),
        ),
      ),
    )
    .handle("scheduledTask.delete", ({ params }) =>
      ScheduledTask.Service.use((tasks) =>
        tasks
          .delete(params.taskID)
          .pipe(Effect.catchTag("ScheduledTask.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("scheduledTask.run", ({ params }) =>
      ScheduledTask.Service.use((tasks) =>
        tasks.run(params.taskID).pipe(
          Effect.catchTags({
            "ScheduledTask.NotFoundError": notFound,
            "ScheduledTask.RunError": runFailed,
          }),
        ),
      ),
    )
    .handle("scheduledTask.dismiss", ({ params }) =>
      ScheduledTask.Service.use((tasks) =>
        tasks.dismiss(params.taskID).pipe(Effect.catchTag("ScheduledTask.NotFoundError", notFound)),
      ),
    ),
)
