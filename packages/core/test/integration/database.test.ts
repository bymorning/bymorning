import { Database } from "@bymorning/core/database"
import { sql } from "drizzle-orm"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Logger, Ref, Schema } from "effect"
import { expect, test } from "vitest"
import { database } from "./graph.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const tableName = (label: string) => `database_${label}_${crypto.randomUUID().replaceAll("-", "")}`
const resultRows = (result: object): unknown => ("rows" in result ? result.rows : result)

test("use executes against the active transaction", async () => {
  const name = tableName("active")

  const count = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      return yield* database.transact(
        Effect.gen(function* () {
          yield* database.use("create", (executor) =>
            executor.execute(sql.raw(`create temporary table ${name} (value integer not null)`)),
          )
          yield* database.use("insert", (executor) => executor.execute(sql.raw(`insert into ${name} values (1)`)))
          return yield* database.use("count", (executor) =>
            executor.execute<{ count: number }>(sql.raw(`select count(*)::int as count from ${name}`)),
          )
        }),
      )
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ count: Schema.Finite })))(resultRows(count))
  expect(rows[0]?.count).toBe(1)
})

test("typed transaction failure is preserved and rolls back", async () => {
  const name = tableName("failure")
  const rollback = { _tag: "ExpectedRollback" } as const

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const error = yield* database
        .transact(
          database
            .use("create", (executor) => executor.execute(sql.raw(`create table ${name} (value integer not null)`)))
            .pipe(Effect.andThen(Effect.fail(rollback))),
        )
        .pipe(Effect.flip)
      const relation = yield* database.use("verify", (executor) =>
        executor.execute<{ relation: string | null }>(sql`select to_regclass(${name})::text as relation`),
      )
      yield* database.use("cleanup", (executor) => executor.execute(sql.raw(`drop table if exists ${name}`)))
      return { error, relation }
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ relation: Schema.NullOr(Schema.String) })))(
    resultRows(result.relation),
  )
  expect(result.error).toBe(rollback)
  expect(rows[0]?.relation).toBeNull()
})

test.each([
  ["defect", Effect.die("rollback defect")],
  ["interrupt", Effect.interrupt],
] as const)("%s rolls back the active transaction", async (label, failure) => {
  const name = tableName(label)

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database
        .transact(
          database
            .use("create", (executor) => executor.execute(sql.raw(`create table ${name} (value integer not null)`)))
            .pipe(Effect.andThen(failure)),
        )
        .pipe(Effect.exit)
      const relation = yield* database.use("verify", (executor) =>
        executor.execute<{ relation: string | null }>(sql`select to_regclass(${name})::text as relation`),
      )
      const rows = yield* Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ relation: Schema.NullOr(Schema.String) })),
      )(resultRows(relation)).pipe(Effect.orDie)
      expect(rows[0]?.relation).toBeNull()
    }).pipe(Effect.provide(database), Effect.orDie),
  )
})

test("nested transactions pass through and the outer transaction owns rollback", async () => {
  const name = tableName("nested")
  const rollback = { _tag: "OuterRollback" } as const
  let outerExecutor: Database.Executor | undefined
  let innerExecutor: Database.Executor | undefined

  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      return yield* database
        .transact(
          Effect.gen(function* () {
            yield* database.use("outer", (executor) => {
              outerExecutor = executor
              return executor.execute(sql.raw(`create table ${name} (value integer not null)`))
            })
            yield* database.transact(
              database.use("inner", (executor) => {
                innerExecutor = executor
                return executor.execute(sql.raw(`insert into ${name} values (1)`))
              }),
            )
            return yield* Effect.fail(rollback)
          }),
        )
        .pipe(Effect.flip)
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  const relation = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      return yield* database.use("verify", (executor) =>
        executor
          .execute<{ relation: string | null }>(sql`select to_regclass(${name})::text as relation`)
          .pipe(
            Effect.tap(() =>
              database.use("cleanup", (active) => active.execute(sql.raw(`drop table if exists ${name}`))),
            ),
          ),
      )
    }).pipe(Effect.provide(database), Effect.orDie),
  )
  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ relation: Schema.NullOr(Schema.String) })))(
    resultRows(relation),
  )

  expect(error).toBe(rollback)
  expect(innerExecutor).toBe(outerExecutor)
  expect(rows[0]?.relation).toBeNull()
})

test("afterCommit runs once after the outer transaction commits", async () => {
  const name = tableName("after_commit")
  const observed: Array<string> = []
  let transactionExecutor: Database.Executor | undefined
  let callbackExecutor: Database.Executor | undefined

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.transact(
        Effect.gen(function* () {
          yield* database.use("create", (executor) => {
            transactionExecutor = executor
            return executor.execute(sql.raw(`create table ${name} (value integer not null)`))
          })
          yield* database.afterCommit(
            database.use("observe", (executor) => {
              callbackExecutor = executor
              observed.push("committed")
              return Effect.void
            }),
          )
          expect(observed).toEqual([])
        }),
      )
      expect(observed).toEqual(["committed"])
      yield* database.use("cleanup", (executor) => executor.execute(sql.raw(`drop table ${name}`)))
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  expect(callbackExecutor).not.toBe(transactionExecutor)
})

test("nested transactions share afterCommit registration and preserve ordering", async () => {
  const observed: Array<number> = []

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.transact(
        Effect.gen(function* () {
          yield* database.afterCommit(Effect.sync(() => observed.push(1)))
          yield* database.transact(database.afterCommit(Effect.sync(() => observed.push(2))))
          yield* database.afterCommit(Effect.sync(() => observed.push(3)))
          expect(observed).toEqual([])
        }),
      )
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  expect(observed).toEqual([1, 2, 3])
})

test("afterCommit does not run when a transaction fails with a typed error", async () => {
  const observed: Array<string> = []
  const rollback = { _tag: "ExpectedRollback" } as const

  const error = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      return yield* database
        .transact(
          database
            .afterCommit(Effect.sync(() => observed.push("published")))
            .pipe(Effect.andThen(Effect.fail(rollback))),
        )
        .pipe(Effect.flip)
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  expect(error).toBe(rollback)
  expect(observed).toEqual([])
})

test.each(["before", "during"] as const)(
  "a pending external interruption %s an afterCommit callback cannot prevent state publication",
  async (timing) => {
    const name = tableName(`cb_int_${timing}`)

    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const interrupting = yield* Deferred.make<void>()
        const published = yield* Deferred.make<void>()
        const state = yield* Ref.make(false)
        const publish = Ref.set(state, true).pipe(Effect.andThen(Deferred.succeed(published, undefined)))
        const protectedCallback = Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(timing === "during" ? publish : Effect.void),
        )

        const worker = yield* database
          .transact(
            Effect.gen(function* () {
              yield* database.use("create", (executor) =>
                executor.execute(sql.raw(`create table ${name} (value integer not null)`)),
              )
              yield* database.afterCommit(protectedCallback)
              if (timing === "before") yield* database.afterCommit(publish)
              return "committed" as const
            }),
          )
          .pipe(Effect.forkChild)

        yield* Deferred.await(entered)
        const interruption = yield* Deferred.succeed(interrupting, undefined).pipe(
          Effect.andThen(Fiber.interrupt(worker)),
          Effect.forkChild,
        )
        yield* Deferred.await(interrupting)
        yield* Effect.yieldNow
        yield* Deferred.succeed(release, undefined)
        yield* Deferred.await(published)
        yield* Fiber.join(interruption)

        const workerExit = yield* Fiber.await(worker)
        expect(Exit.isFailure(workerExit) && Cause.hasInterrupts(workerExit.cause)).toBe(true)
        expect(yield* Ref.get(state)).toBe(true)
        const relation = yield* database.use("verify", (executor) =>
          executor.execute<{ relation: string | null }>(sql`select to_regclass(${name})::text as relation`),
        )
        const rows = yield* Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ relation: Schema.NullOr(Schema.String) })),
        )(resultRows(relation)).pipe(Effect.orDie)
        expect(rows[0]?.relation).toBe(name)
        yield* database.use("cleanup", (executor) => executor.execute(sql.raw(`drop table ${name}`)))
      }).pipe(Effect.scoped, Effect.provide(database), Effect.orDie),
    )
  },
)

test.each([
  ["defect", Effect.die("transaction defect")],
  ["interruption", Effect.interrupt],
] as const)("afterCommit does not run after transaction %s", async (_label, failure) => {
  const observed: Array<string> = []

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database
        .transact(database.afterCommit(Effect.sync(() => observed.push("published"))).pipe(Effect.andThen(failure)))
        .pipe(Effect.exit)
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  expect(observed).toEqual([])
})

test.each([
  ["defect", Effect.die("callback secret must not be logged")],
  ["interruption", Effect.interrupt],
] as const)(
  "an afterCommit %s does not replace the committed result or stop later callbacks",
  async (_label, failure) => {
    const name = tableName("callback_defect")
    const observed: Array<string> = []

    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const result = yield* database.transact(
          Effect.gen(function* () {
            yield* database.use("create", (executor) =>
              executor.execute(sql.raw(`create table ${name} (value integer not null)`)),
            )
            yield* database.afterCommit(failure)
            yield* database.afterCommit(Effect.sync(() => observed.push("later")))
            return "committed result" as const
          }),
        )
        expect(result).toBe("committed result")

        const relation = yield* database.use("verify", (executor) =>
          executor.execute<{ relation: string | null }>(sql`select to_regclass(${name})::text as relation`),
        )
        const rows = yield* Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ relation: Schema.NullOr(Schema.String) })),
        )(resultRows(relation)).pipe(Effect.orDie)
        expect(rows[0]?.relation).toBe(name)
        yield* database.use("cleanup", (executor) => executor.execute(sql.raw(`drop table ${name}`)))
      }).pipe(Effect.provide(database), Effect.orDie),
    )

    expect(observed).toEqual(["later"])
  },
)

test("afterCommit runs immediately outside a transaction", async () => {
  const observed: Array<string> = []

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.afterCommit(Effect.sync(() => observed.push("published")))
      expect(observed).toEqual(["published"])
    }).pipe(Effect.provide(database), Effect.orDie),
  )
})

test.each([
  ["defect", Effect.die("outside defect")],
  ["interruption", Effect.interrupt],
] as const)("an immediate afterCommit %s remains observable", async (_label, failure) => {
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      return yield* database.afterCommit(failure).pipe(Effect.exit)
    }).pipe(Effect.provide(database), Effect.orDie),
  )

  expect(exit._tag).toBe("Failure")
})

test("afterCommit logs only safe callback cause categories", async () => {
  const secret = "sensitive SQL and parameters"
  const messages: Array<string> = []
  const logger = Logger.make(({ message }) => messages.push(String(message)))

  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.transact(database.afterCommit(Effect.die(secret)))
    }).pipe(Effect.provide(Layer.merge(database, Logger.layer([logger]))), Effect.orDie),
  )

  expect(messages.join(" ")).toContain("Database afterCommit callback failed")
  expect(messages.join(" ")).not.toContain(secret)
})
