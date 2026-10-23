import { Database } from "@bymorning/core/database"
import * as Account from "@bymorning/schema/account"
import * as Project from "@bymorning/schema/project"
import * as User from "@bymorning/schema/user"
import * as Workspace from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { afterAll, beforeAll } from "vitest"
import { database } from "./graph.js"

export function workspaceFixture() {
  const accountID = Account.ID.create()
  const workspaceID = Workspace.ID.create()
  const userID = User.ID.create()
  const projectID = Project.ID.create()

  beforeAll(() =>
    Effect.runPromise(
      Database.Service.use((database) =>
        database.use("WorkspaceFixture.setup", (db) =>
          Effect.gen(function* () {
            yield* db.execute(sql`insert into account (id, status) values (${accountID}, 'active')`)
            yield* db.execute(
              sql`insert into workspace (id, name, status) values (${workspaceID}, 'Integration test', 'active')`,
            )
            yield* db.execute(sql`insert into "user" (id, workspace_id, account_id, role)
              values (${userID}, ${workspaceID}, ${accountID}, 'admin')`)
            yield* db.execute(
              sql`insert into project (workspace_id, id, name) values (${workspaceID}, ${projectID}, 'Integration test')`,
            )
          }),
        ),
      ).pipe(Effect.provide(database)),
    ),
  )

  afterAll(() =>
    Effect.runPromise(
      Database.Service.use((database) =>
        database.use("WorkspaceFixture.cleanup", (db) =>
          Effect.gen(function* () {
            yield* db.execute(sql`delete from session where workspace_id = ${workspaceID}`)
            yield* db.execute(sql`delete from project where workspace_id = ${workspaceID}`)
            yield* db.execute(sql`delete from workspace where id = ${workspaceID}`)
            yield* db.execute(sql`delete from account where id = ${accountID}`)
          }),
        ),
      ).pipe(Effect.provide(database)),
    ),
  )

  return { workspaceID, userID }
}
