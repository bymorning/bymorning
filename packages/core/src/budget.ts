export * as Budget from "./budget.js"

export { Amount, ExceededError, Holder, Limit, Period, StoreError, Standing } from "@bymorning/schema/budget"

import type { Budget as BudgetSchema } from "@bymorning/schema/budget"
import { ExceededError, StoreError } from "@bymorning/schema/budget"
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm"
import type { Array as Arr } from "effect"
import { Clock, Context, Effect, Layer, Metric, Scope, SynchronizedRef } from "effect"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { Database } from "./database.js"
import { BudgetChargeTable, BudgetLimitTable } from "./database/schema/budget.sql.js"

/** A reserved inference spend across every Holder of one invocation. */
export interface Reservation {
  /** Charge every reserved Holder and release the in-flight hold. Idempotent. */
  readonly settle: (amount: BudgetSchema.Amount) => Effect.Effect<void, StoreError>
}

/**
 * Held against each Holder when the edge cannot estimate an invocation's cost.
 * Concurrent invocations may settle above a Spend Limit by at most the amount
 * their estimates fell short, so this stays deliberately conservative.
 */
export const nominalEstimate = 1

/** Spend Limit ownership and enforcement by opaque Holder. */
export interface Interface {
  /**
   * Admit if every Holder has room left in the current Period, holding the
   * invocation's estimated worst-case cost (capped at the room left) against
   * each Holder until settled. Released with the Scope unless settled.
   */
  readonly reserve: (
    holders: Arr.NonEmptyReadonlyArray<BudgetSchema.Holder>,
    options?: { readonly estimate?: BudgetSchema.Amount },
  ) => Effect.Effect<Reservation, ExceededError | StoreError, Scope.Scope>
  /** Set or clear one Holder's Spend Limit. */
  readonly limit: (input: {
    readonly holder: BudgetSchema.Holder
    readonly amount?: BudgetSchema.Amount
  }) => Effect.Effect<void, StoreError>
  /** Current-Period Standing for each Holder, in input order. */
  readonly status: (
    holders: ReadonlyArray<BudgetSchema.Holder>,
  ) => Effect.Effect<ReadonlyArray<BudgetSchema.Standing>, StoreError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Budget") {}

/** Process-local in-flight spend ledger by Holder. Durable Charges remain authoritative. */
export class State extends Context.Service<State, SynchronizedRef.SynchronizedRef<Map<BudgetSchema.Holder, number>>>()(
  "@bymorning/core/Budget/State",
) {}

export const stateMemory = Layer.effect(State, Effect.map(SynchronizedRef.make(new Map()), State.of))

/** Application-owned reservation state. Every Budget instance shares it. */
export const stateNode = makeGlobalNode({ service: State, layer: stateMemory, deps: [] })

/** UTC calendar-month interval containing `date`, with an exclusive upper boundary. */
export const period = (date: Date): BudgetSchema.Period => ({
  start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
  end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)),
})

const reserveMetric = Metric.counter("bymorning_budget_reserve_total", { incremental: true })
const releaseMetric = Metric.counter("bymorning_budget_release_total", { incremental: true })

/** Budget over durable Limits and Charges plus the shared in-flight ledger. */
export const sharedLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* State
    const database = yield* Database.Service

    const limits = (holders: ReadonlyArray<BudgetSchema.Holder>, operation: StoreError["operation"]) =>
      database
        .use("Budget.limits", (db) =>
          db
            .select({ holder: BudgetLimitTable.holder, amount: BudgetLimitTable.amount })
            .from(BudgetLimitTable)
            .where(inArray(BudgetLimitTable.holder, [...holders])),
        )
        .pipe(
          Effect.map((rows) => new Map(rows.map((row) => [row.holder, Number(row.amount)] as const))),
          Effect.mapError((cause) => new StoreError({ operation, cause })),
        )

    const spent = (
      holders: ReadonlyArray<BudgetSchema.Holder>,
      current: BudgetSchema.Period,
      operation: StoreError["operation"],
    ) =>
      holders.length === 0
        ? Effect.succeed(new Map<BudgetSchema.Holder, number>())
        : database
            .use("Budget.spent", (db) =>
              db
                .select({
                  holder: BudgetChargeTable.holder,
                  total: sql<string>`coalesce(sum(${BudgetChargeTable.amount}), 0)`,
                })
                .from(BudgetChargeTable)
                .where(
                  and(
                    inArray(BudgetChargeTable.holder, [...holders]),
                    gte(BudgetChargeTable.occurredAt, current.start),
                    lt(BudgetChargeTable.occurredAt, current.end),
                  ),
                )
                .groupBy(BudgetChargeTable.holder),
            )
            .pipe(
              Effect.map((rows) => new Map(rows.map((row) => [row.holder, Number(row.total)] as const))),
              Effect.mapError((cause) => new StoreError({ operation, cause })),
            )

    const charge = (holders: ReadonlyArray<BudgetSchema.Holder>, amount: number, occurredAt: Date) =>
      amount <= 0
        ? Effect.void
        : database
            .use("Budget.charge", (db) =>
              db
                .insert(BudgetChargeTable)
                .values(holders.map((holder) => ({ holder, amount: amount.toString(), occurredAt }))),
            )
            .pipe(
              Effect.asVoid,
              Effect.mapError((cause) => new StoreError({ operation: "settle", cause })),
            )

    const reserve = Effect.fn("Budget.reserve")(function* (
      holders: Arr.NonEmptyReadonlyArray<BudgetSchema.Holder>,
      options?: { readonly estimate?: BudgetSchema.Amount },
    ) {
      const now = yield* Clock.currentTimeMillis
      const current = period(new Date(now))
      const limited = yield* limits(holders, "reserve")
      const capped = holders.filter((holder) => limited.has(holder))
      const estimate = options?.estimate ?? nominalEstimate
      // Hold the estimated cost against each capped Holder, never more than the
      // room it has left, so concurrent invocations share the Period's room
      // instead of the first one claiming all of it. The synchronized section
      // covers the durable Charge snapshot and every in-flight hold.
      const holds = yield* SynchronizedRef.modifyEffect(state, (ledger) =>
        Effect.gen(function* () {
          const settled = yield* spent(capped, current, "reserve")
          const holds = new Map<BudgetSchema.Holder, number>()
          for (const holder of capped) {
            const remaining = limited.get(holder)! - (settled.get(holder) ?? 0) - (ledger.get(holder) ?? 0)
            if (remaining <= 0)
              return yield* new ExceededError({ holder, retryAfter: Math.max(0, current.end.getTime() - now) })
            holds.set(holder, Math.min(remaining, estimate))
          }
          if (holds.size === 0) return [holds, ledger] as const
          const next = new Map(ledger)
          for (const [holder, hold] of holds) next.set(holder, (next.get(holder) ?? 0) + hold)
          return [holds, next] as const
        }),
      ).pipe(
        Effect.tapError((error) =>
          error._tag === "Budget.ExceededError"
            ? Metric.update(Metric.withAttributes(reserveMetric, { outcome: "refused" }), 1)
            : Effect.void,
        ),
      )
      yield* Metric.update(Metric.withAttributes(reserveMetric, { outcome: "reserved" }), 1)
      let complete = false
      const release = (reason: "release" | "settle") =>
        SynchronizedRef.update(state, (ledger) => {
          if (complete || holds.size === 0) return ledger
          complete = true
          const next = new Map(ledger)
          for (const [holder, hold] of holds) next.set(holder, Math.max(0, (next.get(holder) ?? 0) - hold))
          return next
        }).pipe(Effect.tap(() => Metric.update(Metric.withAttributes(releaseMetric, { reason }), 1)))
      const scope = yield* Scope.Scope
      yield* Scope.addFinalizer(scope, release("release"))
      let settled = false
      const settle = Effect.fn("Budget.settle")(function* (amount: BudgetSchema.Amount) {
        if (settled) return
        settled = true
        const occurredAt = new Date(yield* Clock.currentTimeMillis)
        yield* charge(holders, amount, occurredAt).pipe(Effect.ensuring(release("settle")))
      })
      return { settle } satisfies Reservation
    })

    const limit = Effect.fn("Budget.limit")(function* (input: {
      readonly holder: BudgetSchema.Holder
      readonly amount?: BudgetSchema.Amount
    }) {
      yield* database
        .use("Budget.limit", (db) =>
          input.amount === undefined
            ? db.delete(BudgetLimitTable).where(eq(BudgetLimitTable.holder, input.holder))
            : db
                .insert(BudgetLimitTable)
                .values({ holder: input.holder, amount: input.amount.toString(), timeUpdated: new Date() })
                .onConflictDoUpdate({
                  target: BudgetLimitTable.holder,
                  set: { amount: input.amount.toString(), timeUpdated: new Date() },
                }),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) => new StoreError({ operation: "limit", cause })),
        )
    })

    const status = Effect.fn("Budget.status")(function* (holders: ReadonlyArray<BudgetSchema.Holder>) {
      const current = period(new Date(yield* Clock.currentTimeMillis))
      if (holders.length === 0) return []
      const [limited, settled] = yield* Effect.all([limits(holders, "status"), spent(holders, current, "status")])
      return holders.map((holder) => {
        const amount = limited.get(holder)
        return {
          holder,
          period: current,
          spent: settled.get(holder) ?? 0,
          ...(amount === undefined ? {} : { limit: amount }),
        } satisfies BudgetSchema.Standing
      })
    })

    return Service.of({ reserve, limit, status })
  }),
)

/** Isolated Budget construction for focused graphs. Application graphs use `sharedLayer` with `stateNode`. */
export const layer = sharedLayer.pipe(Layer.provide(stateMemory))

/** Canonical process-global Budget node. */
export const node = makeGlobalNode({ service: Service, layer: sharedLayer, deps: [stateNode, Database.node] })
