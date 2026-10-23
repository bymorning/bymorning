import { Effect, Exit, Redacted, Scope } from "effect"
import { afterAll } from "vitest"
import { TestDatabase } from "../database.js"

/**
 * Vitest setup file: clone one migrated database for this test file and
 * publish it as DATABASE_URL before the file's imports run, for suites that
 * build `Database.node` from the environment. The file's teardown drops it.
 */
const scope = await Effect.runPromise(Scope.make())
const url = await Effect.runPromise(
  Effect.flatMap(TestDatabase.shared, (database) => database.create()).pipe(Scope.provide(scope)),
)
process.env.DATABASE_URL = Redacted.value(url)

afterAll(() => Effect.runPromise(Scope.close(scope, Exit.void)))
