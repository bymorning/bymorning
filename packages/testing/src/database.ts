export * as TestDatabase from "./database.js"

import { PgClient } from "@effect/sql-pg"
import { Effect, Exit, Redacted, Schedule, Schema, Scope } from "effect"
import { execFile, execFileSync } from "node:child_process"
import { createConnection } from "node:net"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { run } from "../../../packages/server/src/migrator.js"

/** A PostgreSQL server that creates independently scoped databases. */
export interface Interface {
  /** Create a fresh database, removing it when the caller's scope closes. */
  readonly create: (input?: Input) => Effect.Effect<Redacted.Redacted<string>, SetupError, Scope.Scope>
}

/** Selection for one created database. */
export interface Input {
  /** Hand out a blank database instead of a migrated one, for tests of the migrator itself. */
  readonly empty?: boolean
}

/** A Docker, PostgreSQL, or committed migration step could not finish. */
export class SetupError extends Schema.TaggedError<SetupError>()("TestDatabase.SetupError", {
  stage: Schema.Literals(["container", "ready", "address", "database", "migration", "template", "cleanup"]),
  cause: Schema.Defect(),
}) {}

/** Environment variable carrying the run's admin URL from Vitest global setup to its workers. */
export const variable = "BYMORNING_TEST_PG_URL"

/** The migrated database that `shared` clones for every create. */
export const template = "template_bymorning"

// The public ECR mirror avoids Docker Hub pull limits; the Hub name is the fallback.
const images = ["public.ecr.aws/docker/library/postgres:17-alpine", "postgres:17-alpine"] as const
const migrationsFolder = fileURLToPath(new URL("../../../packages/core/src/database/migration", import.meta.url))
const readiness = Schedule.spaced("100 millis").pipe(Schedule.upTo({ duration: "30 seconds" }))

const docker = Effect.fn("TestDatabase.docker")((stage: SetupError["stage"], args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        execFile("docker", args, { signal, timeout: 120_000 }, (cause, stdout) => {
          if (cause !== null) reject(cause)
          else resolve(stdout.trim())
        })
      }),
    catch: (cause) => new SetupError({ stage, cause }),
  }),
)

const statement = <Row extends object = Record<string, unknown>>(
  stage: SetupError["stage"],
  url: Redacted.Redacted<string>,
  text: string,
) =>
  PgClient.PgClient.use((sql) => sql.unsafe<Row>(text)).pipe(
    Effect.provide(PgClient.layer({ url, maxConnections: 1, connectTimeout: "5 seconds" })),
    Effect.scoped,
    Effect.mapError((cause) => new SetupError({ stage, cause })),
    Effect.withSpan("TestDatabase.statement"),
  )

const select = (url: Redacted.Redacted<string>, database: string) => {
  const target = new URL(Redacted.value(url))
  target.pathname = database
  return Redacted.make(target.href)
}

// Failed setup must release its resources even if the caller catches the error
// and keeps the enclosing worker scope open for another test.
const acquire = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope)
    return yield* effect.pipe(
      Scope.provide(scope),
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
    )
  })

// Test databases are disposable: trade durability for faster CREATE DATABASE and
// migrations, and admit every concurrent Application in one server.
const settings = { max_connections: "500", fsync: "off", synchronous_commit: "off", full_page_writes: "off" }

const containerArgs = (name: string, image: string) => [
  "create",
  "--name",
  name,
  "-e",
  "POSTGRES_USER=test",
  "-e",
  "POSTGRES_PASSWORD=test",
  "-p",
  "127.0.0.1::5432",
  image,
  ...Object.entries(settings).flatMap(([key, value]) => ["-c", `${key}=${value}`]),
]

/** Start one PostgreSQL 17 container; the scope removes it with its volume. */
const container = Effect.gen(function* () {
  const name = `bymorning-test-postgres-${randomUUID()}`
  yield* Effect.acquireRelease(
    docker("container", containerArgs(name, images[0])).pipe(
      Effect.catch(() => docker("container", containerArgs(name, images[1]))),
    ),
    () => docker("cleanup", ["rm", "--force", "--volumes", name]).pipe(Effect.orDie),
  )
  yield* docker("container", ["start", name])
  yield* docker("ready", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "test"]).pipe(Effect.retry(readiness))
  const published = yield* docker("address", ["port", name, "5432/tcp"])
  const address = yield* Effect.try({
    try: () => {
      const value = new URL(`tcp://${published}`)
      if (value.hostname !== "127.0.0.1" || value.port === "") {
        throw new Error("PostgreSQL must publish a dynamic loopback port")
      }
      return { host: value.host, port: Number(value.port) }
    },
    catch: (cause) => new SetupError({ stage: "address", cause }),
  })
  // In-container pg_isready passes before the host-published port forwards
  // on some Docker runtimes (Colima); wait until the loopback port accepts a
  // TCP connection so the first migrator connect cannot race the forward. A
  // forward that is not up yet can swallow the SYN instead of refusing it, so
  // each attempt is bounded rather than left to the OS connect timeout.
  yield* Effect.tryPromise({
    try: (signal) =>
      new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port: address.port, timeout: 1_000 })
        socket.once("connect", () => {
          socket.destroy()
          resolve()
        })
        socket.once("timeout", () => socket.destroy(new Error("PostgreSQL readiness probe timed out")))
        socket.once("error", reject)
        signal?.addEventListener("abort", () => {
          socket.destroy()
          reject(new Error("PostgreSQL readiness probe aborted"))
        })
      }),
    catch: (cause) => new SetupError({ stage: "ready", cause }),
  }).pipe(Effect.retry(readiness))
  return { name, admin: Redacted.make(`postgresql://test:test@${address.host}/postgres`) }
})

/** Create one database from `source` (PostgreSQL's default template when undefined); the scope drops it. */
const database = (admin: Redacted.Redacted<string>, source?: string) =>
  Effect.gen(function* () {
    const name = `test_${randomUUID().replaceAll("-", "")}`
    yield* Effect.acquireRelease(
      statement("database", admin, `CREATE DATABASE ${name}${source === undefined ? "" : ` TEMPLATE ${source}`}`),
      () => statement("cleanup", admin, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).pipe(Effect.orDie),
    )
    return select(admin, name)
  })

const migrate = (url: Redacted.Redacted<string>) =>
  run({ url, migrationsFolder }).pipe(Effect.mapError((cause) => new SetupError({ stage: "migration", cause })))

/** Acquire one private PostgreSQL 17 container; each create call receives its own migrated database. */
export const make: Effect.Effect<Interface, SetupError, Scope.Scope> = acquire(
  Effect.gen(function* () {
    const { admin } = yield* container
    const create = Effect.fn("TestDatabase.create")((input: Input = {}) =>
      acquire(
        Effect.gen(function* () {
          const url = yield* database(admin)
          if (input.empty !== true) yield* migrate(url)
          return url
        }),
      ),
    )
    return { create }
  }),
)

/** Start a container and migrate its template once, so every later create is a clone. */
const serve = acquire(
  Effect.gen(function* () {
    const { name, admin } = yield* container
    yield* statement("template", admin, `CREATE DATABASE ${template}`)
    yield* migrate(select(admin, template))
    // CREATE DATABASE ... TEMPLATE refuses a source with live sessions. The
    // migrator's pool closes asynchronously; wait for its backend to exit, then
    // refuse further connections so no later clone can race one.
    yield* statement<{ count: number }>(
      "template",
      admin,
      `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = '${template}'`,
    ).pipe(
      Effect.filterOrFail(
        (rows) => rows[0]?.count === 0,
        (rows) => new SetupError({ stage: "template", cause: new Error(`Template backends: ${JSON.stringify(rows)}`) }),
      ),
      Effect.retry(readiness),
    )
    yield* statement("template", admin, `ALTER DATABASE ${template} WITH ALLOW_CONNECTIONS false IS_TEMPLATE true`)
    return { name, admin }
  }),
)

/**
 * Start the run's PostgreSQL server with its migrated template. Vitest global
 * setup publishes the returned admin URL under `variable` for `shared`.
 */
export const start: Effect.Effect<Redacted.Redacted<string>, SetupError, Scope.Scope> = Effect.map(
  serve,
  ({ admin }) => admin,
)

const handle = (admin: Redacted.Redacted<string>): Interface => ({
  create: Effect.fn("TestDatabase.create")((input: Input = {}) =>
    acquire(database(admin, input.empty === true ? undefined : template)),
  ),
})

// Without global setup (one file run outside its package config), a single
// container per process backs every shared handle and leaves with the process.
const fallback = Effect.runSync(
  Effect.cached(
    Effect.gen(function* () {
      const { name, admin } = yield* serve.pipe(Scope.provide(yield* Scope.make()))
      const remove = () => {
        try {
          execFileSync("docker", ["rm", "--force", "--volumes", name], { stdio: "ignore" })
        } catch {
          // Best effort at process exit; the container name identifies a leftover.
        }
      }
      process.once("exit", remove)
      // Vitest ends a worker with SIGTERM, which skips "exit" unless handled.
      for (const [signal, code] of [
        ["SIGTERM", 143],
        ["SIGINT", 130],
      ] as const) {
        process.once(signal, () => {
          remove()
          process.exit(code)
        })
      }
      console.warn(
        `TestDatabase: ${variable} is not set, so ${name} serves this process alone. ` +
          "Run through the package's vitest config to share one PostgreSQL server per run.",
      )
      return admin
    }),
  ),
)

/**
 * The run's PostgreSQL server. Every create clones the migrated template in
 * milliseconds; `{ empty: true }` creates a blank database instead.
 */
export const shared: Effect.Effect<Interface, SetupError> = Effect.suspend(() => {
  const published = process.env[variable]
  return published === undefined ? Effect.map(fallback, handle) : Effect.succeed(handle(Redacted.make(published)))
})
