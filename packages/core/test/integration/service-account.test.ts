import { Database } from "@bymorning/core/database"
import { ServiceAccount } from "@bymorning/core/service-account"
import * as Workspace from "@bymorning/schema/workspace"
import { PgClient } from "@effect/sql-pg"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer, Redacted } from "effect"
import { describe, expect, test } from "vitest"
import { ApiKeyTable } from "../../src/database/schema/api-key.sql.js"
import { ServiceAccountTable } from "../../src/database/schema/service-account.sql.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const database = Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(process.env.DATABASE_URL) })))
const layer = Layer.merge(database, ServiceAccount.layer.pipe(Layer.provide(database)))

describe("ServiceAccount", () => {
  test("manages accounts and authenticates hash-only API keys", async () => {
    const workspaceID = Workspace.ID.create()

    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const serviceAccounts = yield* ServiceAccount.Service
        yield* database
          .use("ServiceAccountTest.setup", (db) =>
            db.execute(
              sql`insert into workspace (id, name, status) values (${workspaceID}, 'Service account test', 'active')`,
            ),
          )
          .pipe(Effect.orDie)

        const account = yield* serviceAccounts.create({
          workspaceID,
          name: "CI",
          policy: { models: ["claude-sonnet"], rpm: 10 },
        })
        expect(account.status).toBe("active")
        expect(yield* serviceAccounts.list(workspaceID)).toEqual([account])
        expect(yield* serviceAccounts.listSummaries(workspaceID)).toEqual([{ ...account, keyCount: 0 }])
        expect(yield* serviceAccounts.get(workspaceID, account.id)).toEqual(account)

        const updated = yield* serviceAccounts.update(workspaceID, account.id, {
          name: "Deploy",
          policy: { rpm: 20 },
        })
        expect(updated).toMatchObject({ name: "Deploy", policy: { rpm: 20 } })

        const created = yield* serviceAccounts.key.create(workspaceID, account.id, { name: "Production" })
        expect(created.secret).toMatch(/^bm_[A-Za-z0-9_-]{43}$/)
        expect(created.key.prefix).toBe(created.secret.slice(0, 12))
        expect(yield* serviceAccounts.key.list(workspaceID, account.id)).toEqual([created.key])
        expect(yield* serviceAccounts.listSummaries(workspaceID)).toEqual([{ ...updated, keyCount: 1 }])
        expect(yield* serviceAccounts.key.verify(created.secret)).toMatchObject({
          workspaceID,
          account: { id: account.id, name: "Deploy" },
          keyID: created.key.id,
        })

        const [used] = yield* database
          .use("ServiceAccountTest.used", (db) =>
            db
              .select({ timeUsed: ApiKeyTable.timeUsed })
              .from(ApiKeyTable)
              .where(eq(ApiKeyTable.id, created.key.id)),
          )
          .pipe(Effect.orDie)
        expect(used?.timeUsed).toBeInstanceOf(Date)

        expect(yield* serviceAccounts.key.verify("bm_unknown")).toBeUndefined()
        yield* serviceAccounts.key.revoke(workspaceID, created.key.id)
        expect(yield* serviceAccounts.key.verify(created.secret)).toBeUndefined()
        expect((yield* serviceAccounts.key.list(workspaceID, account.id))[0]?.timeRevoked).toBeInstanceOf(Date)

        const expired = yield* serviceAccounts.key.create(workspaceID, account.id, {
          name: "Expired",
          timeExpires: new Date(Date.now() - 1_000),
        })
        expect(yield* serviceAccounts.key.verify(expired.secret)).toBeUndefined()

        const suspended = yield* serviceAccounts.key.create(workspaceID, account.id, { name: "Suspended" })
        yield* serviceAccounts.update(workspaceID, account.id, { status: "suspended" })
        expect(yield* serviceAccounts.key.verify(suspended.secret)).toBeUndefined()
        yield* serviceAccounts.update(workspaceID, account.id, { status: "active" })

        yield* serviceAccounts.remove(workspaceID, account.id)
        expect(yield* serviceAccounts.get(workspaceID, account.id)).toBeUndefined()
        expect(yield* serviceAccounts.list(workspaceID)).toEqual([])
        expect(yield* serviceAccounts.key.list(workspaceID, account.id)).toEqual([])
        expect(yield* serviceAccounts.key.verify(suspended.secret)).toBeUndefined()

        const [removed] = yield* database
          .use("ServiceAccountTest.removed", (db) =>
            db
              .select({ timeDeleted: ServiceAccountTable.timeDeleted })
              .from(ServiceAccountTable)
              .where(eq(ServiceAccountTable.id, account.id)),
          )
          .pipe(Effect.orDie)
        expect(removed?.timeDeleted).toBeInstanceOf(Date)

        yield* database
          .use("ServiceAccountTest.cleanup", (db) =>
            db.execute(sql`delete from workspace where id = ${workspaceID}`),
          )
          .pipe(Effect.orDie)
      }).pipe(Effect.provide(layer)),
    )
  })
})
