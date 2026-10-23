import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as Auth from "./auth.js"

import { Account } from "@bymorning/schema/account"
import { AccountActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import { AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { Cache, Config, Context, DateTime, Duration, Effect, Layer, Redacted, Schema } from "effect"
import { randomBytes } from "node:crypto"
import { Audit } from "./audit.js"
import { AuthProvider } from "./auth-provider.js"
import { ExpiredError, NotFoundError, RejectedError, UnavailableError } from "./auth/error.js"
import { link } from "./auth/identity.js"
import { Oidc } from "./auth/oidc.js"
import { ProvisionError } from "./auth/provision.js"
import { find, insert, listLive, revokeAllRecords, revokeRecord, touch, touchThrottleMillis } from "./auth/session.js"
import { Database } from "./database.js"
import { AccountTable } from "./database/schema/account.sql.js"
import { Installation } from "./installation.js"
import { Storage } from "./storage.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"
import { and, eq, isNull } from "drizzle-orm"

export { ProvisionError } from "./auth/provision.js"
export { ExpiredError, NotFoundError, RejectedError, UnavailableError } from "./auth/error.js"

export const ID = Auth.ID
export type ID = Auth.ID
export const Provider = Auth.Provider
export type Provider = Auth.Provider
export const Sub = Auth.Sub
export type Sub = Auth.Sub
export const Subject = Auth.Subject
export type Subject = Auth.Subject
export const Email = Auth.Email
export type Email = Auth.Email
export const Assertion = Auth.Assertion
export interface Assertion extends Auth.Assertion {}
export const Attempt = Auth.Attempt
export interface Attempt extends Auth.Attempt {}
export const Session = Auth.Session
export interface Session extends Auth.Session {}
export const SessionID = Auth.SessionID
export type SessionID = Auth.SessionID
export const LoginInfo = Auth.LoginInfo
export interface LoginInfo extends Auth.LoginInfo {}

/**
 * Host Login Session limits: SESSION_IDLE_TIMEOUT (default 15 minutes) bounds
 * inactivity; SESSION_ABSOLUTE_TIMEOUT (default 12 hours) bounds the whole
 * lifetime. Both accept Effect duration inputs such as "15 minutes".
 */
export const sessionLimits = Config.all({
  idle: Config.duration("SESSION_IDLE_TIMEOUT").pipe(Config.withDefault(Duration.minutes(15))),
  absolute: Config.duration("SESSION_ABSOLUTE_TIMEOUT").pipe(Config.withDefault(Duration.hours(12))),
})

/** Local development identity used by Auth.open. */
export interface Local {
  readonly subject: Auth.Sub
  readonly email: Auth.Email
}

export type Selection = { readonly type: "oidc"; readonly id: AuthProviderSchema.ID } | { readonly type: "local" }

/** Login runtime and account linking. */
export interface Interface {
  readonly resolve: (assertion: Assertion) => Effect.Effect<AccountActor, RejectedError | ProvisionError>
  readonly open: (input: {
    readonly selection: Selection
    readonly redirectURI: URL
    readonly redirect?: string
  }) => Effect.Effect<{ readonly redirect: URL; readonly attempt: Auth.Attempt }, RejectedError | UnavailableError>
  readonly complete: (input: {
    readonly attempt: Auth.Attempt
    readonly response: Redacted.Redacted<URLSearchParams>
  }) => Effect.Effect<
    { readonly actor: AccountActor; readonly session: Auth.Session },
    RejectedError | ExpiredError | ProvisionError | UnavailableError
  >
  readonly authenticate: (
    session: Auth.Session,
  ) => Effect.Effect<AccountActor, RejectedError | ExpiredError | UnavailableError>
  readonly end: (session: Auth.Session) => Effect.Effect<void, UnavailableError>
  /** Live Login Sessions of the calling Account, newest first. */
  readonly list: (account: AccountActor) => Effect.Effect<ReadonlyArray<Auth.LoginInfo>, UnavailableError>
  /** Revoke one Login Session owned by the calling Account. */
  readonly revoke: (account: AccountActor, id: Auth.SessionID) => Effect.Effect<void, NotFoundError>
  /** Revoke every live Login Session of one Account (suspension and installation administration). */
  readonly revokeAll: (accountID: Account.ID) => Effect.Effect<void>
}

/** Login runtime and account linking. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Auth") {}

const unavailable = (operation: UnavailableError["operation"]) =>
  new UnavailableError({ operation, message: "Authentication is unavailable" })

/**
 * PostgreSQL-backed Auth implementation. `domains` admits Local Login and
 * `resolve` assertions only; OIDC logins use the Auth Provider's domains.
 * The default admits nothing: every host names its admitted domains explicitly.
 */
export const layerWith = (domains: readonly string[], local?: Local) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const storage = yield* Storage.Service
      const audit = yield* Audit.Service
      const authProviders = yield* AuthProvider.Service
      const limits = yield* sessionLimits
      const installation = yield* Installation.Service
      const locals = yield* Cache.make({
        capacity: 128,
        timeToLive: "10 minutes",
        lookup: (
          _key: string,
        ): Effect.Effect<{ readonly verifier: string; readonly redirectURI: string }, RejectedError> =>
          Effect.fail(new RejectedError({ reason: "callback", message: "Authentication failed" })),
      })

      const resolve = Effect.fn("Auth.resolve")(function* (assertion: Assertion) {
        return yield* link(database, storage, installation, audit, domains, {
          provider: assertion.provider,
          sub: assertion.subject,
          email: assertion.verifiedEmail,
          emailVerified: true,
        })
      })

      const open = Effect.fn("Auth.open")(function* (input: {
        readonly selection: Selection
        readonly redirectURI: URL
        readonly redirect?: string
      }) {
        const now = yield* DateTime.now
        const expiresAt = DateTime.addDuration(now, "10 minutes")
        if (input.selection.type === "local") {
          if (local === undefined) {
            return yield* new RejectedError({ reason: "local-disabled", message: "Local Login is not enabled" })
          }
          if (
            input.redirectURI.protocol !== "http:" ||
            !["localhost", "127.0.0.1", "[::1]"].includes(input.redirectURI.hostname)
          ) {
            return yield* unavailable("open")
          }
          const code = randomBytes(32).toString("base64url")
          const state = randomBytes(32).toString("base64url")
          const verifier = randomBytes(32).toString("base64url")
          yield* Cache.set(locals, code, { verifier, redirectURI: input.redirectURI.href })
          const redirect = new URL(input.redirectURI)
          redirect.searchParams.set("code", code)
          redirect.searchParams.set("state", state)
          return {
            redirect,
            attempt: Auth.Attempt.make({
              version: 1,
              type: "attempt",
              binding: { type: "local" },
              state: Redacted.make(state),
              verifier: Redacted.make(verifier),
              redirectURI: input.redirectURI,
              ...(input.redirect === undefined ? {} : { redirect: input.redirect }),
              expiresAt,
            }),
          }
        }
        const active = yield* authProviders.resolve({ id: input.selection.id }).pipe(
          Effect.mapError((error) => {
            if (error._tag === "AuthProvider.MissingError") {
              return new RejectedError({ reason: "provider-missing", message: "Auth Provider not found" })
            }
            if (error._tag === "AuthProvider.DisabledError") {
              return new RejectedError({ reason: "provider-disabled", message: "Auth Provider is disabled" })
            }
            if (error._tag === "AuthProvider.ConflictError") {
              return new RejectedError({ reason: "provider-changed", message: "Auth Provider changed" })
            }
            return unavailable("open")
          }),
        )
        const started = yield* Oidc.start(active, input.redirectURI)
        return {
          redirect: started.redirect,
          attempt: Auth.Attempt.make({
            version: 1,
            type: "attempt",
            binding: { type: "oidc", provider: { id: active.id, revision: active.revision } },
            state: started.state,
            verifier: started.verifier,
            redirectURI: input.redirectURI,
            ...(input.redirect === undefined ? {} : { redirect: input.redirect }),
            expiresAt,
          }),
        }
      })

      const complete = Effect.fn("Auth.complete")(function* (input: {
        readonly attempt: Auth.Attempt
        readonly response: Redacted.Redacted<URLSearchParams>
      }) {
        const now = yield* DateTime.now
        if (DateTime.isLessThanOrEqualTo(input.attempt.expiresAt, now)) {
          return yield* new ExpiredError({ reason: "attempt", message: "Login attempt expired" })
        }
        const params = Redacted.value(input.response)
        if (Redacted.value(input.attempt.state) !== params.get("state")) {
          return yield* new RejectedError({ reason: "state", message: "Authentication failed" })
        }
        const binding = input.attempt.binding
        // Local Login admits the host list; an OIDC Subject is admitted only on
        // the domains of the Auth Provider that verified it.
        const resolved = yield* binding.type === "local"
          ? Effect.gen(function* () {
              if (local === undefined) {
                return yield* new RejectedError({ reason: "local-disabled", message: "Local Login is not enabled" })
              }
              const code = params.get("code")
              if (code === null)
                return yield* new RejectedError({ reason: "callback", message: "Authentication failed" })
              const pending = yield* Cache.get(locals, code)
              yield* Cache.invalidate(locals, code)
              if (
                pending.verifier !== Redacted.value(input.attempt.verifier) ||
                pending.redirectURI !== input.attempt.redirectURI.href
              ) {
                return yield* new RejectedError({ reason: "callback", message: "Authentication failed" })
              }
              return {
                subject: Auth.LocalSubject.make({ type: "local", sub: local.subject, email: local.email }),
                admitted: domains,
              }
            })
          : Effect.gen(function* () {
              const active = yield* authProviders
                .resolve({ id: binding.provider.id, revision: binding.provider.revision })
                .pipe(
                  Effect.mapError((error) => {
                    if (error._tag === "AuthProvider.ConflictError") {
                      return new RejectedError({ reason: "provider-changed", message: "Auth Provider changed" })
                    }
                    if (error._tag === "AuthProvider.DisabledError") {
                      return new RejectedError({ reason: "provider-disabled", message: "Auth Provider is disabled" })
                    }
                    if (error._tag === "AuthProvider.MissingError") {
                      return new RejectedError({ reason: "provider-missing", message: "Auth Provider not found" })
                    }
                    return unavailable("complete")
                  }),
                )
              const subject = yield* Oidc.complete({ active, attempt: input.attempt, response: input.response })
              return { subject, admitted: active.domains }
            })
        const { subject, admitted } = resolved
        const linked =
          subject.type === "local"
            ? {
                provider: Auth.Provider.make("local"),
                sub: subject.sub,
                email: subject.email,
                emailVerified: true,
              }
            : {
                provider: Auth.Provider.make(subject.provider.id),
                sub: subject.sub,
                email: subject.email,
                emailVerified: subject.emailVerified,
              }
        // The login Entry commits with the account link: a failed append rolls
        // the whole login back (fail-closed).
        const actor = yield* database
          .transact(
            Effect.gen(function* () {
              const actor = yield* link(database, storage, installation, audit, admitted, linked)
              yield* audit.record({
                actor: Audit.principal(actor),
                action: "auth.login",
                target: actor.properties.accountID,
                detail: { provider: linked.provider },
                outcome: "success",
              })
              return actor
            }),
          )
          .pipe(
            Effect.catchTags({
              SqlError: () => Effect.fail(unavailable("complete")),
              "Audit.StoreError": () => Effect.fail(unavailable("complete")),
            }),
          )
        const issuedAt = yield* DateTime.now
        const id = Auth.SessionID.create()
        const expiresAt = DateTime.addDuration(issuedAt, limits.absolute)
        yield* insert(database, {
          id,
          accountID: actor.properties.accountID,
          issuedAt: DateTime.toDate(issuedAt),
          expiresAt: DateTime.toDate(expiresAt),
          idleExpiresAt: DateTime.toDate(DateTime.addDuration(issuedAt, limits.idle)),
        }).pipe(Effect.mapError(() => unavailable("complete")))
        return {
          actor,
          session: Auth.Session.make({
            version: 2,
            type: "session",
            id,
            accountID: actor.properties.accountID,
            issuedAt,
            expiresAt,
          }),
        }
      },
      Effect.tapError((error) =>
        // Deterministic rejections are recorded as failed logins. UnavailableError
        // paths (including a failed fail-closed success record) are not
        // re-recorded: the store is the failing component there.
        error._tag === "Auth.RejectedError" || error._tag === "Auth.ExpiredError" || error._tag === "Auth.ProvisionError"
          ? audit
              .record({
                actor: Audit.anonymous(),
                action: "auth.login",
                outcome: "failure",
                detail: { reason: error._tag === "Auth.ProvisionError" ? "provision" : error.reason },
              })
              .pipe(
                Effect.catchTag("Audit.StoreError", (cause) =>
                  Effect.logError("Audit could not record a failed login", cause),
                ),
              )
          : Effect.void,
      ),
    )

      const authenticate = Effect.fn("Auth.authenticate")(function* (session: Auth.Session) {
        const now = yield* DateTime.now
        if (DateTime.isLessThanOrEqualTo(session.expiresAt, now)) {
          // Absolute expiry is durable Login Session state; no separate Entry is recorded.
          return yield* new ExpiredError({ reason: "session", message: "Login Session expired" })
        }
        const nowDate = DateTime.toDate(now)
        const record = yield* find(database, session.id, session.accountID).pipe(
          Effect.mapError(() => unavailable("authenticate")),
        )
        if (record === undefined || record.revokedAt !== null) {
          return yield* new RejectedError({ reason: "session-revoked", message: "Login Session was revoked" })
        }
        if (record.expiresAt <= nowDate) {
          return yield* new ExpiredError({ reason: "session", message: "Login Session expired" })
        }
        if (record.idleExpiresAt <= nowDate) {
          return yield* new RejectedError({ reason: "session-idle", message: "Login Session expired from inactivity" })
        }
        const row = (yield* database
          .use("Auth.authenticate", (db) =>
            db
              .select({ id: AccountTable.id })
              .from(AccountTable)
              .where(
                and(
                  eq(AccountTable.id, session.accountID),
                  eq(AccountTable.status, "active"),
                  isNull(AccountTable.timeDeleted),
                ),
              )
              .limit(1)
              .pipe(Effect.orDie),
          )
          .pipe(Effect.mapError(() => unavailable("authenticate"))))[0]
        if (row === undefined) {
          return yield* new RejectedError({ reason: "account-unavailable", message: "Account is unavailable" })
        }
        if (nowDate.getTime() - record.touchedAt.getTime() >= touchThrottleMillis) {
          yield* touch(database, session.id, nowDate, Duration.toMillis(limits.idle), record.expiresAt).pipe(
            Effect.mapError(() => unavailable("authenticate")),
          )
        }
        return new AccountActor({ type: "account", properties: { accountID: row.id } })
      })

      const end = Effect.fn("Auth.end")(function* (session: Auth.Session) {
        const now = yield* DateTime.nowAsDate
        yield* database
          .transact(
            Effect.gen(function* () {
              yield* revokeRecord(database, session.id, session.accountID, now)
              // The revocation Entry commits with the session write (fail-closed).
              yield* audit.record({
                actor: { type: "account", accountID: session.accountID },
                action: "auth.session.revoke",
                target: session.id,
                detail: { reason: "logout" },
                outcome: "success",
              })
            }),
          )
          .pipe(Effect.mapError(() => unavailable("end")))
      })

      const list = Effect.fn("Auth.list")(function* (account: AccountActor) {
        const now = yield* DateTime.nowAsDate
        const rows = yield* listLive(database, account.properties.accountID, now).pipe(
          Effect.mapError(() => unavailable("list")),
        )
        return rows.map((row) =>
          Auth.LoginInfo.make({
            id: row.id,
            createdAt: DateTime.fromDateUnsafe(row.createdAt),
            activeAt: DateTime.fromDateUnsafe(row.touchedAt),
            idleUntil: DateTime.fromDateUnsafe(row.idleExpiresAt),
            expiresAt: DateTime.fromDateUnsafe(row.expiresAt),
          }),
        )
      })

      const revoke = Effect.fn("Auth.revoke")(function* (account: AccountActor, id: Auth.SessionID) {
        const now = yield* DateTime.nowAsDate
        const revoked = yield* database
          .transact(
            Effect.gen(function* () {
              const revoked = yield* revokeRecord(database, id, account.properties.accountID, now)
              if (!revoked) return false
              // The revocation Entry commits with the session write (fail-closed).
              yield* audit.record({
                actor: Audit.principal(account),
                action: "auth.session.revoke",
                target: id,
                outcome: "success",
              })
              return true
            }),
          )
          .pipe(Effect.orDie)
        if (!revoked) return yield* new NotFoundError({})
      })

      const revokeAll = Effect.fn("Auth.revokeAll")(function* (accountID: Account.ID) {
        const now = yield* DateTime.nowAsDate
        yield* database
          .transact(
            Effect.gen(function* () {
              const revoked = yield* revokeAllRecords(database, accountID, now)
              yield* Effect.forEach(revoked, (session) =>
                audit.record({
                  actor: { type: "account", accountID },
                  action: "auth.session.revoke",
                  target: session.id,
                  detail: { reason: "revoke-all" },
                  outcome: "success",
                }),
              )
            }),
          )
          .pipe(Effect.orDie)
      })

      return Service.of({ resolve, open, complete, authenticate, end, list, revoke, revokeAll })
    }),
  )

export const layer = layerWith([])

export const makeNode = <EDatabase, EStorage>(
  deps: {
    readonly database: GlobalNode<Database.Service, EDatabase>
    readonly storage: GlobalNode<Storage.Service, EStorage>
  },
  domains: readonly string[] = [],
  local?: Local,
) =>
  makeGlobalNode({
    service: Service,
    layer: layerWith(domains, local),
    deps: [deps.database, deps.storage, Audit.node, AuthProvider.node, Installation.node],
  })

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Storage.node, Audit.node, AuthProvider.node, Installation.node],
})
