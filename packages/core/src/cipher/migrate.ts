/**
 * Boot-time migration of legacy plaintext secret columns to Cipher envelopes:
 * `credential.value`, `credential.value_json` (populating the OAuth
 * token-generation digest columns), and `auth_provider.client_secret`.
 * Idempotent: envelopes are recognized and skipped without decrypting, and one
 * advisory lock serializes concurrent migrators during a rolling restart. OAuth
 * digests an earlier migrator cleared are repaired by the Credential store on
 * the connection's next token write, not here, so boot never calls the key backend
 * for already-encrypted rows.
 */
import { and, eq, sql } from "drizzle-orm"
import { Effect, Redacted } from "effect"
import { createHash } from "node:crypto"
import { AuthProviderTable, CredentialTable, Database } from "../database.js"
import type { Interface, UnavailableError } from "../cipher.js"
import { isEnvelope } from "./envelope.js"

/**
 * sha256 hex digest matching the credential store's OAuth generation digests.
 * Deliberately duplicated from `credential.ts`, whose copy is private to the
 * Credential domain; the two must stay byte-identical.
 */
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

/** The OAuth token pair from one plaintext value_json payload, if it is one. */
const oauthValue = (value: unknown): { readonly access: string; readonly refresh: string } | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const { type, access, refresh } = value as { type?: unknown; access?: unknown; refresh?: unknown }
  return type === "oauth" && typeof access === "string" && typeof refresh === "string" ? { access, refresh } : undefined
}

export const migrateWith = (cipher: Interface): Effect.Effect<void, UnavailableError, Database.Service> =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const counts = yield* database
      .transact(
        Effect.gen(function* () {
          yield* database.use("Cipher.migrate.lock", (db) =>
            db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"cipher.migrate"}, 0))`).pipe(Effect.orDie),
          )
          let credentials = 0
          const rows = yield* database.use("Cipher.migrate.credentials", (db) =>
            db
              .select({
                id: CredentialTable.id,
                workspaceID: CredentialTable.workspaceId,
                value: CredentialTable.value,
                valueJson: CredentialTable.valueJson,
              })
              .from(CredentialTable)
              .for("update")
              .pipe(Effect.orDie),
          )
          for (const row of rows) {
            const where = and(eq(CredentialTable.workspaceId, row.workspaceID), eq(CredentialTable.id, row.id))
            const valueEncrypted = row.value !== null && isEnvelope(row.value)
            const jsonEncrypted = typeof row.valueJson === "string" && isEnvelope(row.valueJson)
            // Only key credentials carry a direct `value`; OAuth, AWS, and OAuth
            // client rows keep it null by design, so null counts as migrated.
            if (jsonEncrypted && (row.value === null || valueEncrypted)) continue
            const value =
              row.value === null || valueEncrypted ? row.value : yield* cipher.encrypt(Redacted.make(row.value))
            const valueJson = jsonEncrypted
              ? row.valueJson
              : yield* cipher.encrypt(Redacted.make(JSON.stringify(row.valueJson)))
            // Digests derive from plaintext value_json; an already-encrypted
            // value_json keeps whatever digests it has.
            const oauth = jsonEncrypted ? undefined : oauthValue(row.valueJson)
            const digests = jsonEncrypted
              ? {}
              : {
                  oauth_access_hash: oauth === undefined ? null : digest(oauth.access),
                  oauth_refresh_hash: oauth === undefined ? null : digest(oauth.refresh),
                }
            yield* database.use("Cipher.migrate.credential", (db) =>
              db
                .update(CredentialTable)
                .set({ value, valueJson, ...digests })
                .where(where)
                .pipe(Effect.orDie),
            )
            credentials++
          }
          let providers = 0
          const authProviders = yield* database.use("Cipher.migrate.providers", (db) =>
            db
              .select({ id: AuthProviderTable.id, clientSecret: AuthProviderTable.client_secret })
              .from(AuthProviderTable)
              .for("update")
              .pipe(Effect.orDie),
          )
          for (const row of authProviders) {
            if (isEnvelope(row.clientSecret)) continue
            const clientSecret = yield* cipher.encrypt(Redacted.make(row.clientSecret))
            yield* database.use("Cipher.migrate.provider", (db) =>
              db
                .update(AuthProviderTable)
                .set({ client_secret: clientSecret })
                .where(eq(AuthProviderTable.id, row.id))
                .pipe(Effect.orDie),
            )
            providers++
          }
          return { credentials, providers }
        }),
      )
      // Database defects crash the boot node, which logs and defers to the next boot.
      .pipe(Effect.catchTag("SqlError", Effect.die))
    if (counts.credentials > 0 || counts.providers > 0)
      yield* Effect.log("Cipher migrated legacy plaintext secrets to envelopes", counts)
  }).pipe(Effect.withSpan("Cipher.migrate"))
