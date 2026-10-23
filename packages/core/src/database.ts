import { PgClient } from "@effect/sql-pg"
import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { type EffectPgQueryEffectHKT, type EffectPgQueryResultHKT, makeWithDefaults } from "drizzle-orm/effect-postgres"
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect"
import { Cause, Config, Context, Effect, Layer, Redacted, Ref, Schema } from "effect"
import type { SqlError } from "effect/unstable/sql/SqlError"

/** Acquired Drizzle client shared by Core persistence modules. */
export type Client = Effect.Success<ReturnType<typeof makeWithDefaults>>

/** Drizzle transaction client installed in the current transaction context. */
export type Transaction = Parameters<Parameters<Client["transaction"]>[0]>[0]

/** Query executor common to the root client and its transaction client. */
export type Executor = PgEffectDatabase<EffectPgQueryEffectHKT, EffectPgQueryResultHKT>

/** A root transaction was requested from inside an existing transaction. */
export class RootTransactionConflict extends Schema.TaggedError<RootTransactionConflict>()(
  "Database.RootTransactionConflict",
  {},
) {}

/** Access to database query execution. */
export interface Interface {
  /** Runs an operation against the active transaction, or the root client when no transaction is active. */
  readonly use: <A, E, R>(
    label: string,
    operation: (executor: Executor) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>

  /**
   * Runs an effect in a transaction. Nested calls pass through to the outer transaction rather than opening savepoints.
   */
  readonly transact: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>

  /** Runs an effect in a new root transaction, failing when a transaction is already active. */
  readonly transactRoot: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqlError | RootTransactionConflict, R>

  /**
   * Registers a brief, environment-free, typed-infallible effect to run after the outermost transaction commits.
   * Transaction callbacks run once, uninterruptibly, and in registration order. Their defects and self-interruptions
   * are safely logged after execution and do not stop later callbacks or change the committed result. Outside a
   * transaction, the effect runs immediately and its defect or interruption remains observable to the caller.
   */
  readonly afterCommit: <A>(effect: Effect.Effect<A>) => Effect.Effect<void>
}

/** Service for the shared database client. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Database") {}

interface ActiveTransaction {
  readonly executor: Executor
  readonly afterCommit: Ref.Ref<ReadonlyArray<Effect.Effect<unknown>>>
}

const ActiveTransaction = Context.Reference<ActiveTransaction | undefined>(
  "@bymorning/core/Database/ActiveTransaction",
  {
    defaultValue: () => undefined,
  },
)

const DatabaseUrl = Schema.Redacted(
  Schema.URL.pipe(
    Schema.check(
      Schema.makeFilter(
        (url) =>
          (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
          url.hostname.length > 0 &&
          url.pathname.length > 1,
        { expected: "a PostgreSQL connection URL with a host and database" },
      ),
    ),
  ),
)

const databaseUrlConfig = Config.schema(DatabaseUrl, "DATABASE_URL").pipe(
  Config.map((url) => {
    const clientUrl = new URL(Redacted.value(url).href)
    // PgClient forwards its URL to node-postgres, whose documented connection
    // parameter is sent to PostgreSQL during startup.
    clientUrl.searchParams.set("statement_timeout", "14000")
    return Redacted.make(clientUrl.href)
  }),
)

const clientLayer = PgClient.layerConfig({
  url: databaseUrlConfig,
  connectTimeout: Config.succeed("5 seconds"),
  idleTimeout: Config.succeed("30 seconds"),
  maxConnections: Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), "DATABASE_MAX_CONNECTIONS").pipe(
    Config.withDefault(10),
  ),
})

/** Database layer requiring a PostgreSQL client supplied by the composition root. */
export const layer = Layer.effect(
  Service,
  makeWithDefaults().pipe(
    Effect.map((db) => {
      const use = <A, E, R>(label: string, operation: (executor: Executor) => Effect.Effect<A, E, R>) =>
        Effect.flatMap(ActiveTransaction, (active) => operation(active?.executor ?? db)).pipe(
          Effect.withSpan(`Database.${label}`),
        )

      const afterCommit = <A>(effect: Effect.Effect<A>) =>
        Effect.flatMap(ActiveTransaction, (active) =>
          active === undefined
            ? Effect.asVoid(effect)
            : Ref.update(active.afterCommit, (effects) => [...effects, effect]),
        )

      const transaction = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | SqlError, R> =>
        Effect.uninterruptibleMask(() =>
          Effect.gen(function* () {
            const afterCommitEffects = yield* Ref.make<ReadonlyArray<Effect.Effect<unknown>>>([])
            const result = yield* db.transaction((tx) =>
              effect.pipe(
                Effect.provideService(ActiveTransaction, { executor: tx, afterCommit: afterCommitEffects }),
                Effect.interruptible,
              ),
            )
            yield* Ref.get(afterCommitEffects).pipe(
              Effect.flatMap((effects) =>
                Effect.forEach(
                  effects,
                  (effect) =>
                    effect.pipe(
                      Effect.uninterruptible,
                      Effect.catchCause((cause) =>
                        Effect.logError("Database afterCommit callback failed").pipe(
                          Effect.annotateLogs({
                            defect: Cause.hasDies(cause),
                            interrupted: Cause.hasInterrupts(cause),
                          }),
                        ),
                      ),
                    ),
                  { discard: true },
                ),
              ),
            )
            return result
          }),
        )

      const transact = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.flatMap(ActiveTransaction, (active) => (active === undefined ? transaction(effect) : effect))

      const transactRoot = <A, E, R>(
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | SqlError | RootTransactionConflict, R> =>
        Effect.flatMap(ActiveTransaction, (active): Effect.Effect<A, E | SqlError | RootTransactionConflict, R> =>
          active === undefined ? transaction(effect) : Effect.fail(new RootTransactionConflict()),
        )

      return Service.of({ use, transact, transactRoot, afterCommit })
    }),
  ),
)

export const pgClientNode = makeGlobalNode({ service: PgClient.PgClient, layer: clientLayer, deps: [] })

/** Built-in PostgreSQL implementation used when an application has not selected another adapter. */
export const configured = makeGlobalNode({ service: Service, layer, deps: [pgClientNode] })

/** Host-selected process-global Database adapter. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)

/** Compatibility production layer for tests and non-graph callers. */
export const defaultLayer = layer.pipe(Layer.provide(clientLayer))

export { AccountTable } from "./database/schema/account.sql.js"
export { AuditEntryTable } from "./database/schema/audit.sql.js"
export { AgentTable } from "./database/schema/agent.sql.js"
export { AuthTable, LoginSessionTable } from "./database/schema/auth.sql.js"
export { AuthProviderTable, InstallationSetupTable } from "./database/schema/auth-provider.sql.js"
export { BudgetChargeTable, BudgetLimitTable } from "./database/schema/budget.sql.js"
export { CredentialTable } from "./database/schema/credential.sql.js"
export { ConfigTable } from "./database/schema/config.sql.js"
export { InstructionEntryTable } from "./database/schema/instruction.sql.js"
export { InstallationAdminTable, InstallationTable } from "./database/schema/installation.sql.js"
export { ApiKeyTable } from "./database/schema/api-key.sql.js"
export { OAuthAuthorizationTable, OAuthClientTable, OAuthGrantTable } from "./database/schema/oauth.sql.js"
export { PermissionSavedTable } from "./database/schema/permission.sql.js"
export { ProjectTable, ProjectPurgeTable } from "./database/schema/project.sql.js"
export { ScheduledTaskTable } from "./database/schema/scheduled-task.sql.js"
export { ServiceAccountTable } from "./database/schema/service-account.sql.js"
export { SessionMessageTable, SessionInboxTable, SessionTable } from "./database/schema/session.sql.js"
export { SkillTable } from "./database/schema/skill.sql.js"
export { ToolUsageTable } from "./database/schema/tool-usage.sql.js"
export { UserTable } from "./database/schema/user.sql.js"
export { UsageTable } from "./database/schema/usage.sql.js"
export { WorkspaceTable } from "./database/schema/workspace.sql.js"

export * as Database from "./database.js"
