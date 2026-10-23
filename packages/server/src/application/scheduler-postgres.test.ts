import {
  Database,
  AccountTable,
  ProjectTable,
  ScheduledTaskTable,
  UserTable,
  WorkspaceTable,
} from "@bymorning/core/database"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import { AccountSchema } from "@bymorning/schema/account"
import { ProjectSchema } from "@bymorning/schema/project"
import { UserSchema } from "@bymorning/schema/user"
import { WorkspaceSchema } from "@bymorning/schema/workspace"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { expect, it } from "vitest"
import { postgres } from "../../test/postgres.js"

const database = postgres()

it("claims due Scheduled Tasks once, advances their schedules, and records misses", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const databaseService = yield* Database.Service
      // Friday 12:00 UTC; every weekday schedule advances to Monday 08:00 UTC.
      const now = new Date("2026-09-18T12:00:00.000Z")
      const minutes = (count: number) => new Date(now.getTime() + count * 60_000)

      const availableWorkspace = WorkspaceSchema.ID.ascending("wrk_scheduler_available")
      const deletedUserWorkspace = WorkspaceSchema.ID.ascending("wrk_scheduler_deleted_user")
      const suspendedAccountWorkspace = WorkspaceSchema.ID.ascending("wrk_scheduler_suspended")
      const workspaces = [availableWorkspace, deletedUserWorkspace, suspendedAccountWorkspace] as const
      const owners = new Map(
        workspaces.map((workspaceID) => [
          workspaceID,
          { accountID: AccountSchema.ID.create(), userID: UserSchema.ID.create(), projectID: ProjectSchema.ID.create() },
        ]),
      )
      const tasks = {
        due: ScheduledTask.ID.create(),
        future: ScheduledTask.ID.create(),
        disabled: ScheduledTask.ID.create(),
        overdue: ScheduledTask.ID.create(),
        broken: ScheduledTask.ID.create(),
        deletedUser: ScheduledTask.ID.create(),
        suspendedAccount: ScheduledTask.ID.create(),
      }
      const dueAt = minutes(-5)
      const overdueAt = minutes(-11)

      yield* databaseService.use("ScheduledTaskDueTest.setup", (db) =>
        Effect.gen(function* () {
          for (const workspaceID of workspaces) {
            const owner = owners.get(workspaceID)!
            yield* db.insert(WorkspaceTable).values({
              id: workspaceID,
              name: "Scheduler",
              status: "active",
              timeCreated: now,
              timeUpdated: now,
            })
            yield* db.insert(AccountTable).values({ id: owner.accountID, status: "active" })
            yield* db
              .insert(UserTable)
              .values({ id: owner.userID, workspaceId: workspaceID, accountId: owner.accountID, role: "admin" })
            yield* db.insert(ProjectTable).values({
              workspaceID,
              id: owner.projectID,
              name: "Default",
              timeCreated: now,
              timeUpdated: now,
            })
          }
          const owner = owners.get(availableWorkspace)!
          const task = (input: {
            readonly id: ScheduledTask.ID
            readonly workspaceID: WorkspaceSchema.ID
            readonly cron?: string
            readonly enabled?: boolean
            readonly nextRunAt: Date
          }) =>
            db.insert(ScheduledTaskTable).values({
              workspaceID: input.workspaceID,
              id: input.id,
              userID: owners.get(input.workspaceID)!.userID,
              projectID: owners.get(input.workspaceID)!.projectID,
              name: "Briefing",
              prompt: "Summarize the day",
              cron: input.cron ?? "0 8 * * 1-5",
              timezone: "UTC",
              enabled: input.enabled ?? true,
              nextRunAt: input.nextRunAt,
              timeCreated: now,
              timeUpdated: now,
            })
          yield* task({ id: tasks.due, workspaceID: availableWorkspace, nextRunAt: dueAt })
          yield* task({ id: tasks.future, workspaceID: availableWorkspace, nextRunAt: minutes(60) })
          yield* task({ id: tasks.disabled, workspaceID: availableWorkspace, enabled: false, nextRunAt: dueAt })
          yield* task({ id: tasks.overdue, workspaceID: availableWorkspace, nextRunAt: overdueAt })
          yield* task({ id: tasks.broken, workspaceID: availableWorkspace, cron: "not a cron", nextRunAt: dueAt })
          yield* task({ id: tasks.deletedUser, workspaceID: deletedUserWorkspace, nextRunAt: dueAt })
          yield* task({ id: tasks.suspendedAccount, workspaceID: suspendedAccountWorkspace, nextRunAt: dueAt })
          // Unavailable owners: the member was deleted, or the account is suspended.
          const deleted = owners.get(deletedUserWorkspace)!
          yield* db
            .update(UserTable)
            .set({ timeDeleted: now })
            .where(eq(UserTable.id, deleted.userID))
          const suspended = owners.get(suspendedAccountWorkspace)!
          yield* db
            .update(AccountTable)
            .set({ status: "suspended" })
            .where(eq(AccountTable.id, suspended.accountID))
        }),
      )

      yield* Effect.gen(function* () {
        const due = yield* ScheduledTask.Due.Service

        const first = yield* due.claim(now)
        const available = owners.get(availableWorkspace)!
        expect(first).toEqual([
          {
            taskID: tasks.due,
            owner: {
              workspaceID: availableWorkspace,
              accountID: available.accountID,
              userID: available.userID,
              role: "admin",
            },
          },
        ])

        const rows = yield* databaseService
          .use("ScheduledTaskDueTest.readback", (db) => db.select().from(ScheduledTaskTable))
          .pipe(Effect.orDie)
        const row = (id: ScheduledTask.ID) => {
          const found = rows.find((candidate) => candidate.id === id)
          if (found === undefined) throw new Error(`Missing Scheduled Task row: ${id}`)
          return found
        }

        // Claimed: the next occurrence moved strictly past `now`, with no recorded miss.
        expect(row(tasks.due).nextRunAt?.getTime()).toBeGreaterThan(now.getTime())
        expect(row(tasks.due).missedAt).toBeNull()
        expect(row(tasks.due).enabled).toBe(true)
        // Not yet due: untouched.
        expect(row(tasks.future).nextRunAt?.getTime()).toBe(minutes(60).getTime())
        expect(row(tasks.future).missedAt).toBeNull()
        // Disabled: never selected, untouched.
        expect(row(tasks.disabled).enabled).toBe(false)
        expect(row(tasks.disabled).nextRunAt?.getTime()).toBe(dueAt.getTime())
        expect(row(tasks.disabled).missedAt).toBeNull()
        // Overdue beyond the grace: missed at the old due time and rescheduled.
        expect(row(tasks.overdue).missedAt?.getTime()).toBe(overdueAt.getTime())
        expect(row(tasks.overdue).nextRunAt?.getTime()).toBeGreaterThan(now.getTime())
        // Unavailable owners: missed at the old due time and rescheduled.
        for (const id of [tasks.deletedUser, tasks.suspendedAccount]) {
          expect(row(id).missedAt?.getTime()).toBe(dueAt.getTime())
          expect(row(id).nextRunAt?.getTime()).toBeGreaterThan(now.getTime())
          expect(row(id).enabled).toBe(true)
        }
        // Unparsable schedule: paused with an explanatory note instead of claimed.
        expect(row(tasks.broken).enabled).toBe(false)
        expect(row(tasks.broken).nextRunAt).toBeNull()
        expect(row(tasks.broken).last_note).toBe("Schedule could not be parsed; the task was paused")
        expect(row(tasks.broken).missedAt).toBeNull()

        // Compare-and-set: a second claim at the same instant finds nothing due.
        expect(yield* due.claim(now)).toEqual([])
      }).pipe(
        Effect.provide(
          ScheduledTask.Due.layer.pipe(Layer.provide(Layer.succeed(Database.Service, databaseService))),
        ),
      )
    }).pipe(Effect.scoped, Effect.provide(database)),
  )
}, 60_000)
