import { PgClient } from "@effect/sql-pg"
import { Effect } from "effect"
import { readFile } from "node:fs/promises"
import { expect, test } from "vitest"
import { TestDatabase } from "../src/database.js"

test("the role migration preserves memberships and converts legacy owners to admins", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* TestDatabase.shared
      const url = yield* database.create()
      const migration = yield* Effect.tryPromise(() => readFile(new URL(
        "../../core/src/database/migration/20260909045851_member-role/migration.sql",
        import.meta.url,
      ), "utf8"))
      yield* Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        // Restore the legacy constraint/data to exercise the committed upgrade SQL.
        yield* sql.unsafe(`
          ALTER TABLE "user" DROP CONSTRAINT user_role_check;
          ALTER TABLE "user" ADD CONSTRAINT user_role_check CHECK (role IN ('owner', 'admin', 'member'));
          INSERT INTO account (id, status) VALUES ('acc_legacy', 'active');
          INSERT INTO workspace (id, name, status) VALUES ('wrk_legacy', 'Legacy', 'active');
          INSERT INTO "user" (id, workspace_id, account_id, role)
            VALUES ('usr_legacy', 'wrk_legacy', 'acc_legacy', 'owner');
          INSERT INTO "user" (id, workspace_id, email, role)
            VALUES ('usr_admin', 'wrk_legacy', 'admin@example.com', 'admin'),
                   ('usr_member', 'wrk_legacy', 'member@example.com', 'member');
        `)
        yield* sql.withTransaction(Effect.forEach(
          migration.split("--> statement-breakpoint"),
          (statement) => sql.unsafe(statement),
          { discard: true },
        ))
        expect(yield* sql.unsafe('SELECT id, role FROM "user" ORDER BY id')).toEqual([
          { id: "usr_admin", role: "admin" },
          { id: "usr_legacy", role: "admin" },
          { id: "usr_member", role: "member" },
        ])
        expect(yield* sql.unsafe("UPDATE \"user\" SET role = 'owner' WHERE id = 'usr_legacy'").pipe(
          Effect.result,
        )).toMatchObject({ _tag: "Failure" })
      }).pipe(Effect.provide(PgClient.layer({ url, maxConnections: 1 })))
    }).pipe(Effect.scoped),
    { signal },
  )
})
