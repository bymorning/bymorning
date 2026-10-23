/** Process-global claiming of Scheduled Tasks whose next occurrence has arrived. */
export * as Due from "./due.js"

import { Account } from "@bymorning/schema/account"
import { ScheduledTask } from "@bymorning/schema/scheduled-task"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { and, eq, lte } from "drizzle-orm"
import { Context, Duration, Effect, Layer, Result } from "effect"
import { Database } from "../database.js"
import { AccountTable } from "../database/schema/account.sql.js"
import { ProjectTable } from "../database/schema/project.sql.js"
import { ScheduledTaskTable } from "../database/schema/scheduled-task.sql.js"
import { UserTable } from "../database/schema/user.sql.js"
import { WorkspaceTable } from "../database/schema/workspace.sql.js"
import { Schedule } from "./schedule.js"

/** A Scheduled Task claimed for execution as its owning member. */
export interface Claim {
  readonly taskID: ScheduledTask.ID
  readonly owner: {
    readonly workspaceID: Workspace.ID
    readonly accountID: Account.ID
    readonly userID: User.ID
    /** The member's Role as claimed; the run executes with exactly this authority. */
    readonly role: User.Role
  }
}

/** A run due longer ago than this is recorded as missed instead of executed. */
export const MissGrace = Duration.minutes(10)

export interface Interface {
  /**
   * Advance every enabled task whose occurrence has arrived and return those that should run now. Each task is
   * advanced with a compare-and-set on its due time, so overlapping processes never claim the same occurrence.
   * Occurrences overdue beyond the grace, or owned by an unavailable member, are marked missed and not returned.
   * Occurrences of a task whose Project is archived are skipped: they advance without running or recording a miss,
   * so restoring the Project continues from the next future occurrence.
   */
  readonly claim: (now: Date) => Effect.Effect<ReadonlyArray<Claim>>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ScheduledTask.Due") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const claim = Effect.fn("ScheduledTask.Due.claim")(function* (now: Date) {
      const rows = yield* database
        .use("ScheduledTask.Due.select", (db) =>
          db
            .select({
              workspaceID: ScheduledTaskTable.workspaceID,
              id: ScheduledTaskTable.id,
              userID: ScheduledTaskTable.userID,
              cron: ScheduledTaskTable.cron,
              timezone: ScheduledTaskTable.timezone,
              nextRunAt: ScheduledTaskTable.nextRunAt,
              accountID: UserTable.accountId,
              role: UserTable.role,
              userDeleted: UserTable.timeDeleted,
              accountStatus: AccountTable.status,
              accountDeleted: AccountTable.timeDeleted,
              workspaceStatus: WorkspaceTable.status,
              workspaceDeleted: WorkspaceTable.timeDeleted,
              projectArchived: ProjectTable.archivedAt,
            })
            .from(ScheduledTaskTable)
            .innerJoin(
              UserTable,
              and(eq(UserTable.workspaceId, ScheduledTaskTable.workspaceID), eq(UserTable.id, ScheduledTaskTable.userID)),
            )
            .leftJoin(AccountTable, eq(AccountTable.id, UserTable.accountId))
            .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, ScheduledTaskTable.workspaceID))
            .innerJoin(
              ProjectTable,
              and(
                eq(ProjectTable.workspaceID, ScheduledTaskTable.workspaceID),
                eq(ProjectTable.id, ScheduledTaskTable.projectID),
              ),
            )
            .where(and(eq(ScheduledTaskTable.enabled, true), lte(ScheduledTaskTable.nextRunAt, now))),
        )
        .pipe(Effect.orDie)
      const claims: Claim[] = []
      for (const row of rows) {
        if (row.nextRunAt === null) continue
        const due = row.nextRunAt
        const parsed = Schedule.parse(row.cron, row.timezone)
        const available =
          row.accountID !== null &&
          row.userDeleted === null &&
          row.accountStatus === "active" &&
          row.accountDeleted === null &&
          row.workspaceStatus === "active" &&
          row.workspaceDeleted === null
        const overdue = now.getTime() - due.getTime() > Duration.toMillis(MissGrace)
        const archived = row.projectArchived !== null
        const runnable = Result.isSuccess(parsed) && available && !overdue && !archived
        const advanced = yield* database
          .use("ScheduledTask.Due.advance", (db) =>
            db
              .update(ScheduledTaskTable)
              .set(
                Result.isSuccess(parsed)
                  ? { nextRunAt: Schedule.next(parsed.success, now), ...(runnable || archived ? {} : { missedAt: due }) }
                  : { enabled: false, nextRunAt: null, last_note: "Schedule could not be parsed; the task was paused" },
              )
              .where(
                and(
                  eq(ScheduledTaskTable.workspaceID, row.workspaceID),
                  eq(ScheduledTaskTable.id, row.id),
                  eq(ScheduledTaskTable.nextRunAt, due),
                ),
              )
              .returning({ id: ScheduledTaskTable.id }),
          )
          .pipe(Effect.orDie)
        if (advanced.length === 0) continue
        if (!available) {
          yield* Effect.logWarning("Skipping Scheduled Task for unavailable owner").pipe(
            Effect.annotateLogs({ workspaceID: row.workspaceID, userID: row.userID, taskID: row.id }),
          )
        }
        if (runnable && row.accountID !== null) {
          claims.push({
            taskID: row.id,
            owner: { workspaceID: row.workspaceID, accountID: row.accountID, userID: row.userID, role: row.role },
          })
        }
      }
      return claims
    })
    return Service.of({ claim })
  }),
)
