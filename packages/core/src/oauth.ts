import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as OAuth from "./oauth.js"

import { Account } from "@bymorning/schema/account"
import { AccountActor } from "@bymorning/schema/actor"
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { OAuthClient } from "@bymorning/schema/oauth-client"
import { OAuthGrant } from "@bymorning/schema/oauth-grant"
import { Workspace } from "@bymorning/schema/workspace"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { Audit } from "./audit.js"
import { Database } from "./database.js"
import { AccountTable } from "./database/schema/account.sql.js"
import { OAuthAuthorizationTable, OAuthClientTable, OAuthGrantTable } from "./database/schema/oauth.sql.js"
import { UserTable } from "./database/schema/user.sql.js"
import { WorkspaceTable } from "./database/schema/workspace.sql.js"
import { User } from "./user.js"
import { makeGlobalNode } from "@bymorning/util/effect/app-node"

export class RequestNotFoundError extends Schema.TaggedError<RequestNotFoundError>()("OAuth.RequestNotFoundError", {
  requestID: OAuthAuthorization.ID,
}) {}
export class InvalidGrantError extends Schema.TaggedError<InvalidGrantError>()("OAuth.InvalidGrantError", {}) {}
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("OAuth.NotFoundError", {
  id: OAuthGrant.ID,
}) {}

export interface Interface {
  readonly register: (input: {
    name?: string
    redirectUris: ReadonlyArray<string>
  }) => Effect.Effect<{ id: OAuthClient.ID }>
  readonly client: (
    id: OAuthClient.ID,
  ) => Effect.Effect<{ id: OAuthClient.ID; name: string | null; redirectUris: ReadonlyArray<string> } | undefined>
  readonly authorize: (input: {
    clientID: OAuthClient.ID
    redirectURI: string
    state?: string
    codeChallenge: string
  }) => Effect.Effect<OAuthAuthorization.ID>
  readonly request: (
    id: OAuthAuthorization.ID,
  ) => Effect.Effect<{ clientID: OAuthClient.ID; clientName: string }, RequestNotFoundError>
  readonly approve: (input: {
    requestID: OAuthAuthorization.ID
    workspaceID: Workspace.ID
    account: AccountActor
  }) => Effect.Effect<string, RequestNotFoundError | User.AccessError>
  readonly deny: (id: OAuthAuthorization.ID) => Effect.Effect<string, RequestNotFoundError>
  readonly exchangeCode: (input: {
    code: string
    verifier: string
    clientID: OAuthClient.ID
    redirectURI: string
  }) => Effect.Effect<Tokens, InvalidGrantError>
  readonly refresh: (input: {
    refreshToken: string
    clientID: OAuthClient.ID
  }) => Effect.Effect<Tokens, InvalidGrantError>
  readonly resolveAccess: (token: string) => Effect.Effect<Authority | undefined>
  /** Grants owned by the calling Account, newest first. */
  readonly list: (account: AccountActor) => Effect.Effect<ReadonlyArray<GrantInfo>>
  /** Revoke one grant owned by the calling Account; access dies with the row. */
  readonly revoke: (account: AccountActor, id: OAuthGrant.ID) => Effect.Effect<void, NotFoundError>
  /** Revoke every grant of one Account (suspension and installation administration). */
  readonly revokeAll: (accountID: Account.ID) => Effect.Effect<void>
}

export interface Tokens {
  readonly accessToken: string
  readonly refreshToken: string
}
export interface GrantInfo extends OAuthGrant.Info {}
export interface Authority {
  readonly workspaceID: Workspace.ID
  readonly accountID: import("@bymorning/schema/account").ID
  readonly userID: import("@bymorning/schema/user").ID
  readonly role: import("@bymorning/schema/user").Role
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/OAuth") {}

const hash = (value: string) => createHash("sha256").update(value, "ascii").digest("hex")
const token = () => randomBytes(32).toString("base64url")
/** Access tokens stay short-lived; every use is hash-checked against the grant row. */
const accessLifetimeMillis = 3_600_000
/** Refresh tokens expire 30 days after the grant is issued; rotation never extends it. */
const refreshLifetimeMillis = 30 * 24 * 3_600_000
const redirect = (uri: string, values: Record<string, string | undefined>) => {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.append(key, value)
  return url.href
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const users = yield* User.Service
    const audit = yield* Audit.Service
    const register = Effect.fn("OAuth.register")(function* (input: {
      name?: string
      redirectUris: ReadonlyArray<string>
    }) {
      const id = OAuthClient.ID.create()
      yield* database
        .use("OAuth.register", (db) =>
          db.insert(OAuthClientTable).values({ id, name: input.name, redirectUris: input.redirectUris }),
        )
        .pipe(Effect.orDie)
      return { id }
    })
    const client = Effect.fn("OAuth.client")(function* (id: OAuthClient.ID) {
      return (yield* database
        .use("OAuth.client", (db) =>
          db
            .select({
              id: OAuthClientTable.id,
              name: OAuthClientTable.name,
              redirectUris: OAuthClientTable.redirectUris,
            })
            .from(OAuthClientTable)
            .where(and(eq(OAuthClientTable.id, id), isNull(OAuthClientTable.timeDeleted)))
            .limit(1),
        )
        .pipe(Effect.orDie))[0]
    })
    const authorize = Effect.fn("OAuth.authorize")(function* (input: {
      clientID: OAuthClient.ID
      redirectURI: string
      state?: string
      codeChallenge: string
    }) {
      const id = OAuthAuthorization.ID.create()
      const now = new Date()
      yield* database
        .use("OAuth.authorize", (db) =>
          db.insert(OAuthAuthorizationTable).values({
            id,
            clientId: input.clientID,
            redirect_uri: input.redirectURI,
            state: input.state,
            code_challenge: input.codeChallenge,
            status: "pending",
            timeExpires: new Date(now.getTime() + 600_000),
          }),
        )
        .pipe(Effect.orDie)
      return id
    })
    const pending = Effect.fn("OAuth.pending")(function* (id: OAuthAuthorization.ID) {
      const row = (yield* database
        .use("OAuth.pending", (db) =>
          db
            .select()
            .from(OAuthAuthorizationTable)
            .innerJoin(OAuthClientTable, eq(OAuthClientTable.id, OAuthAuthorizationTable.clientId))
            .where(
              and(
                eq(OAuthAuthorizationTable.id, id),
                eq(OAuthAuthorizationTable.status, "pending"),
                gt(OAuthAuthorizationTable.timeExpires, new Date()),
                isNull(OAuthAuthorizationTable.timeDeleted),
                isNull(OAuthClientTable.timeDeleted),
              ),
            )
            .limit(1),
        )
        .pipe(Effect.orDie))[0]
      if (row === undefined) return yield* new RequestNotFoundError({ requestID: id })
      return row
    })
    const request = Effect.fn("OAuth.request")(function* (id: OAuthAuthorization.ID) {
      const row = yield* pending(id)
      return { clientID: row.oauth_client.id, clientName: row.oauth_client.name ?? row.oauth_client.id }
    })
    const approve = Effect.fn("OAuth.approve")(function* (input: {
      requestID: OAuthAuthorization.ID
      workspaceID: Workspace.ID
      account: AccountActor
    }) {
      yield* pending(input.requestID)
      const actor = yield* users.select({ account: input.account, workspaceID: input.workspaceID })
      return yield* database
        .transact(
          Effect.gen(function* () {
            const row = yield* pending(input.requestID)
            const code = token()
            const changed = yield* database
              .use("OAuth.approve", (db) =>
                db
                  .update(OAuthAuthorizationTable)
                  .set({
                    status: "approved",
                    code_hash: hash(code),
                    accountId: actor.properties.accountID,
                    userId: actor.properties.userID,
                    workspaceId: actor.properties.workspaceID,
                  })
                  .where(
                    and(
                      eq(OAuthAuthorizationTable.id, input.requestID),
                      eq(OAuthAuthorizationTable.status, "pending"),
                      gt(OAuthAuthorizationTable.timeExpires, new Date()),
                    ),
                  )
                  .returning({ id: OAuthAuthorizationTable.id }),
              )
              .pipe(Effect.orDie)
            if (changed.length === 0) return yield* new RequestNotFoundError({ requestID: input.requestID })
            return redirect(row.oauth_authorization.redirect_uri, {
              code,
              state: row.oauth_authorization.state ?? undefined,
            })
          }),
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.die(new Error("OAuth persistence failed"))))
    })
    const deny = Effect.fn("OAuth.deny")(function* (id: OAuthAuthorization.ID) {
      return yield* database
        .transact(
          Effect.gen(function* () {
            const row = yield* pending(id)
            const changed = yield* database
              .use("OAuth.deny", (db) =>
                db
                  .update(OAuthAuthorizationTable)
                  .set({ status: "consumed" })
                  .where(
                    and(
                      eq(OAuthAuthorizationTable.id, id),
                      eq(OAuthAuthorizationTable.status, "pending"),
                      gt(OAuthAuthorizationTable.timeExpires, new Date()),
                    ),
                  )
                  .returning({ id: OAuthAuthorizationTable.id }),
              )
              .pipe(Effect.orDie)
            if (changed.length === 0) return yield* new RequestNotFoundError({ requestID: id })
            return redirect(row.oauth_authorization.redirect_uri, {
              error: "access_denied",
              state: row.oauth_authorization.state ?? undefined,
            })
          }),
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.die(new Error("OAuth persistence failed"))))
    })
    const exchangeCode = Effect.fn("OAuth.exchangeCode")(function* (input: {
      code: string
      verifier: string
      clientID: OAuthClient.ID
      redirectURI: string
    }) {
      const result = yield* database
        .transact(
          Effect.gen(function* () {
            const row = (yield* database.use("OAuth.code", (db) =>
              db
                .select()
                .from(OAuthAuthorizationTable)
                .where(eq(OAuthAuthorizationTable.code_hash, hash(input.code)))
                .limit(1),
            ))[0]
            const reusedGrantID = row?.status === "consumed" ? row.grantId : null
            if (reusedGrantID !== null && reusedGrantID !== undefined) {
              yield* database.use("OAuth.revokeReuse", (db) =>
                db.delete(OAuthGrantTable).where(eq(OAuthGrantTable.id, reusedGrantID)),
              )
              return undefined
            }
            if (
              row === undefined ||
              row.status !== "approved" ||
              row.timeExpires <= new Date() ||
              row.clientId !== input.clientID ||
              row.redirect_uri !== input.redirectURI ||
              row.code_challenge !==
                Buffer.from(createHash("sha256").update(input.verifier, "ascii").digest()).toString("base64url") ||
              row.accountId === null ||
              row.userId === null ||
              row.workspaceId === null
            )
              return undefined
            const accessToken = token()
            const refreshToken = token()
            const grantId = OAuthGrant.ID.create()
            const authority = {
              clientId: row.clientId,
              accountId: row.accountId,
              userId: row.userId,
              workspaceId: row.workspaceId,
            }
            yield* database.use("OAuth.grant", (db) =>
              db.insert(OAuthGrantTable).values({
                id: grantId,
                ...authority,
                access_hash: hash(accessToken),
                refresh_hash: hash(refreshToken),
                timeAccessExpires: new Date(Date.now() + accessLifetimeMillis),
                timeRefreshExpires: new Date(Date.now() + refreshLifetimeMillis),
              }),
            )
            const consumed = yield* database.use("OAuth.consumeCode", (db) =>
              db
                .update(OAuthAuthorizationTable)
                .set({ status: "consumed", grantId })
                .where(and(eq(OAuthAuthorizationTable.id, row.id), eq(OAuthAuthorizationTable.status, "approved")))
                .returning({ id: OAuthAuthorizationTable.id }),
            )
            if (consumed.length === 0) {
              yield* database.use("OAuth.revokeRacedCode", (db) =>
                db.delete(OAuthGrantTable).where(eq(OAuthGrantTable.id, grantId)),
              )
              return undefined
            }
            // The Entry commits with the grant (fail-closed); a failed append
            // defects the exchange and the grant never exists unaudited.
            yield* audit.record({
              actor: {
                type: "user",
                accountID: authority.accountId,
                userID: authority.userId,
                workspaceID: authority.workspaceId,
              },
              action: "oauth.grant.create",
              workspaceID: authority.workspaceId,
              target: grantId,
              detail: { clientID: input.clientID },
              outcome: "success",
            })
            return { accessToken, refreshToken }
          }).pipe(Effect.orDie),
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.die(new Error("OAuth persistence failed"))))
      if (result === undefined) return yield* new InvalidGrantError({})
      return result
    })
    const refresh = Effect.fn("OAuth.refresh")(function* (input: { refreshToken: string; clientID: OAuthClient.ID }) {
      const presented = hash(input.refreshToken)
      const result = yield* database
        .transact(
          Effect.gen(function* () {
            const now = new Date()
            const active = (yield* database.use("OAuth.refreshAuthority", (db) =>
              db
                .select({ id: OAuthGrantTable.id })
                .from(OAuthGrantTable)
                .innerJoin(
                  AccountTable,
                  and(
                    eq(AccountTable.id, OAuthGrantTable.accountId),
                    eq(AccountTable.status, "active"),
                    isNull(AccountTable.timeDeleted),
                  ),
                )
                .innerJoin(
                  UserTable,
                  and(
                    eq(UserTable.id, OAuthGrantTable.userId),
                    eq(UserTable.workspaceId, OAuthGrantTable.workspaceId),
                    eq(UserTable.accountId, OAuthGrantTable.accountId),
                    isNull(UserTable.timeDeleted),
                  ),
                )
                .innerJoin(
                  WorkspaceTable,
                  and(
                    eq(WorkspaceTable.id, OAuthGrantTable.workspaceId),
                    eq(WorkspaceTable.status, "active"),
                    isNull(WorkspaceTable.timeDeleted),
                  ),
                )
                .where(
                  and(
                    eq(OAuthGrantTable.refresh_hash, presented),
                    eq(OAuthGrantTable.clientId, input.clientID),
                    gt(OAuthGrantTable.timeRefreshExpires, now),
                    isNull(OAuthGrantTable.timeDeleted),
                  ),
                )
                .limit(1),
            ))[0]
            if (active !== undefined) {
              const accessToken = token()
              const refreshToken = token()
              const changed = yield* database.use("OAuth.refresh", (db) =>
                db
                  .update(OAuthGrantTable)
                  .set({
                    access_hash: hash(accessToken),
                    superseded_refresh_hash: presented,
                    refresh_hash: hash(refreshToken),
                    timeAccessExpires: new Date(now.getTime() + accessLifetimeMillis),
                  })
                  .where(and(eq(OAuthGrantTable.id, active.id), eq(OAuthGrantTable.refresh_hash, presented)))
                  .returning({ id: OAuthGrantTable.id }),
              )
              if (changed.length > 0) return { accessToken, refreshToken }
              // Lost a rotation race: fall through to superseded-hash reuse detection.
            }
            // A presented hash that was rotated out is refresh-token reuse:
            // revoke the whole grant family (OAuth 2.0 Security BCP).
            const reused = (yield* database.use("OAuth.refreshReuse", (db) =>
              db
                .select({ id: OAuthGrantTable.id, workspaceID: OAuthGrantTable.workspaceId })
                .from(OAuthGrantTable)
                .where(
                  and(
                    eq(OAuthGrantTable.superseded_refresh_hash, presented),
                    eq(OAuthGrantTable.clientId, input.clientID),
                    isNull(OAuthGrantTable.timeDeleted),
                  ),
                )
                .limit(1),
            ))[0]
            if (reused !== undefined) {
              yield* database.use("OAuth.revokeFamily", (db) =>
                db.delete(OAuthGrantTable).where(eq(OAuthGrantTable.id, reused.id)),
              )
              // Refresh-token reuse revokes the whole grant family; the Entry
              // commits with the deletion (fail-closed).
              yield* audit.record({
                actor: Audit.system(reused.workspaceID),
                action: "oauth.grant.revoke",
                workspaceID: reused.workspaceID,
                target: reused.id,
                detail: { clientID: input.clientID, reason: "refresh-reuse" },
                outcome: "success",
              })
            }
            return undefined
          }).pipe(Effect.orDie),
        )
        .pipe(Effect.catchTag("SqlError", () => Effect.die(new Error("OAuth persistence failed"))))
      if (result === undefined) return yield* new InvalidGrantError({})
      return result
    })
    const resolveAccess = Effect.fn("OAuth.resolveAccess")(function* (value: string) {
      return (yield* database
        .use("OAuth.resolveAccess", (db) =>
          db
            .select({
              accountID: OAuthGrantTable.accountId,
              userID: OAuthGrantTable.userId,
              workspaceID: OAuthGrantTable.workspaceId,
              role: UserTable.role,
            })
            .from(OAuthGrantTable)
            .innerJoin(
              AccountTable,
              and(
                eq(AccountTable.id, OAuthGrantTable.accountId),
                eq(AccountTable.status, "active"),
                isNull(AccountTable.timeDeleted),
              ),
            )
            .innerJoin(
              UserTable,
              and(
                eq(UserTable.id, OAuthGrantTable.userId),
                eq(UserTable.workspaceId, OAuthGrantTable.workspaceId),
                eq(UserTable.accountId, OAuthGrantTable.accountId),
                isNull(UserTable.timeDeleted),
              ),
            )
            .innerJoin(
              WorkspaceTable,
              and(
                eq(WorkspaceTable.id, OAuthGrantTable.workspaceId),
                eq(WorkspaceTable.status, "active"),
                isNull(WorkspaceTable.timeDeleted),
              ),
            )
            .where(
              and(
                eq(OAuthGrantTable.access_hash, hash(value)),
                gt(OAuthGrantTable.timeAccessExpires, new Date()),
                isNull(OAuthGrantTable.timeDeleted),
              ),
            )
            .limit(1),
        )
        .pipe(Effect.orDie))[0]
    })
    const list = Effect.fn("OAuth.list")(function* (account: AccountActor) {
      const rows = yield* database
        .use("OAuth.list", (db) =>
          db
            .select({
              id: OAuthGrantTable.id,
              clientID: OAuthGrantTable.clientId,
              clientName: OAuthClientTable.name,
              createdAt: OAuthGrantTable.timeCreated,
              updatedAt: OAuthGrantTable.timeUpdated,
              expiresAt: OAuthGrantTable.timeRefreshExpires,
            })
            .from(OAuthGrantTable)
            .innerJoin(OAuthClientTable, eq(OAuthClientTable.id, OAuthGrantTable.clientId))
            .where(
              and(
                eq(OAuthGrantTable.accountId, account.properties.accountID),
                isNull(OAuthGrantTable.timeDeleted),
                isNull(OAuthClientTable.timeDeleted),
              ),
            )
            .orderBy(desc(OAuthGrantTable.timeCreated)),
        )
        .pipe(Effect.orDie)
      return rows.map((row): GrantInfo => ({
        id: row.id,
        clientID: row.clientID,
        clientName: row.clientName ?? row.clientID,
        createdAt: DateTime.fromDateUnsafe(row.createdAt),
        updatedAt: DateTime.fromDateUnsafe(row.updatedAt),
        expiresAt: DateTime.fromDateUnsafe(row.expiresAt),
      }))
    })
    const revoke = Effect.fn("OAuth.revoke")(function* (account: AccountActor, id: OAuthGrant.ID) {
      const changed = yield* database
        .transact(
          Effect.gen(function* () {
            const rows = yield* database.use("OAuth.revoke", (db) =>
              db
                .delete(OAuthGrantTable)
                .where(
                  and(
                    eq(OAuthGrantTable.id, id),
                    eq(OAuthGrantTable.accountId, account.properties.accountID),
                    isNull(OAuthGrantTable.timeDeleted),
                  ),
                )
                .returning({ id: OAuthGrantTable.id, workspaceID: OAuthGrantTable.workspaceId }),
            )
            if (rows.length === 0) return false
            // Access dies with the row: resolveAccess hash-checks the table on
            // every call. The Entry commits with the deletion (fail-closed).
            const grant = rows[0]!
            yield* audit.record({
              actor: Audit.principal(account),
              action: "oauth.grant.revoke",
              workspaceID: grant.workspaceID,
              target: id,
              outcome: "success",
            })
            return true
          }),
        )
        .pipe(Effect.orDie)
      if (!changed) return yield* new NotFoundError({ id })
    })
    const revokeAll = Effect.fn("OAuth.revokeAll")(function* (accountID: Account.ID) {
      yield* database
        .transact(
          Effect.gen(function* () {
            const revoked = yield* database.use("OAuth.revokeAll", (db) =>
              db
                .delete(OAuthGrantTable)
                .where(eq(OAuthGrantTable.accountId, accountID))
                .returning({ id: OAuthGrantTable.id, workspaceID: OAuthGrantTable.workspaceId }),
            )
            yield* Effect.forEach(revoked, (grant) =>
              audit.record({
                actor: Audit.system(grant.workspaceID),
                action: "oauth.grant.revoke",
                workspaceID: grant.workspaceID,
                target: grant.id,
                detail: { reason: "account" },
                outcome: "success",
              }),
            )
          }),
        )
        .pipe(Effect.orDie)
    })
    return Service.of({
      register,
      client,
      authorize,
      request,
      approve,
      deny,
      exchangeCode,
      refresh,
      resolveAccess,
      list,
      revoke,
      revokeAll,
    })
  }),
)

export const makeNode = <E>(deps: {
  readonly database: GlobalNode<Database.Service, E>
  readonly user: GlobalNode<User.Service, E>
}) => makeGlobalNode({ service: Service, layer, deps: [deps.database, deps.user, Audit.node] })

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, User.node, Audit.node] })
