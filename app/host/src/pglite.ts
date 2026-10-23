import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { Effect, Redacted, Schema } from "effect"
import { mkdir } from "node:fs/promises"

/** PGlite could not become a PostgreSQL endpoint for this process. */
export class OpenError extends Schema.TaggedError<OpenError>()("Pglite.OpenError", {
  stage: Schema.Literals(["engine", "socket"]),
  directory: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Filesystem directory that holds the persisted PGlite database. */
export interface Input {
  /** Absolute PGlite data directory. */
  readonly directory: string
}

/** Live PGlite endpoint the local host can hand to PgClient. */
export interface Handle {
  /** Wire-protocol URL for PgClient, the migrator, and drizzle-kit. */
  readonly url: Redacted.Redacted<string>
  /** Absolute PGlite data directory. */
  readonly directory: string
}

/**
 * Acquire exclusive use of the data directory, start PGlite, bind a loopback
 * PostgreSQL socket, and keep both until the process scope closes.
 *
 * @param input - Absolute data directory for the PGlite files.
 * @returns A PostgreSQL URL that is valid only while this effect's scope is open.
 */
export const open = Effect.fn("Pglite.open")(function* (input: Input) {
  yield* Effect.tryPromise({
    try: () => mkdir(input.directory, { recursive: true }),
    catch: (cause) => new OpenError({ stage: "engine", directory: input.directory, cause }),
  })
  const db = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const db = new PGlite(input.directory)
        await db.waitReady
        return db
      },
      catch: (cause) => new OpenError({ stage: "engine", directory: input.directory, cause }),
    }),
    (db) => Effect.promise(() => db.close()),
  )
  const server = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const server = new PGLiteSocketServer({
          db,
          host: "127.0.0.1",
          port: 0,
          // Drizzle migrate and PgClient pool checkout overlap; keep a small backlog.
          maxConnections: 4,
        })
        await server.start()
        const port = Number(server.getServerConn().slice(server.getServerConn().lastIndexOf(":") + 1))
        if (!Number.isInteger(port) || port <= 0)
          throw new Error(`PGlite socket did not publish a TCP port: ${server.getServerConn()}`)
        return { server, port }
      },
      catch: (cause) => new OpenError({ stage: "socket", directory: input.directory, cause }),
    }),
    ({ server }) => Effect.promise(() => server.stop()),
  )
  return {
    directory: input.directory,
    url: Redacted.make(`postgresql://postgres:postgres@127.0.0.1:${server.port}/postgres?sslmode=disable`),
  } satisfies Handle
})
