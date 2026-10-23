import { PgClient } from "@effect/sql-pg"
import { makeWithDefaults } from "drizzle-orm/effect-postgres"
import { migrate } from "drizzle-orm/effect-postgres/migrator"
import { Config, Effect, Option, Redacted, Schema } from "effect"
import { sql } from "drizzle-orm"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { brotliDecompressSync } from "node:zlib"
import { Postgres } from "./application/adapters/database-postgres.js"

const migrationDirectory = "migration"

class PackagedMigrationError extends Schema.TaggedError<PackagedMigrationError>()(
  "Server.PackagedMigrationError",
  { cause: Schema.Defect() },
) {}

const MigrationFiles = Schema.Record(
  Schema.String,
  Schema.Struct({ content: Schema.String, encoding: Schema.Literals(["utf8", "base64"]) }),
)

export const resolveMigrationFolder = (lambdaRoot = process.env.LAMBDA_TASK_ROOT, cwd = process.cwd()) => {
  const folder = findMigrationFolder(lambdaRoot, cwd)
  if (folder === undefined) throw new Error("Packaged migration folder is missing")
  return folder
}

export interface RunInput {
  readonly url?: Redacted.Redacted
  readonly migrationsFolder?: string
  /** Passed to PgClient. PGlite sockets require `false`. */
  readonly ssl?: boolean
  /** PEM CA certificate verifying the server; defaults to the DATABASE_CA environment variable. */
  readonly ca?: Redacted.Redacted
}

export const run = (input: RunInput = {}) => {
  const migrateFolder = (migrationsFolder: string) =>
    Effect.gen(function* () {
      const url = input.url ?? (yield* Config.redacted("DATABASE_URL"))
      const envCA = yield* Config.option(Config.redacted("DATABASE_CA"))
      const ca = input.ca ?? Option.getOrUndefined(envCA)
      yield* Effect.gen(function* () {
        const database = yield* makeWithDefaults()
        yield* database.transaction((tx) =>
          tx
            .execute(sql`select pg_advisory_xact_lock(621731921, 20260812)`)
            .pipe(Effect.andThen(migrate(tx, { migrationsFolder }))),
        )
      }).pipe(
        Effect.provide(
          PgClient.layer({
            url,
            maxConnections: 1,
            connectTimeout: input.url === undefined ? "60 seconds" : "5 seconds",
            idleTimeout: "30 seconds",
            ...Postgres.ssl({ ssl: input.ssl, ca }),
          }),
        ),
      )
    })
  return Effect.gen(function* () {
    const folder = input.migrationsFolder ?? findMigrationFolder()
    if (folder !== undefined) return yield* migrateFolder(folder)
    return yield* migrateFolder(yield* embeddedMigrationFolder)
  }).pipe(Effect.scoped)
}

const embeddedMigrationFolder = Effect.gen(function* () {
  const directory = yield* Effect.acquireRelease(
    Effect.tryPromise(() => mkdtemp(join(tmpdir(), "bymorning-migration-"))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )
  const module = yield* Effect.tryPromise({
    try: () => import("virtual:bymorning-assets"),
    catch: (cause) => new PackagedMigrationError({ cause }),
  })
  const files = yield* Schema.decodeUnknownEffect(MigrationFiles)(
    JSON.parse(brotliDecompressSync(Buffer.from(module.default.migrations, "base64")).toString()),
  ).pipe(Effect.mapError((cause) => new PackagedMigrationError({ cause })))
  yield* Effect.forEach(
    Object.entries(files),
    ([file, body]) =>
      Effect.promise(async () => {
        const target = join(directory, file)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, body.encoding === "utf8" ? body.content : Buffer.from(body.content, "base64"))
      }),
    { concurrency: "unbounded", discard: true },
  )
  return directory
})

function findMigrationFolder(lambdaRoot = process.env.LAMBDA_TASK_ROOT, cwd = process.cwd()) {
  return [
    lambdaRoot && join(lambdaRoot, migrationDirectory),
    join(cwd, migrationDirectory),
    join(cwd, "../core/src/database/migration"),
  ]
    .filter((candidate): candidate is string => candidate !== undefined)
    .find(existsSync)
}

/** Runs all committed migrations and returns no database or migration details. */
export const handler = async (): Promise<{ readonly ok: true }> => {
  try {
    await Effect.runPromise(run())
    return { ok: true }
  } catch {
    // Throw an intentionally opaque error so Lambda sets FunctionError without
    // serializing a database URL, SQL parameters, or a provider error cause.
    throw new Error("Database migration failed")
  }
}
