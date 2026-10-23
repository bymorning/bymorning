import { Database } from "@bymorning/core/database"
import { Workspace } from "@bymorning/core/workspace"
import * as Account from "@bymorning/schema/account"
import { AccountActor } from "@bymorning/schema/actor"
import * as User from "@bymorning/schema/user"
import * as WorkspaceSchema from "@bymorning/schema/workspace"
import { eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { AccountTable } from "../../src/database/schema/account.sql.js"
import { UserTable } from "../../src/database/schema/user.sql.js"
import { WorkspaceTable } from "../../src/database/schema/workspace.sql.js"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { compile, database } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const layer = compile(LayerNode.group([Workspace.node, Database.node]))

test("persists optional globally unique Workspace slugs", async () => {
  const firstID = WorkspaceSchema.ID.create()
  const secondID = WorkspaceSchema.ID.create()
  const duplicateID = WorkspaceSchema.ID.create()
  const emptyID = WorkspaceSchema.ID.create()
  const slug = `test-${firstID}`

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("WorkspaceTest.slug", (db) =>
        Effect.gen(function* () {
          yield* db.insert(WorkspaceTable).values([
            { id: firstID, name: "First", slug, status: "active" },
            { id: secondID, name: "Second", slug: null, status: "active" },
          ])

          expect(
            yield* db
              .select({ id: WorkspaceTable.id, slug: WorkspaceTable.slug })
              .from(WorkspaceTable)
              .where(inArray(WorkspaceTable.id, [firstID, secondID])),
          ).toEqual(
            expect.arrayContaining([
              { id: firstID, slug },
              { id: secondID, slug: null },
            ]),
          )

          yield* db
            .insert(WorkspaceTable)
            .values({ id: duplicateID, name: "Duplicate", slug, status: "active" })
            .pipe(Effect.flip)
          yield* db
            .insert(WorkspaceTable)
            .values({ id: emptyID, name: "Empty slug", slug: "", status: "active" })
            .pipe(Effect.flip)
        }),
      )
    }).pipe(
      Effect.ensuring(
        Database.Service.use((database) =>
          database.use("WorkspaceTest.cleanup", (db) =>
            db.delete(WorkspaceTable).where(inArray(WorkspaceTable.id, [firstID, secondID, duplicateID, emptyID])),
          ),
        ).pipe(Effect.orDie),
      ),
      Effect.provide(database),
    ),
  )
})

test("lists the persisted Workspace name for an Account membership", async () => {
  const accountID = Account.ID.create()
  const workspaceID = WorkspaceSchema.ID.create()
  const userID = User.ID.create()

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("WorkspaceTest.setup", (db) =>
        Effect.gen(function* () {
          yield* db.insert(AccountTable).values({ id: accountID, status: "active" })
          yield* db.insert(WorkspaceTable).values({ id: workspaceID, name: "Named Workspace", status: "active" })
          yield* db.insert(UserTable).values({
            id: userID,
            accountId: accountID,
            workspaceId: workspaceID,
            role: "admin",
          })
        }),
      )

      expect(
        yield* (yield* Workspace.Service).list(new AccountActor({ type: "account", properties: { accountID } })),
      ).toEqual([{ id: workspaceID, name: "Named Workspace", status: "active", role: "admin" }])
    }).pipe(
      Effect.ensuring(
        Database.Service.use((database) =>
          database.use("WorkspaceTest.cleanup", (db) =>
            db
              .delete(WorkspaceTable)
              .where(eq(WorkspaceTable.id, workspaceID))
              .pipe(Effect.andThen(db.delete(AccountTable).where(eq(AccountTable.id, accountID))), Effect.orDie),
          ),
        ),
      ),
      Effect.provide(layer),
    ),
  )
})
