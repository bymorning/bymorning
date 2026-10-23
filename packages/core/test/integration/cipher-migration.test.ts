import { NodeCrypto } from "@effect/platform-node"
import { PgClient } from "@effect/sql-pg"
import { AwsRegion } from "@bymorning/schema/aws-region"
import { Integration } from "@bymorning/schema/integration"
import { Workspace } from "@bymorning/schema/workspace"
import { sql } from "drizzle-orm"
import { Cause, Effect, Exit, Layer, Logger, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { AuthProviderTable, CredentialTable, Database } from "../../src/database.js"
import { Credential } from "../../src/credential.js"
import { Cipher } from "../../src/cipher.js"
import { layer as cipherLayer } from "../fixtures/cipher.js"

if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")

const workspaceID = Workspace.ID.make("wrk_cipher_migration")
const databaseLayer = Database.layer.pipe(
  Layer.provide(PgClient.layer({ url: Redacted.make(process.env.DATABASE_URL) })),
  Layer.orDie,
)

const key = Redacted.make(Buffer.alloc(32, 77).toString("base64url"))
const otherKey = Redacted.make(Buffer.alloc(32, 78).toString("base64url"))

const liveCipher = Cipher.local(key).pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
const otherCipher = Cipher.local(otherKey).pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
const methodID = Integration.MethodID.make("oauth")

describe("Cipher boot migration", () => {
  it("[SEC-CRYPT-05] re-encrypts legacy plaintext rows under a lock and keeps them readable", async () => {
    // Legacy rows as written before encryption at rest: plaintext value and
    // value_json, a plaintext OAuth token pair, and a plaintext client secret.
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("CipherMigration.seedWorkspace", (db) =>
          db.execute(
            sql`insert into workspace (id, name, status) values (${workspaceID}, 'Cipher migration', 'active')`,
          ),
        )
        yield* database.use("CipherMigration.seedLegacy", (db) =>
          db.execute(
            sql`insert into credential (id, workspace_id, integration_id, label, active, value, value_json) values
              ('cred_legacy_key', ${workspaceID}, 'legacy-integration', 'Legacy key', true, 'legacy-api-key', '{"type":"key","key":"legacy-api-key"}'),
              ('cred_legacy_oauth', ${workspaceID}, 'legacy-integration', 'Legacy OAuth', null, null, ${`{"type":"oauth","methodID":"oauth","access":"legacy-access","refresh":"legacy-refresh","expires":0}`})`,
          ),
        )
        yield* database.use("CipherMigration.seedProvider", (db) =>
          db.execute(
            sql`insert into auth_provider (id, revision, display_name, kind, issuer, client_id, client_secret, domains, status) values
              ('authp_legacy', 1, 'Legacy IdP', 'custom', 'https://idp.example', 'client-id', 'legacy-client-secret', '["example.test"]', 'enabled')`,
          ),
        )
      }).pipe(Effect.provide(databaseLayer)),
    )

    await Effect.runPromise(Cipher.migrate.pipe(Effect.provide(Layer.mergeAll(databaseLayer, liveCipher))))

    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        return yield* database.use("CipherMigration.inspect", (db) =>
          Effect.gen(function* () {
            const credentials = yield* db.select().from(CredentialTable).pipe(Effect.orDie)
            const providers = yield* db.select().from(AuthProviderTable).pipe(Effect.orDie)
            return { credentials, providers }
          }),
        )
      }).pipe(Effect.provide(databaseLayer)),
    )

    // Every secret-bearing column is an envelope; no plaintext survives.
    for (const row of rows.credentials) {
      if (row.value !== null) {
        expect(row.value.startsWith("v1.")).toBe(true)
      }
      expect(typeof row.valueJson).toBe("string")
      expect((row.valueJson as string).startsWith("v1.")).toBe(true)
    }
    const stored = JSON.stringify(rows)
    for (const plaintext of ["legacy-api-key", "legacy-access", "legacy-refresh", "legacy-client-secret"]) {
      expect(stored).not.toContain(plaintext)
    }
    const oauth = rows.credentials.find((row) => row.id === "cred_legacy_oauth")
    // The OAuth token generation is matched by digest, never by token value.
    expect(oauth?.oauth_access_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(oauth?.oauth_refresh_hash).toMatch(/^[0-9a-f]{64}$/)
    for (const provider of rows.providers) {
      expect(provider.client_secret.startsWith("v1.")).toBe(true)
      expect(provider.client_secret).not.toContain("legacy-client-secret")
    }

    // Migrated rows still read back through the service boundary.
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const keyRow = yield* credentials.get(Credential.ID.make("cred_legacy_key"))
        expect(keyRow?.value).toEqual({ type: "key", key: "legacy-api-key" })
        // The backfilled digests keep conditional OAuth writes working.
        const rotated = yield* credentials.updateOAuth(
          Credential.ID.make("cred_legacy_oauth"),
          { access: "legacy-access", refresh: "legacy-refresh" },
          { type: "oauth", methodID, access: "rotated-access", refresh: "rotated-refresh", expires: 1 },
        )
        expect(rotated).toBe(true)
        const oauthRow = yield* credentials.get(Credential.ID.make("cred_legacy_oauth"))
        expect(oauthRow?.value).toMatchObject({ access: "rotated-access" })
      }).pipe(
        Effect.provide(
          Credential.layer(workspaceID).pipe(Layer.provideMerge(databaseLayer), Layer.provideMerge(liveCipher)),
        ),
      ),
    )

    // Re-running the migrator is a no-op: envelopes are recognized, not re-wrapped.
    await Effect.runPromise(Cipher.migrate.pipe(Effect.provide(Layer.mergeAll(databaseLayer, liveCipher))))
    const reread = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.get(Credential.ID.make("cred_legacy_key"))
      }).pipe(
        Effect.provide(
          Credential.layer(workspaceID).pipe(Layer.provideMerge(databaseLayer), Layer.provideMerge(liveCipher)),
        ),
      ),
    )
    expect(reread?.value).toEqual({ type: "key", key: "legacy-api-key" })
  }, 30_000)

  it("[SEC-CRYPT-06] fails closed when the key does not unwrap the migrated rows", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.get(Credential.ID.make("cred_legacy_key"))
      }).pipe(
        Effect.provide(
          Credential.layer(workspaceID).pipe(Layer.provideMerge(databaseLayer), Layer.provideMerge(otherCipher)),
        ),
        Effect.exit,
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause)).toBe(true)
  }, 30_000)

  it("matches OAuth generations on legacy plaintext rows before migration", async () => {
    // A row written by an old process during a rolling restart still matches
    // conditional OAuth writes through the plaintext predicate arm.
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("CipherMigration.seedWindow", (db) =>
          db.execute(
            sql`insert into credential (id, workspace_id, integration_id, label, active, value_json) values
              ('cred_window', ${workspaceID}, 'window-integration', 'Window', true, ${`{"type":"oauth","methodID":"oauth","access":"window-access","refresh":"window-refresh","expires":0}`})`,
          ),
        )
      }).pipe(Effect.provide(databaseLayer)),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const rotated = yield* credentials.updateOAuth(
          Credential.ID.make("cred_window"),
          { access: "window-access", refresh: "window-refresh" },
          { type: "oauth", methodID, access: "window-rotated", refresh: "window-rotated", expires: 1 },
        )
        expect(rotated).toBe(true)
        const row = yield* credentials.get(Credential.ID.make("cred_window"))
        expect(row?.value).toMatchObject({ access: "window-rotated" })
      }).pipe(
        Effect.provide(
          Credential.layer(workspaceID).pipe(Layer.provideMerge(databaseLayer), Layer.provideMerge(liveCipher)),
        ),
      ),
    )
  }, 30_000)
})

// The live Cipher, counting every envelope it is asked to decrypt.
const counting = () => {
  let decrypts = 0
  const layer = Layer.effect(
    Cipher.Service,
    Effect.map(Cipher.Service, (cipher) =>
      Cipher.Service.of({
        encrypt: cipher.encrypt,
        decrypt: (envelope) =>
          Effect.suspend(() => {
            decrypts++
            return cipher.decrypt(envelope)
          }),
      }),
    ),
  ).pipe(Layer.provide(liveCipher))
  return { layer, decrypts: () => decrypts }
}

// One boot of the Cipher migrator, returning the log entries it wrote.
const boot = async (cipher: Layer.Layer<Cipher.Service> = liveCipher) => {
  const entries: unknown[] = []
  const logger = Logger.make(({ message }) => entries.push(message))
  await Effect.runPromise(
    Cipher.migrate.pipe(
      Effect.provide(Layer.mergeAll(databaseLayer, cipher, Logger.layer([logger], { mergeWithExisting: false }))),
    ),
  )
  return entries
}

// The damage the pre-1.2.1 migrator left: envelope value_json, null digests.
const damage = (id: Credential.ID) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("CipherMigration.damage", (db) =>
        db.execute(sql`update credential set oauth_access_hash = null, oauth_refresh_hash = null where id = ${id}`),
      )
    }).pipe(Effect.provide(databaseLayer)),
  )

const inspect = (workspace: Workspace.ID) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      // xmin changes on every row write, so it proves the migrator left a row alone.
      return yield* database.use("CipherMigration.inspectWorkspace", (db) =>
        db
          .select({
            id: CredentialTable.id,
            value: CredentialTable.value,
            valueJson: CredentialTable.valueJson,
            access: CredentialTable.oauth_access_hash,
            refresh: CredentialTable.oauth_refresh_hash,
            version: sql<string>`xmin::text`,
          })
          .from(CredentialTable)
          .where(sql`${CredentialTable.workspaceId} = ${workspace}`)
          .pipe(Effect.orDie),
      )
    }).pipe(Effect.provide(databaseLayer)),
  )

const seedWorkspace = (workspace: Workspace.ID) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* database.use("CipherMigration.seedRestartWorkspace", (db) =>
        db.execute(sql`insert into workspace (id, name, status) values (${workspace}, 'Cipher restart', 'active')`),
      )
    }).pipe(Effect.provide(databaseLayer)),
  )

const withCredentials = <A>(workspace: Workspace.ID, effect: Effect.Effect<A, never, Credential.Service>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Credential.layer(workspace).pipe(Layer.provideMerge(databaseLayer), Layer.provideMerge(liveCipher)),
      ),
    ),
  )

const migrated = (entries: unknown[]) =>
  entries.filter((entry) => Array.isArray(entry) && String(entry[0]).startsWith("Cipher "))

describe("Cipher boot migration across restarts", () => {
  it("leaves encrypted OAuth credentials and their digests untouched on every boot", async () => {
    const workspace = Workspace.ID.make("wrk_cipher_restart")
    await seedWorkspace(workspace)
    const created = await withCredentials(
      workspace,
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.create({
          integrationID: Integration.ID.make("restart-integration"),
          value: { type: "oauth", methodID, access: "restart-access", refresh: "restart-refresh", expires: 0 },
        })
      }),
    )
    const [before] = await inspect(workspace)
    expect(before?.value).toBeNull()
    expect(before?.access).toMatch(/^[0-9a-f]{64}$/)

    await boot()
    const second = await boot()
    // Nothing in this database is legacy, so a second boot rewrites and logs nothing.
    expect(migrated(second)).toEqual([])
    const [after] = await inspect(workspace)
    expect(after).toEqual(before)

    const rotated = await withCredentials(
      workspace,
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.updateOAuth(
          created.id,
          { access: "restart-access", refresh: "restart-refresh" },
          { type: "oauth", methodID, access: "restart-rotated", refresh: "restart-rotated-refresh", expires: 1 },
        )
      }),
    )
    expect(rotated).toBe(true)
  }, 30_000)

  it("never decrypts at boot, leaving damaged OAuth digests for the Credential store to repair", async () => {
    const workspace = Workspace.ID.make("wrk_cipher_damaged")
    await seedWorkspace(workspace)
    const damaged = await withCredentials(
      workspace,
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("damaged-aws"),
          value: {
            type: "aws-sigv4",
            region: AwsRegion.make("us-east-1"),
            accessKeyId: "damaged-access-key-id",
            secretAccessKey: "damaged-secret-access-key",
          },
        })
        yield* credentials.create({
          integrationID: Integration.ID.make("intact-oauth"),
          value: { type: "oauth", methodID, access: "intact-access", refresh: "intact-refresh", expires: 0 },
        })
        return yield* credentials.create({
          integrationID: Integration.ID.make("damaged-oauth"),
          value: { type: "oauth", methodID, access: "damaged-access", refresh: "damaged-refresh", expires: 0 },
        })
      }),
    )
    await damage(damaged.id)
    const before = await inspect(workspace)
    expect(before.find((row) => row.id === damaged.id)?.access).toBeNull()

    // Each boot opens no envelope (no key-backend unwrap) and rewrites no row,
    // including the damaged one: SigV4 rows have null digests by design.
    for (const _ of [1, 2]) {
      const counted = counting()
      const entries = await boot(counted.layer)
      expect(counted.decrypts()).toBe(0)
      expect(migrated(entries)).toEqual([])
      expect(await inspect(workspace)).toEqual(before)
    }

    // The next token write repairs the damaged row instead.
    await withCredentials(
      workspace,
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const rotated = yield* credentials.updateOAuth(
          damaged.id,
          { access: "damaged-access", refresh: "damaged-refresh" },
          { type: "oauth", methodID, access: "damaged-rotated", refresh: "damaged-rotated-refresh", expires: 1 },
        )
        expect(rotated).toBe(true)
      }),
    )
  }, 30_000)

  it("does not decrypt when a stale OAuth write misses an intact row", async () => {
    const workspace = Workspace.ID.make("wrk_cipher_stale")
    await seedWorkspace(workspace)
    const created = await withCredentials(
      workspace,
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.create({
          integrationID: Integration.ID.make("stale-oauth"),
          value: { type: "oauth", methodID, access: "stale-access", refresh: "stale-refresh", expires: 0 },
        })
      }),
    )
    const before = await inspect(workspace)
    const counted = counting()
    const rotated = await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.updateOAuth(
          created.id,
          { access: "stale-access", refresh: "other-refresh" },
          { type: "oauth", methodID, access: "stale-rotated", refresh: "stale-rotated", expires: 1 },
        )
      }).pipe(
        Effect.provide(
          Credential.layer(workspace).pipe(Layer.provideMerge(databaseLayer), Layer.provideMerge(counted.layer)),
        ),
      ),
    )
    expect(rotated).toBe(false)
    expect(counted.decrypts()).toBe(0)
    expect(await inspect(workspace)).toEqual(before)
  }, 30_000)

  it("still migrates key and legacy plaintext rows, keeping legacy OAuth matchable after a restart", async () => {
    const workspace = Workspace.ID.make("wrk_cipher_mixed")
    await seedWorkspace(workspace)
    const key = await withCredentials(
      workspace,
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.create({
          integrationID: Integration.ID.make("mixed-key"),
          value: { type: "key", key: "mixed-api-key" },
        })
      }),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.use("CipherMigration.seedMixed", (db) =>
          db.execute(
            sql`insert into credential (id, workspace_id, integration_id, label, active, value, value_json) values
              ('cred_mixed_key', ${workspace}, 'mixed-legacy', 'Legacy key', true, 'mixed-legacy-key', '{"type":"key","key":"mixed-legacy-key"}'),
              ('cred_mixed_oauth', ${workspace}, 'mixed-oauth', 'Legacy OAuth', true, null, ${`{"type":"oauth","methodID":"oauth","access":"mixed-access","refresh":"mixed-refresh","expires":0}`})`,
          ),
        )
      }).pipe(Effect.provide(databaseLayer)),
    )
    const before = await inspect(workspace)

    expect(await boot()).toContainEqual([
      "Cipher migrated legacy plaintext secrets to envelopes",
      { credentials: 2, providers: 0 },
    ])
    const first = await inspect(workspace)
    const row = (rows: typeof first, id: string) => rows.find((item) => item.id === id)
    // The service-written key credential was already encrypted and is not rewritten.
    expect(row(first, key.id)).toEqual(row(before, key.id))
    expect(row(first, "cred_mixed_key")?.value?.startsWith("v1.")).toBe(true)
    expect(row(first, "cred_mixed_oauth")?.value).toBeNull()
    for (const item of first) expect((item.valueJson as string).startsWith("v1.")).toBe(true)
    expect(JSON.stringify(first)).not.toMatch(/mixed-legacy-key|mixed-access|mixed-refresh/)
    expect(row(first, "cred_mixed_oauth")?.access).toMatch(/^[0-9a-f]{64}$/)

    // A restart keeps every row, digests included, exactly as the first boot left it.
    expect(migrated(await boot())).toEqual([])
    expect(await inspect(workspace)).toEqual(first)

    await withCredentials(
      workspace,
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        expect((yield* credentials.get(Credential.ID.make("cred_mixed_key")))?.value).toEqual({
          type: "key",
          key: "mixed-legacy-key",
        })
        const rotated = yield* credentials.updateOAuth(
          Credential.ID.make("cred_mixed_oauth"),
          { access: "mixed-access", refresh: "mixed-refresh" },
          { type: "oauth", methodID, access: "mixed-rotated", refresh: "mixed-rotated-refresh", expires: 1 },
        )
        expect(rotated).toBe(true)
      }),
    )
  }, 30_000)
})
