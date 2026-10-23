import { Budget } from "@bymorning/core/budget"
import { BudgetChargeTable, Database } from "@bymorning/core/database"
import { Holder } from "@bymorning/schema/budget"
import { PgClient } from "@effect/sql-pg"
import { eq } from "drizzle-orm"
import { Clock, Effect, Exit, Layer, Redacted, Scope } from "effect"
import { describe, expect, test } from "vitest"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const database = Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(process.env.DATABASE_URL) })))

const now = Date.parse("2026-09-30T23:59:59.999Z")

/** Fixed clock at the final millisecond of the 2026-09 Period for deterministic retryAfter. */
const fixedClock = Layer.succeed(Clock.Clock, {
  currentTimeMillisUnsafe: () => now,
  currentTimeMillis: Effect.succeed(now),
  currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(now) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => 0n,
  monotonicTimeNanos: Effect.succeed(0n),
  sleep: () => Effect.void,
} satisfies Clock.Clock)

const graph = () => Layer.merge(database, Budget.layer.pipe(Layer.provide(database)))

describe("Budget", () => {
  test("limits, reserves, settles, and reports Holder Standing", async () => {
    const workspace = Holder.make("workspace:w_budget_test_a")
    const serviceAccount = Holder.make("service-account:w_budget_test_a:sva_budget_test_a")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.limit({ holder: workspace, amount: 10 })
        yield* budget.limit({ holder: serviceAccount, amount: 1 })
        const reservation = yield* budget.reserve([workspace, serviceAccount])
        yield* reservation.settle(1)
        const [workspaceStanding, accountStanding] = yield* budget.status([workspace, serviceAccount])
        expect(workspaceStanding).toMatchObject({ holder: workspace, spent: 1, limit: 10 })
        expect(accountStanding).toMatchObject({ holder: serviceAccount, spent: 1, limit: 1 })
        const error = yield* budget.reserve([workspace, serviceAccount]).pipe(Effect.flip)
        expect(error).toMatchObject({ _tag: "Budget.ExceededError", holder: serviceAccount })
      }).pipe(Effect.provide(graph()), Effect.scoped),
    )
  })

  test("shares a finite limit across concurrent reservations by their estimates", async () => {
    const holder = Holder.make("workspace:w_budget_test_b")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.limit({ holder, amount: 1 })
        // Three invocations estimated at $0.50 each: two fit, the third finds no room left.
        const outcome = yield* Effect.all(
          [
            Budget.Service.use((service) => service.reserve([holder], { estimate: 0.5 })).pipe(Effect.exit),
            Budget.Service.use((service) => service.reserve([holder], { estimate: 0.5 })).pipe(Effect.exit),
            Budget.Service.use((service) => service.reserve([holder], { estimate: 0.5 })).pipe(Effect.exit),
          ],
          { concurrency: "unbounded" },
        )
        expect(outcome.filter(Exit.isSuccess)).toHaveLength(2)
        expect(outcome.filter(Exit.isFailure)).toHaveLength(1)
      }).pipe(Effect.provide(graph()), Effect.scoped),
    )
  })

  test("admits while any room is left and caps the hold at that room", async () => {
    const holder = Holder.make("workspace:w_budget_test_h")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.limit({ holder, amount: 1 })
        // A worst case far above the limit still admits the first invocation; it simply holds the whole $1.
        const first = yield* budget.reserve([holder], { estimate: 500 })
        const refused = yield* budget.reserve([holder], { estimate: 0.01 }).pipe(Effect.flip)
        expect(refused).toMatchObject({ _tag: "Budget.ExceededError", holder })
        yield* first.settle(0.25)
        // Settling releases the hold, leaving the remaining $0.75 for the next invocation.
        const second = yield* budget.reserve([holder])
        yield* second.settle(0.25)
        const [standing] = yield* budget.status([holder])
        expect(standing).toMatchObject({ holder, spent: 0.5, limit: 1 })
      }).pipe(Effect.provide(graph()), Effect.scoped),
    )
  })

  test("releases an unsettled reservation when its Scope closes", async () => {
    const holder = Holder.make("workspace:w_budget_test_c")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.limit({ holder, amount: 1 })
        const scope = yield* Scope.make()
        yield* budget.reserve([holder]).pipe(Scope.provide(scope))
        yield* Scope.close(scope, Exit.void)
        const next = yield* budget.reserve([holder])
        expect(next).toHaveProperty("settle")
      }).pipe(Effect.provide(graph()), Effect.scoped),
    )
  })

  test("settles idempotently with a single durable Charge", async () => {
    const holder = Holder.make("workspace:w_budget_test_d")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.limit({ holder, amount: 10 })
        const scope = yield* Scope.make()
        const reservation = yield* budget.reserve([holder]).pipe(Scope.provide(scope))
        yield* reservation.settle(2)
        yield* reservation.settle(2)
        const [standing] = yield* budget.status([holder])
        expect(standing.spent).toBe(2)
        const store = yield* Database.Service
        const rows = yield* store
          .use("BudgetTest.charges", (db) =>
            db.select().from(BudgetChargeTable).where(eq(BudgetChargeTable.holder, holder)),
          )
          .pipe(Effect.orDie)
        expect(rows).toHaveLength(1)
        yield* Scope.close(scope, Exit.void)
      }).pipe(Effect.provide(graph()), Effect.scoped),
    )
  })

  test("clearing a limit admits reserve even after spend", async () => {
    const holder = Holder.make("workspace:w_budget_test_e")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.limit({ holder, amount: 1 })
        const first = yield* budget.reserve([holder])
        yield* first.settle(1)
        const exhausted = yield* budget.reserve([holder]).pipe(Effect.flip)
        expect(exhausted).toMatchObject({ _tag: "Budget.ExceededError", holder })
        yield* budget.limit({ holder })
        const next = yield* budget.reserve([holder])
        expect(next).toHaveProperty("settle")
      }).pipe(Effect.provide(graph()), Effect.scoped),
    )
  })

  test("charges Holders without a limit and reports no limit key", async () => {
    const holder = Holder.make("workspace:w_budget_test_f")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        const reservation = yield* budget.reserve([holder])
        yield* reservation.settle(3)
        const [standing] = yield* budget.status([holder])
        expect(standing.spent).toBe(3)
        expect(standing).not.toHaveProperty("limit")
      }).pipe(Effect.provide(graph()), Effect.scoped),
    )
  })

  test("reports retryAfter as milliseconds until the Period ends", async () => {
    const holder = Holder.make("workspace:w_budget_test_g")
    await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.limit({ holder, amount: 0 })
        const error = yield* budget.reserve([holder]).pipe(Effect.flip)
        expect(error).toMatchObject({ _tag: "Budget.ExceededError", holder, retryAfter: 1 })
        const [standing] = yield* budget.status([holder])
        expect(standing.period).toEqual({
          start: new Date("2026-09-01T00:00:00.000Z"),
          end: new Date("2026-10-01T00:00:00.000Z"),
        })
      }).pipe(Effect.provide(Layer.mergeAll(graph(), fixedClock)), Effect.scoped),
    )
  })
})
