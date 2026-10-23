import { PgClient } from "@effect/sql-pg"
import { Effect, Exit, Redacted, Scope } from "effect"
import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { promisify } from "node:util"
import { expect, test } from "vitest"
import { TestDatabase } from "../src/database.js"

const command = promisify(execFile)

const query = (url: Redacted.Redacted<string>, statement: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient
    return yield* sql.unsafe(statement)
  }).pipe(Effect.provide(PgClient.layer({ url, maxConnections: 1, connectTimeout: "1 second" })))

const select = (url: Redacted.Redacted<string>, database: string) => {
  const target = new URL(Redacted.value(url))
  target.pathname = database
  return Redacted.make(target.href)
}

test("one worker creates separately migrated databases and disposes each database at its own scope", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* TestDatabase.make
      const firstScope = yield* Scope.fork(yield* Effect.scope)
      const first = yield* worker.create().pipe(Scope.provide(firstScope))
      const second = yield* worker.create()
      expect(new URL(Redacted.value(first)).host).toBe(new URL(Redacted.value(second)).host)
      expect(Redacted.value(first)).not.toBe(Redacted.value(second))

      const migrations = yield* Effect.promise(() =>
        readdir(new URL("../../../packages/core/src/database/migration", import.meta.url), { recursive: true }),
      )
      const history = yield* query(first, "select count(*)::int as count from drizzle.__drizzle_migrations")
      expect(history).toEqual([{ count: migrations.filter((entry) => entry.endsWith("/migration.sql")).length }])
      yield* query(first, "insert into account (id, status) values ('acc_fixture', 'active')")
      expect(yield* query(first, "select id from account")).toEqual([{ id: "acc_fixture" }])
      expect(yield* query(second, "select id from account")).toEqual([])

      yield* Scope.close(firstScope, Exit.void)
      const names = yield* query(select(second, "postgres"), "select datname from pg_database")
      expect(names).not.toContainEqual({ datname: new URL(Redacted.value(first)).pathname.slice(1) })
      expect(names).toContainEqual({ datname: new URL(Redacted.value(second)).pathname.slice(1) })
      expect(yield* query(second, "select id from account")).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("the run's shared server clones its migrated template per database and drops each at its own scope", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      expect(process.env[TestDatabase.variable]).toBeDefined()
      const shared = yield* TestDatabase.shared
      const firstScope = yield* Scope.fork(yield* Effect.scope)
      const first = yield* shared.create().pipe(Scope.provide(firstScope))
      const second = yield* shared.create()
      const empty = yield* shared.create({ empty: true })
      expect(new URL(Redacted.value(first)).host).toBe(new URL(Redacted.value(second)).host)
      expect(new Set([first, second, empty].map(Redacted.value)).size).toBe(3)

      const migrations = yield* Effect.promise(() =>
        readdir(new URL("../../../packages/core/src/database/migration", import.meta.url), { recursive: true }),
      )
      const history = yield* query(first, "select count(*)::int as count from drizzle.__drizzle_migrations")
      expect(history).toEqual([{ count: migrations.filter((entry) => entry.endsWith("/migration.sql")).length }])
      yield* query(first, "insert into account (id, status) values ('acc_fixture', 'active')")
      expect(yield* query(first, "select id from account")).toEqual([{ id: "acc_fixture" }])
      expect(yield* query(second, "select id from account")).toEqual([])
      expect(
        yield* query(
          empty,
          "select count(*)::int as count from information_schema.tables where table_schema = 'public'",
        ),
      ).toEqual([{ count: 0 }])

      const admin = select(second, "postgres")
      expect(
        yield* query(
          admin,
          `select datallowconn, datistemplate, (select count(*)::int from pg_stat_activity where datname = '${TestDatabase.template}') as backends
           from pg_database where datname = '${TestDatabase.template}'`,
        ),
      ).toEqual([{ datallowconn: false, datistemplate: true, backends: 0 }])

      yield* Scope.close(firstScope, Exit.void)
      const names = yield* query(admin, "select datname from pg_database")
      expect(names).not.toContainEqual({ datname: new URL(Redacted.value(first)).pathname.slice(1) })
      expect(names).toContainEqual({ datname: new URL(Redacted.value(second)).pathname.slice(1) })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("separate workers own separate PostgreSQL containers and remove them on disposal", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const firstScope = yield* Scope.fork(yield* Effect.scope)
      const first = yield* Effect.gen(function* () {
        const worker = yield* TestDatabase.make
        return yield* worker.create()
      }).pipe(Scope.provide(firstScope))
      const secondWorker = yield* TestDatabase.make
      const second = yield* secondWorker.create()
      const port = new URL(Redacted.value(first)).port
      expect(port).not.toBe(new URL(Redacted.value(second)).port)
      const containers = yield* Effect.promise(() => command("docker", ["ps", "--format", "{{.ID}} {{.Ports}}"]))
      const firstContainer = containers.stdout
        .split("\n")
        .find((line) => line.includes(`127.0.0.1:${port}->`))
        ?.split(" ")[0]
      expect(firstContainer).toBeDefined()
      if (firstContainer === undefined) throw new Error("Missing test PostgreSQL container")

      yield* Scope.close(firstScope, Exit.void)
      const removed = yield* Effect.tryPromise(() => command("docker", ["inspect", firstContainer])).pipe(Effect.result)
      expect(removed._tag).toBe("Failure")
      expect(yield* query(second, "select id from account")).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("a failed migration removes its database immediately while the worker remains usable", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* TestDatabase.make
      const existing = yield* worker.create()
      const admin = select(existing, "postgres")
      const template = select(existing, "template1")
      const before = yield* query(admin, "select datname from pg_database order by datname")
      // A conflicting table inherited from PostgreSQL's template makes the real
      // baseline migration fail after the new database has been acquired.
      yield* query(template, "create table account (invalid boolean)")
      const failed = yield* worker.create().pipe(Effect.result)
      expect(failed._tag).toBe("Failure")
      if (failed._tag === "Failure") {
        expect(failed.failure).toBeInstanceOf(TestDatabase.SetupError)
        expect(failed.failure.stage).toBe("migration")
      }
      expect(yield* query(admin, "select datname from pg_database order by datname")).toEqual(before)
      yield* query(template, "drop table account")
      const recovered = yield* worker.create()
      expect(yield* query(recovered, "select id from account")).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
})
