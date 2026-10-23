/** Exposes the member-owned Scheduled Task capability. */
export * as ScheduledTask from "./scheduled-task.js"

import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { SessionSchema } from "@bymorning/schema/session"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { and, asc, count, desc, eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Result } from "effect"
import { Actor } from "./actor.js"
import { Bus } from "./bus.js"
import { Catalog } from "./catalog.js"
import { Database } from "./database.js"
import { ScheduledTaskTable } from "./database/schema/scheduled-task.sql.js"
import { SessionTable } from "./database/schema/session.sql.js"
import { InstructionEntry } from "./instruction-entry.js"
import { Project } from "./project.js"
import { RunContext } from "./scheduled-task/context.js"
import { Schedule } from "./scheduled-task/schedule.js"
import { Session } from "./session.js"
import { Routing } from "./routing.js"

export { Due } from "./scheduled-task/due.js"

export const ID = ScheduledTask.ID
export type ID = ScheduledTask.ID
export const Info = ScheduledTask.Info
export type Info = ScheduledTask.Info
export const NotFoundError = ScheduledTask.NotFoundError
export type NotFoundError = ScheduledTask.NotFoundError
export const ScheduleError = ScheduledTask.ScheduleError
export type ScheduleError = ScheduledTask.ScheduleError
export const LimitError = ScheduledTask.LimitError
export type LimitError = ScheduledTask.LimitError
export const RunError = ScheduledTask.RunError
export type RunError = ScheduledTask.RunError
export const RunSteps = ScheduledTask.RunSteps
export const MaxPerMember = ScheduledTask.MaxPerMember

/** Member-bound Scheduled Task authority. */
export interface Interface {
  /**
   * Create a task for the bound member; the next occurrence is computed from now. Fails with
   * `Project.ArchivedError` when the task's Project is archived.
   */
  readonly create: (
    input: ScheduledTask.CreateInput,
  ) => Effect.Effect<Info, ScheduleError | LimitError | Project.NotFoundError | Project.ArchivedError>
  /** Get one of the bound member's tasks. */
  readonly get: (taskID: ID) => Effect.Effect<Info, NotFoundError>
  /** List the bound member's tasks, soonest next run first. */
  readonly list: Effect.Effect<ReadonlyArray<Info>>
  /** Patch one task; schedule or enablement changes recompute the next occurrence from now. */
  readonly update: (
    input: ScheduledTask.UpdateInput,
  ) => Effect.Effect<Info, NotFoundError | ScheduleError | Project.NotFoundError>
  /** Delete one task. Sessions it created remain. */
  readonly delete: (taskID: ID) => Effect.Effect<void, NotFoundError>
  /** Start one run now: create a Session titled with the task name, add the run context, and admit the prompt. */
  readonly run: (taskID: ID) => Effect.Effect<SessionSchema.Info, NotFoundError | RunError>
  /** Clear a recorded miss without running. */
  readonly dismiss: (taskID: ID) => Effect.Effect<Info, NotFoundError>
}

/** Member-bound Scheduled Task authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ScheduledTask") {}

const fromRow = (row: typeof ScheduledTaskTable.$inferSelect): Info =>
  Info.make({
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    timezone: row.timezone,
    projectID: row.projectID,
    ...(row.model === null ? {} : { model: row.model }),
    enabled: row.enabled,
    ...(row.nextRunAt === null ? {} : { nextRunAt: row.nextRunAt }),
    ...(row.lastRunAt === null ? {} : { lastRunAt: row.lastRunAt }),
    ...(row.lastSessionID === null ? {} : { lastSessionID: row.lastSessionID }),
    ...(row.last_note === null ? {} : { lastNote: row.last_note }),
    ...(row.missedAt === null ? {} : { missedAt: row.missedAt }),
    createdAt: row.timeCreated,
    updatedAt: row.timeUpdated,
  })

/** Build the Scheduled Task capability for one member. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { workspaceID, userID } = yield* Actor.Binding.Service
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const catalog = yield* Catalog.Service
    const entries = yield* InstructionEntry.Service
    const projects = yield* Project.Service

    const owned = (taskID: ID) =>
      and(eq(ScheduledTaskTable.workspaceID, workspaceID), eq(ScheduledTaskTable.userID, userID), eq(ScheduledTaskTable.id, taskID))

    const publish = (task: Info) =>
      database.afterCommit(bus.publish(ScheduledTask.Updated, { task }).pipe(Effect.orDie, Effect.asVoid))

    const read = Effect.fn("ScheduledTask.read")(function* (taskID: ID) {
      const [row] = yield* database
        .use("ScheduledTask.read", (db) => db.select().from(ScheduledTaskTable).where(owned(taskID)).limit(1))
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ taskID })
      return row
    })

    const schedule = (cron: string, timezone: string) =>
      Result.match(Schedule.parse(cron, timezone), { onFailure: Effect.fail, onSuccess: Effect.succeed })

    const resolveProject = Effect.fn("ScheduledTask.project")(function* (projectID: Info["projectID"] | undefined) {
      if (projectID !== undefined) return (yield* projects.get(projectID)).id
      // The first active Project is the Default Project, which cannot be archived.
      const [first] = yield* projects.list()
      if (first === undefined) return yield* Effect.die(new Error("Workspace has no Project"))
      return first.id
    })

    const create = Effect.fn("ScheduledTask.create")(function* (input: ScheduledTask.CreateInput) {
      const parsed = yield* schedule(input.cron, input.timezone)
      const projectID = yield* resolveProject(input.projectID)
      if (input.projectID !== undefined && (yield* projects.get(projectID)).archivedAt !== undefined)
        return yield* new Project.ArchivedError({ projectID })
      const now = yield* DateTime.nowAsDate
      const enabled = input.enabled ?? true
      return yield* database.transact(
        Effect.gen(function* () {
          const [counted] = yield* database
            .use("ScheduledTask.count", (db) =>
              db
                .select({ total: count() })
                .from(ScheduledTaskTable)
                .where(and(eq(ScheduledTaskTable.workspaceID, workspaceID), eq(ScheduledTaskTable.userID, userID))),
            )
            .pipe(Effect.orDie)
          if ((counted?.total ?? 0) >= MaxPerMember) return yield* new LimitError({ limit: MaxPerMember })
          const [row] = yield* database
            .use("ScheduledTask.create", (db) =>
              db
                .insert(ScheduledTaskTable)
                .values({
                  workspaceID,
                  id: ID.create(),
                  userID,
                  projectID,
                  name: input.name.trim(),
                  prompt: input.prompt.trim(),
                  cron: parsed.expression,
                  timezone: parsed.timezone,
                  model: input.model ?? null,
                  enabled,
                  nextRunAt: enabled ? Schedule.next(parsed, now) : null,
                  timeCreated: now,
                  timeUpdated: now,
                })
                .returning(),
            )
            .pipe(Effect.orDie)
          if (!row) return yield* Effect.die(new Error("Scheduled Task insert returned no row"))
          const task = fromRow(row)
          yield* publish(task)
          return task
        }),
      ).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const get = Effect.fn("ScheduledTask.get")(function* (taskID: ID) {
      return fromRow(yield* read(taskID))
    })

    // Enabled tasks first by next run, then paused tasks by creation.
    const list = database
      .use("ScheduledTask.list", (db) =>
        db
          .select()
          .from(ScheduledTaskTable)
          .where(and(eq(ScheduledTaskTable.workspaceID, workspaceID), eq(ScheduledTaskTable.userID, userID)))
          .orderBy(
            desc(ScheduledTaskTable.enabled),
            asc(ScheduledTaskTable.nextRunAt),
            asc(ScheduledTaskTable.timeCreated),
          ),
      )
      .pipe(
        Effect.map((rows) => rows.map(fromRow)),
        Effect.orDie,
      )

    const update = Effect.fn("ScheduledTask.update")(function* (input: ScheduledTask.UpdateInput) {
      const current = yield* read(input.taskID)
      const cron = input.cron ?? current.cron
      const timezone = input.timezone ?? current.timezone
      const parsed = yield* schedule(cron, timezone)
      const projectID = input.projectID === undefined ? current.projectID : yield* resolveProject(input.projectID)
      const enabled = input.enabled ?? current.enabled
      const now = yield* DateTime.nowAsDate
      const rescheduled =
        input.cron !== undefined || input.timezone !== undefined || (enabled && !current.enabled) || current.nextRunAt === null
      const [row] = yield* database
        .use("ScheduledTask.update", (db) =>
          db
            .update(ScheduledTaskTable)
            .set({
              ...(input.name === undefined ? {} : { name: input.name.trim() }),
              ...(input.prompt === undefined ? {} : { prompt: input.prompt.trim() }),
              cron: parsed.expression,
              timezone: parsed.timezone,
              projectID,
              ...(input.model === undefined ? {} : { model: input.model }),
              enabled,
              nextRunAt: !enabled ? null : rescheduled ? Schedule.next(parsed, now) : current.nextRunAt,
              timeUpdated: now,
            })
            .where(owned(input.taskID))
            .returning(),
        )
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ taskID: input.taskID })
      const task = fromRow(row)
      yield* publish(task)
      return task
    })

    const remove = Effect.fn("ScheduledTask.delete")(function* (taskID: ID) {
      return yield* database.transact(
        Effect.gen(function* () {
          yield* read(taskID)
          // Sessions survive their Scheduled Task; detach the reference before
          // deleting because the composite foreign key rejects the delete.
          yield* database
            .use("ScheduledTask.detachSessions", (db) =>
              db
                .update(SessionTable)
                .set({ scheduledTaskID: null })
                .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.scheduledTaskID, taskID))),
            )
            .pipe(Effect.orDie)
          const [row] = yield* database
            .use("ScheduledTask.delete", (db) =>
              db.delete(ScheduledTaskTable).where(owned(taskID)).returning({ id: ScheduledTaskTable.id }),
            )
            .pipe(Effect.orDie)
          if (!row) return yield* new NotFoundError({ taskID })
          yield* database.afterCommit(bus.publish(ScheduledTask.Deleted, { taskID }).pipe(Effect.orDie, Effect.asVoid))
        }),
      ).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    /** Patch run-tracking columns and publish the result. Fails when the task no longer exists. */
    const record = Effect.fn("ScheduledTask.record")(function* (
      taskID: ID,
      values: Partial<typeof ScheduledTaskTable.$inferInsert>,
    ) {
      const [row] = yield* database
        .use("ScheduledTask.record", (db) =>
          db
            .update(ScheduledTaskTable)
            .set({ ...values, timeUpdated: new Date() })
            .where(owned(taskID))
            .returning(),
        )
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ taskID })
      const task = fromRow(row)
      yield* publish(task)
      return task
    })

    // The task's existence was just confirmed under the same owner scope; a concurrent delete on these
    // follow-up writes is an invariant violation, not a normal outcome, so a missing row is a defect.
    const recordOrDie = (taskID: ID, values: Partial<typeof ScheduledTaskTable.$inferInsert>) =>
      record(taskID, values).pipe(Effect.orDie)

    const archivedNote = "The task's Project is archived; restore the Project to run it"
    const routing = yield* Effect.serviceOption(Routing.Service)
    const run = Effect.fn("ScheduledTask.run")(function* (taskID: ID) {
      const task = fromRow(yield* read(taskID))
      const fail = (message: string) =>
        recordOrDie(taskID, { last_note: message }).pipe(Effect.andThen(new RunError({ taskID, message })))
      let note: string | undefined
      let model = task.model
      if (model !== undefined) {
        const preferred = model
        // An Auto name is available while a routing rule resolves it; Routing then chooses the Model per turn.
        const available = Routing.isAuto(preferred)
          ? Option.isSome(routing) && (yield* routing.value.names).some((name) => name.id === preferred.id)
          : Option.isSome(yield* catalog.model.requireAvailable(preferred).pipe(Effect.option))
        if (!available) {
          note = `The preferred model ${model.provider}/${model.id} is unavailable; this run uses the default model.`
          model = undefined
        }
      }
      const session = yield* sessions
        .create({ projectID: task.projectID, ...(model === undefined ? {} : { model }), title: task.name, scheduledTaskID: taskID })
        .pipe(
          Effect.catchTags({
            "Project.NotFoundError": () => fail("The task's Project no longer exists"),
            "Project.ArchivedError": () => fail(archivedNote),
          }),
        )
      yield* entries
        .put({ sessionID: session.id, key: RunContext.Key, value: RunContext.render(task, note) })
        .pipe(Effect.orDie)
      yield* sessions.prompt({ sessionID: session.id, text: task.prompt }).pipe(
        Effect.catchTags({
          // The Session was just created moments ago; a missing Session here is a defect, not a normal outcome.
          "Session.NotFoundError": Effect.die,
          "Session.PromptConflictError": () => fail("The run's prompt could not be admitted"),
          // The Project was archived between creating the Session and admitting its prompt.
          "Project.ArchivedError": () => fail(archivedNote),
        }),
      )
      yield* recordOrDie(taskID, {
        lastRunAt: session.createdAt,
        lastSessionID: session.id,
        last_note: note ?? null,
        missedAt: null,
      })
      return session
    })

    const dismiss = Effect.fn("ScheduledTask.dismiss")(function* (taskID: ID) {
      return yield* record(taskID, { missedAt: null })
    })

    return Service.of({ create, get, list, update, delete: remove, run, dismiss })
  }),
)

/** Canonical member-bound Scheduled Task node. */
export const node = makeWorkspaceNode({
  service: Service,
  layer,
  deps: [Actor.binding, Database.node, Bus.node, Session.node, Catalog.node, Routing.node, InstructionEntry.node, Project.node],
})
