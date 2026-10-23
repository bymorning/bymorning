import { NodeCrypto } from "@effect/platform-node"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer } from "effect"
import { Database } from "@bymorning/core/database"
import { TestDatabase } from "@bymorning/testing/database"

/** A migrated Database on the run's PostgreSQL server, dropped when the Layer is released. */
export const postgres = () =>
  Layer.unwrap(
    Effect.gen(function* () {
      const database = yield* TestDatabase.shared
      const url = yield* database.create()
      return Layer.merge(Database.layer.pipe(Layer.provide(PgClient.layer({ url }))), NodeCrypto.layer)
    }),
  ).pipe(Layer.orDie)
