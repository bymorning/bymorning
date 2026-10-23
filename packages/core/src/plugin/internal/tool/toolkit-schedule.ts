/** Toolkit Scheduled Task Tools: let the model manage the calling member's recurring runs. */
import type { ToolEditor } from "@bymorning/plugin/effect/tool"
import { ScheduledTaskSchema } from "@bymorning/schema/scheduled-task"
import { SessionSchema } from "@bymorning/schema/session"
import { Effect, Schema } from "effect"
import type { PluginRuntime } from "../../runtime.js"
import { Tool } from "../../../tool.js"
import { operational } from "./toolkit-shared.js"

export const ScheduleNamespace = "toolkit.schedule" as const

const TaskIDInput = Schema.Struct({
  taskID: ScheduledTaskSchema.ID.annotate({ description: "ID of one of the user's Scheduled Tasks" }),
})
const TaskList = Schema.Struct({ tasks: Schema.Array(ScheduledTaskSchema.Info) })

const notFound = () => new Tool.Error({ message: "Scheduled Task not found" })
const limitReached = (error: ScheduledTaskSchema.LimitError) =>
  new Tool.Error({ message: `The user already has the maximum of ${error.limit} Scheduled Tasks; delete one first` })
const invalidSchedule = (error: ScheduledTaskSchema.ScheduleError) => new Tool.Error({ message: error.message })
const projectNotFound = () => new Tool.Error({ message: "Project not found" })
const projectArchived = () =>
  new Tool.Error({ message: "The Project is archived; the user must restore it before scheduling a task in it" })
const runFailed = (error: ScheduledTaskSchema.RunError) => new Tool.Error({ message: error.message })

export const registerScheduleTools = (editor: ToolEditor, runtime: PluginRuntime.Interface["scheduledTask"]) => {
  editor.namespace({
    name: ScheduleNamespace,
    description:
      "Use when the user wants something to run on a schedule (daily, weekly, every morning, monitor, remind) or wants to see, change, pause, run, or delete their Scheduled Tasks. Load the scheduled-task Skill before creating one.",
  })
  editor.add({
    name: "list",
    description: "Use when the user wants to see their Scheduled Tasks, including next and last run.",
    input: Schema.Struct({}),
    output: TaskList,
    options: { ...operational("schedule_list", ScheduleNamespace) },
    execute: (_input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "schedule_list", resources: ["scheduled-task"] })
        return { output: { tasks: yield* runtime.list } }
      }),
  })
  editor.add({
    name: "get",
    description: "Use when the user wants one Scheduled Task by ID.",
    input: TaskIDInput,
    output: ScheduledTaskSchema.Info,
    options: { ...operational("schedule_get", ScheduleNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "schedule_get", resources: [input.taskID] })
        return { output: yield* runtime.get(input.taskID).pipe(Effect.catchTag("ScheduledTask.NotFoundError", notFound)) }
      }),
  })
  editor.add({
    name: "create",
    description:
      "Use when the user wants a prompt to run on a recurring schedule. `cron` is a five-field expression evaluated in `timezone` (an IANA zone such as America/New_York); occurrences must be at least one hour apart. Omit `projectID` to use the user's first Project.",
    input: ScheduledTaskSchema.CreateInput,
    output: ScheduledTaskSchema.Info,
    options: { ...operational("schedule_create", ScheduleNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "schedule_create", resources: [input.name] })
        return {
          output: yield* runtime.create(input).pipe(
            Effect.catchTags({
              "ScheduledTask.ScheduleError": invalidSchedule,
              "ScheduledTask.LimitError": limitReached,
              "Project.NotFoundError": projectNotFound,
              "Project.ArchivedError": projectArchived,
            }),
          ),
        }
      }),
  })
  editor.add({
    name: "update",
    description:
      "Use when the user wants to change, pause (`enabled: false`), or resume one Scheduled Task. Only supplied fields change.",
    input: ScheduledTaskSchema.UpdateInput,
    output: ScheduledTaskSchema.Info,
    options: { ...operational("schedule_update", ScheduleNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "schedule_update", resources: [input.taskID] })
        return {
          output: yield* runtime.update(input).pipe(
            Effect.catchTags({
              "ScheduledTask.NotFoundError": notFound,
              "ScheduledTask.ScheduleError": invalidSchedule,
              "Project.NotFoundError": projectNotFound,
            }),
          ),
        }
      }),
  })
  editor.add({
    name: "delete",
    description: "Use when the user wants to delete one Scheduled Task. Sessions it already created remain.",
    input: TaskIDInput,
    output: Schema.Struct({ deleted: ScheduledTaskSchema.ID }),
    options: { ...operational("schedule_delete", ScheduleNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "schedule_delete", resources: [input.taskID] })
        yield* runtime.delete(input.taskID).pipe(Effect.catchTag("ScheduledTask.NotFoundError", notFound))
        return { output: { deleted: input.taskID } }
      }),
  })
  editor.add({
    name: "run",
    description: "Use when the user wants a Scheduled Task to run right now. Starts a new Session and returns it.",
    input: TaskIDInput,
    output: SessionSchema.Info,
    options: { ...operational("schedule_run", ScheduleNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "schedule_run", resources: [input.taskID] })
        return {
          output: yield* runtime.run(input.taskID).pipe(
            Effect.catchTags({ "ScheduledTask.NotFoundError": notFound, "ScheduledTask.RunError": runFailed }),
          ),
        }
      }),
  })
}
