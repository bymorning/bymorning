import type { GlobalNode } from "@bymorning/util/effect/app-node"
export * as Credential from "./credential.js"

import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Array, Clock, Context, Effect, Layer, Option, Redacted, Schema, pipe } from "effect"
import { createHash } from "node:crypto"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { Form } from "./form.js"
import { CredentialTable, Database } from "./database.js"
import { Cipher } from "./cipher.js"
import { Actor } from "./actor.js"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const AwsBearer = Credential.AwsBearer
export type AwsBearer = Credential.AwsBearer

export const AwsSigV4 = Credential.AwsSigV4
export type AwsSigV4 = Credential.AwsSigV4

export const AwsRegionConfiguration = Credential.AwsRegionConfiguration
export type AwsRegionConfiguration = Credential.AwsRegionConfiguration

export const Values = Credential.Values
export type Values = Credential.Values

export const Value = Credential.Value
export type Value = Credential.Value

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
  scope: Schema.optionalKey(Credential.Scope),
  active: Schema.optionalKey(Schema.Boolean),
}) {}

/** Identifies workspace OAuth application configuration. */
export interface ClientKey {
  readonly integrationID: Integration.ID
  readonly methodID: Integration.MethodID
}

const errorFields = { integrationID: Integration.ID, methodID: Integration.MethodID }

/** Required OAuth application configuration has not been saved. */
export class MissingError extends Schema.TaggedError<MissingError>()(
  "IntegrationOAuthClientConfiguration.NotConfiguredError",
  errorFields,
) {}

/** Saved or submitted OAuth application fields are invalid. */
export class InvalidError extends Schema.TaggedError<InvalidError>()(
  "IntegrationOAuthClientConfiguration.InvalidError",
  errorFields,
) {}

/** OAuth application configuration could not be persisted or read. */
export class StorageError extends Schema.TaggedError<StorageError>()(
  "IntegrationOAuthClientConfiguration.StorageError",
  { ...errorFields, operation: Schema.Literals(["configured", "resolve", "put", "remove"]) },
) {}

/** Workspace OAuth application configuration held in the credential store. */
export interface Client {
  readonly configured: (keys: readonly ClientKey[]) => Effect.Effect<readonly ClientKey[], StorageError>
  readonly resolve: (
    key: ClientKey,
    fields: Form.Fields | undefined,
  ) => Effect.Effect<Form.Answer, MissingError | InvalidError | StorageError>
  readonly put: (
    key: ClientKey,
    fields: Form.Fields,
    answer: Form.Answer,
  ) => Effect.Effect<void, InvalidError | StorageError>
  readonly remove: (key: ClientKey) => Effect.Effect<boolean, StorageError>
}

export interface Interface {
  /** Workspace OAuth client setup, excluded from connection inventory. */
  readonly client: Client
  /** Returns accessible member and workspace connections, excluding client setup. */
  // @effect-diagnostics-next-line lazyEffect:off
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID, scope?: Credential.Scope) => Effect.Effect<Info[]>
  /** Returns an accessible connection by ID, optionally restricted to one scope. */
  readonly get: (id: ID, scope?: Credential.Scope) => Effect.Effect<Info | undefined>
  /** Creates and activates a credential for an integration. */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
    readonly scope?: Credential.Scope
  }) => Effect.Effect<Info>
  /** Selects a stored credential for its integration. */
  readonly activate: (id: ID) => Effect.Effect<void>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Replaces one exact OAuth value only while its token generation is still current. */
  readonly updateOAuth: (id: ID, expected: Pick<OAuth, "access" | "refresh">, value: OAuth) => Effect.Effect<boolean>
  /** Removes one exact OAuth token generation without affecting a replacement credential. */
  readonly removeOAuth: (id: ID, expected: Pick<OAuth, "access" | "refresh">) => Effect.Effect<boolean>
  /** Serializes an OAuth refresh across every graph for this Workspace and credential. */
  readonly refreshOAuth: (
    id: ID,
    expiresBefore: number,
    refresh: (credential: OAuth) => Effect.Effect<OAuth, unknown>,
  ) => Effect.Effect<OAuth | undefined, unknown>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
  /**
   * Removes every member's and the Workspace's connection Credentials for one
   * Integration, regardless of this binding's member. Callers authorize first.
   */
  readonly discard: (integrationID: Integration.ID) => Effect.Effect<void>
  /**
   * Which members currently hold an active Connection for one Integration, and
   * when it last changed. Names members only; never their secret values.
   * Callers authorize first.
   */
  readonly connected: (
    integrationID: Integration.ID,
  ) => Effect.Effect<ReadonlyArray<{ readonly userID: User.ID; readonly updated: Date }>>
}

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@opencode/Credential") {}

type Row = typeof CredentialTable.$inferSelect

/** sha256 hex digest of an OAuth token, matching the boot migrator's backfill. */
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

/**
 * Match one exact OAuth token generation by digest. The plaintext fallback arm
 * covers rows written before encryption at rest (or before the boot migrator
 * has run); encrypted rows match on the digest columns alone.
 */
const oauthMatch = (expected: Pick<OAuth, "access" | "refresh">) =>
  or(
    and(
      isNotNull(CredentialTable.oauth_access_hash),
      eq(CredentialTable.oauth_access_hash, digest(expected.access)),
      eq(CredentialTable.oauth_refresh_hash, digest(expected.refresh)),
    ),
    and(
      isNull(CredentialTable.oauth_access_hash),
      sql`${CredentialTable.valueJson}->>'type' = 'oauth'`,
      sql`${CredentialTable.valueJson}->>'access' = ${expected.access}`,
      sql`${CredentialTable.valueJson}->>'refresh' = ${expected.refresh}`,
    ),
  )

/**
 * A row whose OAuth digests a pre-1.2.1 boot migrator cleared (#91): encrypted
 * value_json with a missing digest, which no conditional OAuth write can match.
 */
const damaged = (row: Pick<Row, "valueJson" | "oauth_access_hash" | "oauth_refresh_hash">) =>
  typeof row.valueJson === "string" &&
  Cipher.isEnvelope(row.valueJson) &&
  (row.oauth_access_hash === null || row.oauth_refresh_hash === null)

/** Decrypt one stored value_json payload, passing legacy plaintext objects through. */
const stored = (cipher: Cipher.Interface, value: Value | Form.Answer | string) =>
  typeof value === "string"
    ? Effect.map(cipher.decrypt(value), (plaintext) => JSON.parse(Redacted.value(plaintext)))
    : Effect.succeed(value)

/** Encrypt the secret-bearing columns for one connection value. */
const columns = (cipher: Cipher.Interface, value: Value) =>
  Effect.gen(function* () {
    const valueJson = yield* cipher.encrypt(Redacted.make(JSON.stringify(value)))
    const direct = value.type === "key" ? yield* cipher.encrypt(Redacted.make(value.key)) : null
    return {
      value: direct,
      valueJson,
      oauth_access_hash: value.type === "oauth" ? digest(value.access) : null,
      oauth_refresh_hash: value.type === "oauth" ? digest(value.refresh) : null,
    }
  })

const activeOrder = sql`case when ${CredentialTable.active} is null then -1 when ${CredentialTable.active} then 1 else 0 end`

/** Identity bound to credential access within one workspace. */
export interface Binding {
  readonly workspaceID: Workspace.ID
  readonly userID?: User.ID
}

/** PostgreSQL credential storage bound to a workspace and optional member. */
export const layer = (input: Workspace.ID | Binding): Layer.Layer<Service, never, Database.Service | Cipher.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      const cipher = yield* Cipher.Service
      const fromRow = Effect.fnUntraced(function* (row: Row) {
        // Decryption failure fails closed: no plaintext substitute is served.
        const raw = yield* stored(cipher, row.valueJson).pipe(Effect.orDie)
        const value = yield* Schema.decodeUnknownEffect(Value)(raw).pipe(Effect.orDie)
        return new Info({
          id: row.id,
          integrationID: row.integration_id,
          label: row.label,
          value,
          scope: row.userID === null ? "workspace" : "member",
          active: row.active === true,
        })
      })
      const { workspaceID, userID } = typeof input === "string" ? { workspaceID: input, userID: undefined } : input
      const visible = and(
        eq(CredentialTable.workspaceId, workspaceID),
        eq(CredentialTable.purpose, "connection"),
        userID === undefined
          ? isNull(CredentialTable.userID)
          : or(isNull(CredentialTable.userID), eq(CredentialTable.userID, userID)),
      )
      const owner = (memberID: User.ID | null) =>
        and(
          eq(CredentialTable.workspaceId, workspaceID),
          eq(CredentialTable.purpose, "connection"),
          memberID === null ? isNull(CredentialTable.userID) : eq(CredentialTable.userID, memberID),
        )

      /**
       * Restore a damaged row's digests from its decrypted current value. Matches
       * only while the row still holds that exact envelope with a missing digest,
       * so it never overwrites a concurrent write. Callers hold the refresh lock.
       */
      const repair = (id: ID, envelope: string, value: OAuth) =>
        database.use("Credential.repairOAuth", (db) =>
          db
            .update(CredentialTable)
            .set({ oauth_access_hash: digest(value.access), oauth_refresh_hash: digest(value.refresh) })
            .where(
              and(
                visible,
                eq(CredentialTable.id, id),
                or(isNull(CredentialTable.oauth_access_hash), isNull(CredentialTable.oauth_refresh_hash)),
                sql`${CredentialTable.valueJson} #>> '{}' = ${envelope}`,
              ),
            ),
        )

      const selection = (scope?: Credential.Scope) =>
        scope === undefined
          ? undefined
          : scope === "workspace"
            ? isNull(CredentialTable.userID)
            : userID === undefined
              ? sql`false`
              : eq(CredentialTable.userID, userID)

      const all = Effect.fn("Credential.all")(function* () {
        const rows = yield* database.use("Credential.all", (db) =>
          db
            .select()
            .from(CredentialTable)
            .where(visible)
            .orderBy(asc(activeOrder), asc(CredentialTable.timeCreated), asc(CredentialTable.id))
            .pipe(Effect.orDie),
        )
        return yield* Effect.forEach(rows, fromRow)
      })

      const list = Effect.fn("Credential.list")(function* (integrationID: Integration.ID, scope?: Credential.Scope) {
        const rows = yield* database.use("Credential.list", (db) =>
          db
            .select()
            .from(CredentialTable)
            .where(and(visible, selection(scope), eq(CredentialTable.integration_id, integrationID)))
            .orderBy(asc(activeOrder), asc(CredentialTable.timeCreated), asc(CredentialTable.id))
            .pipe(Effect.orDie),
        )
        return yield* Effect.forEach(rows, fromRow)
      })

      const get = Effect.fn("Credential.get")(function* (id: ID, scope?: Credential.Scope) {
        const rows = yield* database.use("Credential.get", (db) =>
          db
            .select()
            .from(CredentialTable)
            .where(and(visible, selection(scope), eq(CredentialTable.id, id)))
            .limit(1)
            .pipe(Effect.orDie),
        )
        return yield* pipe(
          rows,
          Array.head,
          Option.match({ onNone: () => Effect.void.pipe(Effect.as(undefined)), onSome: fromRow }),
        )
      })

      const create = Effect.fn("Credential.create")(function* (input: {
        readonly integrationID: Integration.ID
        readonly value: Value
        readonly label?: string
        readonly scope?: Credential.Scope
      }) {
        const memberID = input.scope === "member" ? userID : null
        if (memberID === undefined) return yield* Effect.die(new Error("Member credentials require a member binding"))
        const id = ID.create()
        const now = new Date(yield* Clock.currentTimeMillis)
        // Encrypt before the transaction so the backend call never extends lock holds.
        const secret = yield* columns(cipher, input.value).pipe(Effect.orDie)
        const rows = yield* database
          .transact(
            Effect.gen(function* () {
              yield* database.use("Credential.create.lock", (db) =>
                db.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${`credential:${workspaceID}:${input.integrationID}:${memberID ?? "workspace"}`}, 0))`,
                ),
              )
              yield* database.use("Credential.create.deactivate", (db) =>
                db
                  .update(CredentialTable)
                  .set({ active: false })
                  .where(and(owner(memberID), eq(CredentialTable.integration_id, input.integrationID))),
              )
              return yield* database.use("Credential.create.insert", (db) =>
                db
                  .insert(CredentialTable)
                  .values({
                    id,
                    workspaceId: workspaceID,
                    userID: memberID,
                    integration_id: input.integrationID,
                    label: input.label ?? "default",
                    active: true,
                    ...secret,
                    timeCreated: now,
                    timeUpdated: now,
                  })
                  .returning(),
              )
            }),
          )
          .pipe(Effect.orDie)
        return yield* pipe(
          rows,
          Array.head,
          Option.match({
            onNone: () => Effect.die(new Error("Credential insert returned no row")),
            onSome: fromRow,
          }),
        )
      })

      const activate = Effect.fn("Credential.activate")(function* (id: ID) {
        yield* database
          .transact(
            Effect.gen(function* () {
              const initial = yield* database.use("Credential.activate.lookup", (db) =>
                db
                  .select({ integrationID: CredentialTable.integration_id, userID: CredentialTable.userID })
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              const row = initial[0]
              if (!row) return
              const integrationID = row.integrationID
              yield* database.use("Credential.activate.lock", (db) =>
                db.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${`credential:${workspaceID}:${integrationID}:${row.userID ?? "workspace"}`}, 0))`,
                ),
              )
              const credential = yield* database.use("Credential.activate.current", (db) =>
                db
                  .select({ id: CredentialTable.id })
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              if (!credential[0]) return
              const active = yield* database.use("Credential.activate.active", (db) =>
                db
                  .select({ id: CredentialTable.id })
                  .from(CredentialTable)
                  .where(and(owner(row.userID), eq(CredentialTable.integration_id, integrationID)))
                  .orderBy(desc(activeOrder), desc(CredentialTable.timeCreated), desc(CredentialTable.id))
                  .limit(1),
              )
              if (active[0]?.id === id) return
              yield* database.use("Credential.activate.deactivate", (db) =>
                db
                  .update(CredentialTable)
                  .set({ active: false })
                  .where(and(owner(row.userID), eq(CredentialTable.integration_id, integrationID))),
              )
              yield* database.use("Credential.activate.select", (db) =>
                db
                  .update(CredentialTable)
                  .set({ active: true })
                  .where(and(visible, eq(CredentialTable.id, id))),
              )
            }),
          )
          .pipe(Effect.orDie)
      })

      const update = Effect.fn("Credential.update")(function* (
        id: ID,
        updates: Partial<Pick<Info, "label" | "value">>,
      ) {
        if (updates.label === undefined && updates.value === undefined) return
        const credential = yield* get(id)
        if (!credential) return
        if (updates.label === credential.label && updates.value === undefined) return
        const now = new Date(yield* Clock.currentTimeMillis)
        const secret =
          updates.value === undefined ? undefined : yield* columns(cipher, updates.value).pipe(Effect.orDie)
        yield* database.use("Credential.update", (db) =>
          db
            .update(CredentialTable)
            .set({
              ...(updates.label === undefined ? {} : { label: updates.label }),
              ...secret,
              timeUpdated: now,
            })
            .where(and(visible, eq(CredentialTable.id, id)))
            .pipe(Effect.orDie),
        )
      })

      const refreshOAuth = Effect.fn("Credential.refreshOAuth")(function* (
        id: ID,
        expiresBefore: number,
        refresh: (credential: OAuth) => Effect.Effect<OAuth, unknown>,
      ) {
        return yield* database
          .transact(
            Effect.gen(function* () {
              yield* database.use("Credential.refreshOAuth.lock", (db) =>
                db.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${`credential-refresh:${workspaceID}:${id}`}, 0))`,
                ),
              )
              const rows = yield* database.use("Credential.refreshOAuth.current", (db) =>
                db
                  .select()
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              const row = rows[0]
              if (!row) return undefined
              const current = yield* stored(cipher, row.valueJson).pipe(Effect.orDie)
              const credential = yield* Schema.decodeUnknownEffect(Value)(current).pipe(Effect.orDie)
              if (credential.type !== "oauth") return undefined
              if (credential.expires > expiresBefore) return credential
              const value = yield* refresh(credential)
              const secret = yield* columns(cipher, value)
              if (damaged(row)) yield* repair(id, row.valueJson as string, credential)
              const updated = yield* database.use("Credential.refreshOAuth.update", (db) =>
                db
                  .update(CredentialTable)
                  .set({ ...secret, timeUpdated: new Date() })
                  .where(and(visible, eq(CredentialTable.id, id), oauthMatch(credential)))
                  .returning({ id: CredentialTable.id }),
              )
              if (updated.length === 1) return value
              const reloaded = yield* database.use("Credential.refreshOAuth.reload", (db) =>
                db
                  .select({ value: CredentialTable.valueJson })
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              if (reloaded[0] === undefined) return undefined
              const winnerRaw = yield* stored(cipher, reloaded[0].value).pipe(Effect.orDie)
              const winner = yield* Schema.decodeUnknownEffect(Value)(winnerRaw).pipe(Effect.orDie)
              return winner.type === "oauth" ? winner : undefined
            }),
          )
          .pipe(
            Effect.catch((error) =>
              typeof error === "object" && error !== null && Reflect.get(error, "_tag") === "SqlError"
                ? Effect.die(error)
                : Effect.fail(error),
            ),
          )
      })

      const updateOAuth = Effect.fn("Credential.updateOAuth")(function* (
        id: ID,
        expected: Pick<OAuth, "access" | "refresh">,
        value: OAuth,
      ) {
        const secret = yield* columns(cipher, value).pipe(Effect.orDie)
        const write = database.use("Credential.updateOAuth", (db) =>
          db
            .update(CredentialTable)
            .set({ ...secret, timeUpdated: new Date() })
            .where(and(visible, eq(CredentialTable.id, id), oauthMatch(expected)))
            .returning({ id: CredentialTable.id }),
        )
        if ((yield* write.pipe(Effect.orDie)).length === 1) return true
        // A miss on an intact row is a stale generation; only a damaged row needs a look inside.
        const probe = yield* database.use("Credential.updateOAuth.probe", (db) =>
          db
            .select({
              valueJson: CredentialTable.valueJson,
              oauth_access_hash: CredentialTable.oauth_access_hash,
              oauth_refresh_hash: CredentialTable.oauth_refresh_hash,
            })
            .from(CredentialTable)
            .where(and(visible, eq(CredentialTable.id, id)))
            .limit(1)
            .pipe(Effect.orDie),
        )
        if (probe[0] === undefined || !damaged(probe[0])) return false
        return yield* database
          .transact(
            Effect.gen(function* () {
              // The refresh lock serializes this repair with refreshOAuth and removeOAuth.
              yield* database.use("Credential.updateOAuth.lock", (db) =>
                db.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${`credential-refresh:${workspaceID}:${id}`}, 0))`,
                ),
              )
              const rows = yield* database.use("Credential.updateOAuth.current", (db) =>
                db
                  .select()
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              const row = rows[0]
              if (row === undefined || !damaged(row)) return false
              const current = yield* stored(cipher, row.valueJson).pipe(Effect.orDie)
              const credential = yield* Schema.decodeUnknownEffect(Value)(current).pipe(Effect.orDie)
              if (
                credential.type !== "oauth" ||
                credential.access !== expected.access ||
                credential.refresh !== expected.refresh
              )
                return false
              yield* repair(id, row.valueJson as string, credential)
              return (yield* write).length === 1
            }),
          )
          .pipe(Effect.orDie)
      })

      const removeOAuth = Effect.fn("Credential.removeOAuth")(function* (
        id: ID,
        expected: Pick<OAuth, "access" | "refresh">,
      ) {
        return yield* database
          .transact(
            Effect.gen(function* () {
              yield* database.use("Credential.removeOAuth.refreshLock", (db) =>
                db.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${`credential-refresh:${workspaceID}:${id}`}, 0))`,
                ),
              )
              const rows = yield* database.use("Credential.removeOAuth.current", (db) =>
                db
                  .select()
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              const row = rows[0]
              if (!row) return false
              const current = yield* stored(cipher, row.valueJson).pipe(Effect.orDie)
              const value = yield* Schema.decodeUnknownEffect(Value)(current).pipe(Effect.orDie)
              if (value.type !== "oauth" || value.access !== expected.access || value.refresh !== expected.refresh)
                return false
              yield* database.use("Credential.removeOAuth.integrationLock", (db) =>
                db.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${`credential:${workspaceID}:${row.integration_id}:${row.userID ?? "workspace"}`}, 0))`,
                ),
              )
              // After the integration lock, matching the lock order of every other row write.
              if (damaged(row)) yield* repair(id, row.valueJson as string, value)
              const deleted = yield* database.use("Credential.removeOAuth.delete", (db) =>
                db
                  .delete(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id), oauthMatch(expected)))
                  .returning({ id: CredentialTable.id }),
              )
              if (deleted.length !== 1) return false
              if (row.active !== true) return true
              const replacement = yield* database.use("Credential.removeOAuth.replacement", (db) =>
                db
                  .select({ id: CredentialTable.id })
                  .from(CredentialTable)
                  .where(and(owner(row.userID), eq(CredentialTable.integration_id, row.integration_id)))
                  .orderBy(desc(CredentialTable.timeCreated), desc(CredentialTable.id))
                  .limit(1),
              )
              const replacementID = replacement[0]?.id
              if (replacementID !== undefined)
                yield* database.use("Credential.removeOAuth.promote", (db) =>
                  db
                    .update(CredentialTable)
                    .set({ active: true })
                    .where(and(visible, eq(CredentialTable.id, replacementID))),
                )
              return true
            }),
          )
          .pipe(Effect.orDie)
      })

      const remove = Effect.fn("Credential.remove")(function* (id: ID) {
        yield* database
          .transact(
            Effect.gen(function* () {
              const initial = yield* database.use("Credential.remove.lookup", (db) =>
                db
                  .select({ integrationID: CredentialTable.integration_id, userID: CredentialTable.userID })
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              const row = initial[0]
              if (!row) return
              const integrationID = row.integrationID
              yield* database.use("Credential.remove.lock", (db) =>
                db.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${`credential:${workspaceID}:${integrationID}:${row.userID ?? "workspace"}`}, 0))`,
                ),
              )
              const credential = yield* database.use("Credential.remove.current", (db) =>
                db
                  .select({ id: CredentialTable.id })
                  .from(CredentialTable)
                  .where(and(visible, eq(CredentialTable.id, id)))
                  .limit(1),
              )
              if (!credential[0]) return
              const active = yield* database.use("Credential.remove.active", (db) =>
                db
                  .select({ id: CredentialTable.id })
                  .from(CredentialTable)
                  .where(and(owner(row.userID), eq(CredentialTable.integration_id, integrationID)))
                  .orderBy(desc(activeOrder), desc(CredentialTable.timeCreated), desc(CredentialTable.id))
                  .limit(1),
              )
              yield* database.use("Credential.remove.delete", (db) =>
                db.delete(CredentialTable).where(and(visible, eq(CredentialTable.id, id))),
              )
              if (active[0]?.id !== id) return
              const replacement = yield* database.use("Credential.remove.replacement", (db) =>
                db
                  .select({ id: CredentialTable.id })
                  .from(CredentialTable)
                  .where(and(owner(row.userID), eq(CredentialTable.integration_id, integrationID)))
                  .orderBy(desc(CredentialTable.timeCreated), desc(CredentialTable.id))
                  .limit(1),
              )
              const replacementID = replacement[0]?.id
              if (!replacementID) return
              yield* database.use("Credential.remove.deactivate", (db) =>
                db
                  .update(CredentialTable)
                  .set({ active: false })
                  .where(and(owner(row.userID), eq(CredentialTable.integration_id, integrationID))),
              )
              yield* database.use("Credential.remove.promote", (db) =>
                db
                  .update(CredentialTable)
                  .set({ active: true })
                  .where(and(visible, eq(CredentialTable.id, replacementID))),
              )
            }),
          )
          .pipe(Effect.orDie)
      })

      const discard = Effect.fn("Credential.discard")(function* (integrationID: Integration.ID) {
        yield* database.use("Credential.discard", (db) =>
          db
            .delete(CredentialTable)
            .where(
              and(
                eq(CredentialTable.workspaceId, workspaceID),
                eq(CredentialTable.purpose, "connection"),
                eq(CredentialTable.integration_id, integrationID),
              ),
            )
            .pipe(Effect.orDie),
        )
      })

      const connected = Effect.fn("Credential.connected")(function* (integrationID: Integration.ID) {
        const rows = yield* database.use("Credential.connected", (db) =>
          db
            .select({ userID: CredentialTable.userID, updated: CredentialTable.timeUpdated })
            .from(CredentialTable)
            .where(
              and(
                eq(CredentialTable.workspaceId, workspaceID),
                eq(CredentialTable.purpose, "connection"),
                eq(CredentialTable.integration_id, integrationID),
                eq(CredentialTable.active, true),
                isNotNull(CredentialTable.userID),
              ),
            )
            .pipe(Effect.orDie),
        )
        return rows.flatMap((row) => (row.userID === null ? [] : [{ userID: row.userID, updated: row.updated }]))
      })

      const clientWhere = (key: ClientKey) =>
        and(
          eq(CredentialTable.workspaceId, workspaceID),
          eq(CredentialTable.purpose, "client"),
          eq(CredentialTable.integration_id, key.integrationID),
          eq(CredentialTable.method_id, key.methodID),
        )
      const databaseError = (key: ClientKey, operation: StorageError["operation"]) =>
        Effect.mapError(() => new StorageError({ ...key, operation }))

      const client = {
        configured: Effect.fn("IntegrationOAuthClientConfiguration.configured")(function* (keys: readonly ClientKey[]) {
          const first = keys[0]
          if (!first) return []
          const requested = new Set(keys.map((key) => `${key.integrationID}\0${key.methodID}`))
          const rows = yield* database
            .use("IntegrationOAuthClientConfiguration.configured", (db) =>
              db
                .select({
                  integrationID: CredentialTable.integration_id,
                  methodID: CredentialTable.method_id,
                })
                .from(CredentialTable)
                .where(and(eq(CredentialTable.workspaceId, workspaceID), eq(CredentialTable.purpose, "client"))),
            )
            .pipe(databaseError(first, "configured"))
          return rows.flatMap((key) =>
            key.methodID !== null && requested.has(`${key.integrationID}\0${key.methodID}`)
              ? [{ integrationID: key.integrationID, methodID: key.methodID }]
              : [],
          )
        }),

        resolve: Effect.fn("IntegrationOAuthClientConfiguration.resolve")(function* (
          key: ClientKey,
          fields: Form.Fields | undefined,
        ) {
          if (!fields) return Form.Answer.make({})
          const rows = yield* database
            .use("IntegrationOAuthClientConfiguration.resolve", (db) =>
              db.select({ value: CredentialTable.valueJson }).from(CredentialTable).where(clientWhere(key)).limit(1),
            )
            .pipe(databaseError(key, "resolve"))
          if (!rows[0]) return yield* new MissingError(key)
          const answer = yield* Schema.decodeUnknownEffect(Form.Answer)(
            yield* stored(cipher, rows[0].value).pipe(databaseError(key, "resolve")),
          ).pipe(Effect.mapError(() => new InvalidError(key)))
          if (Form.validateAnswer(fields, answer)) return yield* new InvalidError(key)
          return answer
        }),

        put: Effect.fn("IntegrationOAuthClientConfiguration.put")(function* (
          key: ClientKey,
          fields: Form.Fields,
          answer: Form.Answer,
        ) {
          if (Form.validateAnswer(fields, answer)) return yield* new InvalidError(key)
          const valueJson = yield* cipher
            .encrypt(Redacted.make(JSON.stringify(answer)))
            .pipe(Effect.mapError(() => new StorageError({ ...key, operation: "put" })))
          yield* database
            .use("IntegrationOAuthClientConfiguration.put", (db) =>
              db
                .insert(CredentialTable)
                .values({
                  id: ID.create(),
                  purpose: "client",
                  label: "OAuth client",
                  workspaceId: workspaceID,
                  integration_id: key.integrationID,
                  method_id: key.methodID,
                  valueJson,
                })
                .onConflictDoUpdate({
                  target: [CredentialTable.workspaceId, CredentialTable.integration_id, CredentialTable.method_id],
                  targetWhere: sql`${CredentialTable.purpose} = 'client'`,
                  set: { valueJson, timeUpdated: sql`now()` },
                }),
            )
            .pipe(databaseError(key, "put"))
        }),

        remove: Effect.fn("IntegrationOAuthClientConfiguration.remove")(function* (key: ClientKey) {
          const rows = yield* database
            .use("IntegrationOAuthClientConfiguration.remove", (db) =>
              db.delete(CredentialTable).where(clientWhere(key)).returning({ method: CredentialTable.method_id }),
            )
            .pipe(databaseError(key, "remove"))
          return rows.length > 0
        }),
      }

      return Service.of({
        client,
        all,
        list,
        get,
        create,
        activate,
        update,
        updateOAuth,
        removeOAuth,
        refreshOAuth,
        remove,
        discard,
        connected,
      })
    }),
  )

/** Canonical credential authority for the verified member bound at acquisition. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(Actor.Binding.Service, layer)),
  deps: [Actor.binding, Database.node, Cipher.node],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(input: Workspace.ID | Binding, database?: GlobalNode<Database.Service, E>) =>
  makeWorkspaceNode({
    service: Service,
    layer: layer(input),
    deps: [database ?? Database.node, Cipher.node],
  })
