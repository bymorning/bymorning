import {
  AccountTable,
  Database,
  ToolUsageTable,
  UserTable,
  WorkspaceTable,
} from "@bymorning/core/database"
import { ToolUsage } from "@bymorning/core/tool-usage"
import { Account } from "@bymorning/schema/account"
import { Session } from "@bymorning/schema/session"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { ToolUsageSchema } from "@bymorning/schema/tool-usage"
import { it } from "@effect/vitest"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { randomUUID } from "node:crypto"
import { beforeEach, expect } from "vitest"
import { database } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const workspaceID = Workspace.ID.make("wrk_tool_usage_test")
const accountID = Account.ID.make("acc_tool_usage_test")
const firstUserID = User.ID.make("usr_tool_usage_first")
const secondUserID = User.ID.make("usr_tool_usage_second")
const sessionID = Session.ID.make(randomUUID())
const layer = ToolUsage.layer(workspaceID).pipe(Layer.provideMerge(database))
/** Tool Usage IDs are UUIDs; fixed values keep the cursor-order assertion deterministic. */
const usageID = (index: number) =>
  ToolUsageSchema.ID.make(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)

beforeEach(async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("toolUsageTestReset", (db) =>
        Effect.gen(function* () {
          yield* db.delete(ToolUsageTable).where(eq(ToolUsageTable.workspaceID, workspaceID))
          yield* db.delete(UserTable).where(eq(UserTable.workspaceId, workspaceID))
          yield* db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID))
          yield* db.delete(AccountTable).where(eq(AccountTable.id, accountID))
          yield* db.insert(AccountTable).values({ id: accountID, status: "active" })
          yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Tool Usage", status: "active" })
          yield* db.insert(UserTable).values([
            {
              id: firstUserID,
              workspaceId: workspaceID,
              accountId: accountID,
              role: "admin",
            },
            {
              id: secondUserID,
              workspaceId: workspaceID,
              role: "member",
            },
          ])
        }),
      )
    }).pipe(Effect.provide(database), Effect.orDie),
  )
})

it.effect("projects immutable records and paginates with filter-bound cursors", () =>
  Effect.gen(function* () {
    const usage = yield* ToolUsage.Service
    const occurredAt = new Date("2026-09-03T12:00:00.000Z")

    const database = yield* Database.Service
    yield* database.use("toolUsageTestFixtures", (db) =>
      db.insert(ToolUsageTable).values([
        { id: usageID(1), workspaceID, userID: firstUserID, sessionID, tool: "read", status: "completed", occurredAt },
        { id: usageID(2), workspaceID, userID: firstUserID, sessionID, tool: "write", status: "error", occurredAt },
        { id: usageID(3), workspaceID, userID: secondUserID, sessionID: null, tool: "search", status: "completed", occurredAt: new Date("2026-09-04T12:00:00.000Z") },
      ]),
    )

    const first = yield* usage.records({ userID: firstUserID, sessionID, limit: 1 })
    expect(first.data).toHaveLength(1)
    expect(first.cursor).toBeDefined()
    const second = yield* usage.records({ userID: firstUserID, sessionID, limit: 1, cursor: first.cursor })
    expect(second.data).toHaveLength(1)
    expect(second.cursor).toBeUndefined()
    expect([...first.data, ...second.data].map((record) => record.id)).toEqual(
      [...first.data, ...second.data].map((record) => record.id).toSorted(),
    )
    expect((yield* usage.records({ userID: secondUserID })).data.map((record) => record.tool)).toEqual(["search"])
    expect(
      yield* usage.records({ userID: secondUserID, sessionID, cursor: first.cursor }).pipe(Effect.flip),
    ).toBeInstanceOf(ToolUsage.InvalidCursorError)

    expect(
      yield* database.use("toolUsageTestRows", (db) =>
        db
          .select()
          .from(ToolUsageTable)
          .where(and(eq(ToolUsageTable.workspaceID, workspaceID), eq(ToolUsageTable.userID, firstUserID))),
      ),
    ).toHaveLength(2)
  }).pipe(Effect.provide(layer), Effect.scoped, Effect.orDie),
)
