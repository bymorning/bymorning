import { Effect, Exit, Redacted, Scope } from "effect"
import { TestDatabase } from "../database.js"

/**
 * Vitest global setup: one PostgreSQL server per run. Workers inherit the
 * admin URL through the environment and clone its migrated template per test.
 */
export default async function setup() {
  const scope = await Effect.runPromise(Scope.make())
  const admin = await Effect.runPromise(TestDatabase.start.pipe(Scope.provide(scope)))
  process.env[TestDatabase.variable] = Redacted.value(admin)
  return async () => {
    delete process.env[TestDatabase.variable]
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}
