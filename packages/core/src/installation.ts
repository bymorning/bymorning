/** Exposes the Installation governance capability owned by this module. */
export * as Installation from "./installation.js"

import type { GlobalNode } from "@bymorning/util/effect/app-node"
import { Account } from "@bymorning/schema/account"
import { Installation } from "@bymorning/schema/installation"
import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema, SynchronizedRef } from "effect"
import { Database } from "./database.js"
import { AccountTable } from "./database/schema/account.sql.js"
import { makeStore } from "./installation/store.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

export const Policy = Installation.Policy
export type Policy = Installation.Policy
/** The unrestricted Installation Policy. Provisioning still defaults to invite-only. */
export const empty = Installation.empty
/** Effective account provisioning behavior: invite-only unless explicitly opened. */
export const provisioning = Installation.provisioning

/** The Account exists but the requested Installation grant or state transition does not. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Installation.NotFoundError", {
  accountID: Account.ID,
}) {}

/** The last Installation Admin cannot be revoked; the Setup token is the recovery path. */
export class LastAdminError extends Schema.TaggedError<LastAdminError>()("Installation.LastAdminError", {}) {}

/** The supplied Installation Policy is not a valid document. */
export class ValidationError extends Schema.TaggedError<ValidationError>()("Installation.ValidationError", {
  message: Schema.String,
}) {}

/** Installation governance state could not be read or persisted. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Installation.UnavailableError", {}) {}

/**
 * Installation governance authority: Installation Admin grants and the
 * Installation Policy. The edge authorizes callers; Core keeps the record.
 */
export interface Interface {
  readonly admin: {
    /** List every Installation Admin Account, oldest grant first. */
    readonly list: () => Effect.Effect<ReadonlyArray<Account.ID>, UnavailableError>
    /** Grant installation-wide administrative authority to an existing Account. */
    readonly grant: (accountID: Account.ID) => Effect.Effect<void, NotFoundError | UnavailableError>
    /** Revoke an Installation Admin grant; revoking the last admin is refused. */
    readonly revoke: (accountID: Account.ID) => Effect.Effect<void, NotFoundError | LastAdminError>
  }
  readonly policy: {
    /** The current Installation Policy; unrestricted fields are absent. */
    readonly get: Effect.Effect<Policy>
    /** Replace the Installation Policy. */
    readonly update: (policy: Policy) => Effect.Effect<void, ValidationError>
  }
  /** Whether the Account holds an Installation Admin grant. Consumed by the edge; not a route by itself. */
  readonly check: (accountID: Account.ID) => Effect.Effect<boolean>
  /**
   * Auth account-linking collaboration: when bootstrap is armed and no
   * Installation Admin remains, the logging-in Account becomes the first
   * (or recovered) Installation Admin and bootstrap disarms. Returns whether
   * a grant was made.
   */
  readonly bootstrap: (accountID: Account.ID) => Effect.Effect<boolean>
  /**
   * Auth Provider Setup collaboration: presenting the Setup token arms
   * bootstrap so the next login becomes Installation Admin — the recovery
   * path when no admin remains.
   */
  readonly arm: Effect.Effect<void>
}

/** Installation governance authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Installation") {}

/** PostgreSQL-backed Installation governance implementation. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const store = makeStore(database)
    // Process-local Policy cache: `update` replaces it, so Config's effective
    // resolution reads the committed Policy without a database round-trip.
    // Peer processes observe Policy writes on their next restart.
    const cache = yield* SynchronizedRef.make(Option.none<Policy>())

    const load = Effect.gen(function* () {
      const row = yield* store.readPolicy
      if (row === undefined) return empty
      return yield* Schema.decodeUnknownEffect(Policy)(row).pipe(Effect.orDie)
    })

    const list = Effect.fn("Installation.admin.list")(function* () {
      const rows = yield* store.listAdmins.pipe(Effect.mapError(() => new UnavailableError({})))
      return rows.map((row) => row.accountID)
    })

    const grant = Effect.fn("Installation.admin.grant")(function* (accountID: Account.ID) {
      const account = (yield* database.use("Installation.grantAccount", (db) =>
        db
          .select({ id: AccountTable.id })
          .from(AccountTable)
          .where(and(eq(AccountTable.id, accountID), isNull(AccountTable.timeDeleted)))
          .limit(1)
          .pipe(Effect.orDie),
      ))[0]
      if (account === undefined) return yield* new NotFoundError({ accountID })
      yield* store.insertAdmin(accountID)
      // The installation.admin.grant Entry is recorded by the edge (Audit.audited).
    })

    const revoke = Effect.fn("Installation.admin.revoke")(function* (accountID: Account.ID) {
      yield* database
        .transact(
          Effect.gen(function* () {
            const admins = yield* store.listAdmins
            if (!admins.some((row) => row.accountID === accountID)) {
              return yield* new NotFoundError({ accountID })
            }
            if (admins.length <= 1) return yield* new LastAdminError({})
            yield* store.deleteAdmin(accountID)
          }),
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.die(new Error("Installation persistence failed"))))
      // The installation.admin.revoke Entry is recorded by the edge (Audit.audited).
    })

    const update = Effect.fn("Installation.policy.update")(function* (policy: Policy) {
      const decoded = yield* Schema.decodeUnknownEffect(Policy)(policy).pipe(
        Effect.mapError(() => new ValidationError({ message: "Installation Policy is invalid" })),
      )
      yield* store.writePolicy(decoded)
      yield* SynchronizedRef.set(cache, Option.some(decoded))
      // The installation.policy.update Entry is recorded by the edge (Audit.audited).
    })

    const check = Effect.fn("Installation.check")(function* (accountID: Account.ID) {
      const rows = yield* store.listAdmins
      return rows.some((row) => row.accountID === accountID)
    })

    const bootstrap = Effect.fn("Installation.bootstrap")(function* (accountID: Account.ID) {
      return yield* database
        .transact(
          Effect.gen(function* () {
            const state = yield* store.ensureState
            if (state === undefined || !state.bootstrapPending) return false
            const admins = yield* store.listAdmins
            if (admins.length > 0) {
              yield* store.setBootstrap(false)
              return false
            }
            yield* store.insertAdmin(accountID)
            yield* store.setBootstrap(false)
            return true
          }),
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.die(new Error("Installation persistence failed"))))
    })

    const arm = store.setBootstrap(true)

    return Service.of({
      admin: { list, grant, revoke },
      policy: {
        get: SynchronizedRef.get(cache).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                load.pipe(
                  Effect.flatMap((policy) => SynchronizedRef.set(cache, Option.some(policy)).pipe(Effect.as(policy))),
                ),
              onSome: Effect.succeed,
            }),
          ),
          Effect.withSpan("Installation.policy.get"),
        ),
        update,
      },
      check,
      bootstrap,
      arm,
    })
  }),
)

/** Process-global Installation governance node. */
export const makeNode = <E>(deps: { readonly database: GlobalNode<Database.Service, E> }) =>
  makeGlobalNode({ service: Service, layer, deps: [deps.database] })

/** Process-global Installation governance node. */
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

/** Compatibility production layer for tests and non-graph callers. */
export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
