import { Bus } from "@bymorning/core/bus"
import {
  AccountTable,
  Database,
  ProjectTable,
  ScheduledTaskTable,
  UserTable,
  WorkspaceTable,
} from "@bymorning/core/database"
import { Project } from "@bymorning/core/project"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import { AccountSchema } from "@bymorning/schema/account"
import { ProjectSchema } from "@bymorning/schema/project"
import { UserSchema } from "@bymorning/schema/user"
import { WorkspaceSchema } from "@bymorning/schema/workspace"
import { NodeCrypto } from "@effect/platform-node"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { expect, it } from "vitest"
import { layer as storageLayer } from "../fixture/storage.js"
import { database } from "./graph.js"

const workspaceID = WorkspaceSchema.ID.ascending("wrk_archive_schedule")

it("skips a Scheduled Task while its Project is archived and resumes from the next occurrence on restore", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const databaseService = yield* Database.Service
      // Friday 12:00 UTC; the weekday schedule's next occurrence is Monday 08:00 UTC.
      const now = new Date("2026-09-18T12:00:00.000Z")
      const minutes = (count: number) => new Date(now.getTime() + count * 60_000)
      const accountID = AccountSchema.ID.create()
      const userID = UserSchema.ID.create()
      const defaultID = ProjectSchema.ID.create()
      const archivedID = ProjectSchema.ID.create()
      const tasks = { due: ScheduledTask.ID.create(), overdue: ScheduledTask.ID.create() }

      yield* databaseService.use("ScheduledTaskArchiveTest.setup", (db) =>
        Effect.gen(function* () {
          yield* db
            .insert(WorkspaceTable)
            .values({ id: workspaceID, name: "Archive", status: "active", timeCreated: now, timeUpdated: now })
          yield* db.insert(AccountTable).values({ id: accountID, status: "active" })
          yield* db
            .insert(UserTable)
            .values({ id: userID, workspaceId: workspaceID, accountId: accountID, role: "admin" })
          yield* db.insert(ProjectTable).values([
            { workspaceID, id: defaultID, name: "Default", timeCreated: minutes(-60), timeUpdated: minutes(-60) },
            { workspaceID, id: archivedID, name: "Launch", timeCreated: now, timeUpdated: now },
          ])
          for (const [id, nextRunAt] of [
            [tasks.due, minutes(-5)],
            [tasks.overdue, minutes(-30)],
          ] as const)
            yield* db.insert(ScheduledTaskTable).values({
              workspaceID,
              id,
              userID,
              projectID: archivedID,
              name: "Briefing",
              prompt: "Summarize the day",
              cron: "0 8 * * 1-5",
              timezone: "UTC",
              enabled: true,
              nextRunAt,
              timeCreated: now,
              timeUpdated: now,
            })
        }),
      )

      const read = (id: ScheduledTask.ID) =>
        databaseService
          .use("ScheduledTaskArchiveTest.read", (db) =>
            db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.id, id)),
          )
          .pipe(
            Effect.orDie,
            Effect.map(([row]) => row!),
          )

      const projects = yield* Project.Service
      yield* projects.update({ projectID: archivedID, archived: true })

      const due = yield* ScheduledTask.Due.Service
      expect(yield* due.claim(now)).toEqual([])
      const monday = new Date("2026-09-21T08:00:00.000Z")
      for (const id of [tasks.due, tasks.overdue]) {
        const row = yield* read(id)
        // Skipped, not missed: the occurrence advanced without recording a miss and the task stays enabled.
        expect(row.nextRunAt?.getTime()).toBe(monday.getTime())
        expect(row.missedAt).toBeNull()
        expect(row.enabled).toBe(true)
        expect(row.lastRunAt).toBeNull()
      }
      // A later tick while still archived skips again, still without a miss.
      const tuesday = new Date("2026-09-22T08:00:00.000Z")
      expect(yield* due.claim(new Date(monday.getTime() + 60_000))).toEqual([])
      expect((yield* read(tasks.due)).nextRunAt?.getTime()).toBe(tuesday.getTime())
      expect((yield* read(tasks.due)).missedAt).toBeNull()

      yield* projects.update({ projectID: archivedID, archived: false })
      const claims = yield* due.claim(new Date(tuesday.getTime() + 60_000))
      expect(claims.map((claim) => claim.taskID).toSorted()).toEqual([tasks.due, tasks.overdue].toSorted())
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ScheduledTask.Due.layer,
          Project.layer(workspaceID).pipe(
            Layer.provide(Layer.mergeAll(Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie), storageLayer)),
          ),
        ).pipe(Layer.provideMerge(database)),
      ),
      Effect.scoped,
    ),
  )
}, 60_000)
