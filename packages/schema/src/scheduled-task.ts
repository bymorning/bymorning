/** Declares the Scheduled Task contract owned by this module. */
export * as ScheduledTask from "./scheduled-task.js"
export * as ScheduledTaskSchema from "./scheduled-task.js"

import { Schema } from "effect"
import { define, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { Ref as ModelRef } from "./model.js"
import { ID as ProjectID } from "./project.js"
import { Timestamp, statics } from "./schema.js"
import { SessionID } from "./identifier.js"

/** Canonical identity of a member-owned Scheduled Task. */
export const ID = Schema.String.check(Schema.isPattern(/^tsk_[0-9A-Za-z]{26}$/)).pipe(
  Schema.brand("ScheduledTask.ID"),
  statics((schema) => ({ create: () => schema.make("tsk_" + ascending()) })),
)

/** Canonical identity of a member-owned Scheduled Task. */
export type ID = typeof ID.Type

/** Short display name for a Scheduled Task. */
export const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))

/** The prompt submitted as the first Message of each run. */
export const Prompt = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000))

/** A five-field cron expression evaluated in the task's time zone. */
export const Cron = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))

/** An IANA time zone identifier, such as `America/New_York`. */
export const TimeZone = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))

/** Maximum model turns one unattended run may take before Tools are withheld. */
export const RunSteps = 50

/** Maximum Scheduled Tasks one member may hold in a Workspace. */
export const MaxPerMember = 20

/** Minimum time between two occurrences of one schedule, in milliseconds. */
export const MinIntervalMillis = 60 * 60 * 1000

/** Public Scheduled Task state, including its latest run and latest miss. */
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  prompt: Prompt,
  cron: Cron,
  timezone: TimeZone,
  projectID: ProjectID,
  model: Schema.optionalKey(ModelRef),
  enabled: Schema.Boolean,
  nextRunAt: Schema.optionalKey(Timestamp),
  lastRunAt: Schema.optionalKey(Timestamp),
  lastSessionID: Schema.optionalKey(SessionID),
  lastNote: Schema.optionalKey(Schema.String),
  missedAt: Schema.optionalKey(Timestamp),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).annotate({ identifier: "ScheduledTask.Info" })

/** Public Scheduled Task state, including its latest run and latest miss. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Input for creating a Scheduled Task. */
export const CreateInput = Schema.Struct({
  name: Name,
  prompt: Prompt,
  cron: Cron,
  timezone: TimeZone,
  projectID: Schema.optionalKey(ProjectID),
  model: Schema.optionalKey(ModelRef),
  enabled: Schema.optionalKey(Schema.Boolean),
})

/** Input for creating a Scheduled Task. */
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

/** Input for patching one Scheduled Task. A `null` model clears the preference. */
export const UpdateInput = Schema.Struct({
  taskID: ID,
  name: Schema.optionalKey(Name),
  prompt: Schema.optionalKey(Prompt),
  cron: Schema.optionalKey(Cron),
  timezone: Schema.optionalKey(TimeZone),
  projectID: Schema.optionalKey(ProjectID),
  model: Schema.optionalKey(Schema.NullOr(ModelRef)),
  enabled: Schema.optionalKey(Schema.Boolean),
})

/** Input for patching one Scheduled Task. */
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

/** The requested Scheduled Task does not exist for this member. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("ScheduledTask.NotFoundError", {
  taskID: ID,
}) {}

/** The cron expression or time zone is invalid, or occurrences are closer than the minimum interval. */
export class ScheduleError extends Schema.TaggedError<ScheduleError>()("ScheduledTask.ScheduleError", {
  message: Schema.String,
}) {}

/** The member already holds the maximum number of Scheduled Tasks. */
export class LimitError extends Schema.TaggedError<LimitError>()("ScheduledTask.LimitError", {
  limit: Schema.Int,
}) {}

/** A run could not start; the reason is also recorded on the task. */
export class RunError extends Schema.TaggedError<RunError>()("ScheduledTask.RunError", {
  taskID: ID,
  message: Schema.String,
}) {}

/** A Scheduled Task was created, changed, ran, or was missed. */
export const Updated = define("scheduledTask.updated", { task: Info })

/** A Scheduled Task was deleted. */
export const Deleted = define("scheduledTask.deleted", { taskID: ID })

/** Current Scheduled Task Event definition inventory. */
export const Definitions = inventory(Updated, Deleted)
