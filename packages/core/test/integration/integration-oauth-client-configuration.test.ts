import { PgClient } from "@effect/sql-pg"
import { Workspace } from "@bymorning/schema/workspace"
import { eq } from "drizzle-orm"
import { TestDatabase } from "@bymorning/testing/database"
import { Effect, Exit, Layer, Redacted, Scope } from "effect"
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { run } from "../../../server/src/migrator.js"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Database, CredentialTable } from "../../src/database.js"
import { Integration } from "../../src/integration.js"
import { Credential } from "../../src/credential.js"
import { Cipher } from "../../src/cipher.js"
import { layer as cipherLayer } from "../fixtures/cipher.js"
import { User } from "@bymorning/schema/user"

const scope = Effect.runPromise(Scope.make())
const workspaceID = Workspace.ID.make("wrk_oauth_client")
const aliceID = User.ID.make("usr_credential_alice")
const bobID = User.ID.make("usr_credential_bob")
const otherWorkspaceID = Workspace.ID.make("wrk_oauth_client_other")
const key = {
  integrationID: Integration.ID.make("mail-provider"),
  methodID: Integration.MethodID.make("oauth"),
}
const fields = [
  { key: "client_id", type: "string" as const, required: true },
  { key: "client_secret", type: "string" as const },
  { key: "enabled", type: "boolean" as const },
] as const
let databaseLayer: Layer.Layer<Database.Service>
let layer: Layer.Layer<Credential.Service | Database.Service>
let aliceLayer: Layer.Layer<Credential.Service | Database.Service>
let bobLayer: Layer.Layer<Credential.Service | Database.Service>
let otherLayer: Layer.Layer<Credential.Service | Database.Service>

beforeAll(async () => {
  // Migrate an empty database up to the release before credential ownership,
  // seed legacy rows, then apply the remaining migrations with the production migrator.
  const server = await Effect.runPromise(TestDatabase.shared)
  const url = await Effect.runPromise(server.create({ empty: true }).pipe(Scope.provide(await scope)))
  const staged = mkdtempSync(join(tmpdir(), "bymorning-credential-migration-"))
  const migration = new URL("../../src/database/migration/", import.meta.url)
  for (const entry of readdirSync(migration)) {
    if (entry >= "20260905024404_credential-owner") continue
    cpSync(new URL(entry, migration), join(staged, entry), { recursive: true })
  }
  await Effect.runPromise(run({ url, migrationsFolder: staged }))
  await Effect.runPromise(
    PgClient.PgClient.use((sql) =>
      sql.unsafe(
        `insert into workspace (id, name, status) values ('${workspaceID}', 'OAuth', 'active'), ('${otherWorkspaceID}', 'Other', 'active'); insert into "user" (id, workspace_id, role) values ('${aliceID}', '${workspaceID}', 'member'), ('${bobID}', '${workspaceID}', 'member'); insert into credential (id, workspace_id, integration_id, label, active, value_json) values ('cred_legacy', '${workspaceID}', '${key.integrationID}', 'Legacy', true, '{"type":"key","key":"legacy"}'); insert into integration_oauth_client_configuration (workspace_id, integration_id, method_id, value_json) values ('${workspaceID}', '${key.integrationID}', '${key.methodID}', '{"client_id":"legacy-client"}')`,
      ),
    ).pipe(Effect.provide(PgClient.layer({ url, maxConnections: 1 })), Effect.scoped),
  )
  await Effect.runPromise(run({ url, migrationsFolder: fileURLToPath(migration) }))
  rmSync(staged, { recursive: true })
  databaseLayer = Database.layer.pipe(Layer.provide(PgClient.layer({ url })), Layer.orDie)
  const ciphered = Layer.mergeAll(databaseLayer, cipherLayer)
  aliceLayer = Credential.layer({ workspaceID, userID: aliceID }).pipe(Layer.provideMerge(ciphered))
  bobLayer = Credential.layer({ workspaceID, userID: bobID }).pipe(Layer.provideMerge(ciphered))
  layer = Credential.layer(workspaceID).pipe(Layer.provideMerge(ciphered))
  otherLayer = Credential.layer(otherWorkspaceID).pipe(Layer.provideMerge(ciphered))
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      expect(yield* credentials.client.resolve(key, fields)).toEqual({ client_id: "legacy-client" })
      expect(yield* credentials.all()).toMatchObject([
        { id: "cred_legacy", scope: "workspace", active: true, value: { type: "key", key: "legacy" } },
      ])
    }).pipe(Effect.provide(layer)),
  )
}, 30_000)

afterAll(async () => Effect.runPromise(Scope.close(await scope, Exit.void)))

beforeEach(async () => {
  await Effect.runPromise(
    Database.Service.use((database) =>
      database.use("OAuthClientConfiguration.test.reset", (db) => db.delete(CredentialTable)),
    ).pipe(Effect.provide(databaseLayer)),
  )
})

describe("Integration OAuth client persistence", () => {
  it("stores and replaces the complete answer as an encrypted envelope", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const configurations = credentials.client
        expect(yield* configurations.configured([key])).toEqual([])
        expect(yield* configurations.put(key, fields, { client_secret: "secret" }).pipe(Effect.flip)).toBeInstanceOf(
          Credential.InvalidError,
        )
        yield* configurations.put(key, fields, { client_id: "public", client_secret: "secret" })
        expect(yield* configurations.resolve(key, fields)).toEqual({ client_id: "public", client_secret: "secret" })
        const database = yield* Database.Service
        yield* database.use("OAuthClientConfiguration.test.invalidate", (db) =>
          db
            .update(CredentialTable)
            .set({ valueJson: { enabled: false } })
            .where(eq(CredentialTable.workspaceId, workspaceID)),
        )
        expect(yield* configurations.resolve(key, fields).pipe(Effect.flip)).toBeInstanceOf(Credential.InvalidError)
        yield* configurations.put(key, fields, { client_id: "replacement", enabled: false })
      }).pipe(Effect.provide(layer)),
    )

    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const cipher = yield* Cipher.Service
        const rows = yield* database.use("OAuthClientConfiguration.test.rows", (db) =>
          db
            .select({ value: CredentialTable.valueJson })
            .from(CredentialTable)
            .where(eq(CredentialTable.workspaceId, workspaceID)),
        )
        const row = rows[0]
        // At rest the answer is a Cipher envelope, never the submitted object.
        expect(typeof row?.value).toBe("string")
        const stored = row!.value as string
        expect(stored.startsWith("v1.")).toBe(true)
        expect(stored).not.toContain("replacement")
        const plaintext = yield* cipher.decrypt(stored)
        return JSON.parse(Redacted.value(plaintext))
      }).pipe(Effect.provide(Layer.mergeAll(databaseLayer, cipherLayer))),
    )
    expect(rows).toEqual({ client_id: "replacement", enabled: false })
  })

  it("isolates workspaces and removes idempotently", async () => {
    await Effect.runPromise(
      Credential.Service.use(({ client: configurations }) =>
        configurations.put(key, fields, { client_id: "other" }),
      ).pipe(Effect.provide(otherLayer)),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const configurations = credentials.client
        expect(yield* configurations.resolve(key, fields).pipe(Effect.flip)).toBeInstanceOf(Credential.MissingError)
        yield* configurations.put(key, fields, { client_id: "current" })
        expect(yield* configurations.remove(key)).toBe(true)
        expect(yield* configurations.remove(key)).toBe(false)
      }).pipe(Effect.provide(layer)),
    )
    await expect(
      Effect.runPromise(
        Credential.Service.use(({ client: configurations }) => configurations.resolve(key, fields)).pipe(
          Effect.provide(otherLayer),
        ),
      ),
    ).resolves.toEqual({ client_id: "other" })
  })
})

it("keeps member selections independent and excludes other members and client records", async () => {
  const shared = await Effect.runPromise(
    Credential.Service.use((credentials) =>
      credentials.create({ integrationID: key.integrationID, value: { type: "key", key: "shared" } }),
    ).pipe(Effect.provide(layer)),
  )
  const alice = await Effect.runPromise(
    Credential.Service.use((credentials) =>
      credentials.create({ integrationID: key.integrationID, scope: "member", value: { type: "key", key: "alice" } }),
    ).pipe(Effect.provide(aliceLayer)),
  )
  const bob = await Effect.runPromise(
    Credential.Service.use((credentials) =>
      credentials.create({ integrationID: key.integrationID, scope: "member", value: { type: "key", key: "bob" } }),
    ).pipe(Effect.provide(bobLayer)),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const second = yield* credentials.create({
        integrationID: key.integrationID,
        scope: "member",
        value: { type: "key", key: "alice-second" },
      })
      expect((yield* credentials.get(alice.id))?.active).toBe(false)
      yield* credentials.activate(alice.id)
      expect((yield* credentials.get(alice.id))?.active).toBe(true)
      expect((yield* credentials.get(second.id))?.active).toBe(false)
      yield* credentials.remove(alice.id)
      expect((yield* credentials.get(second.id))?.active).toBe(true)
      expect((yield* credentials.get(shared.id))?.active).toBe(true)
      expect(yield* credentials.get(shared.id, "member")).toBeUndefined()
      expect(yield* credentials.get(bob.id)).toBeUndefined()
      yield* credentials.update(bob.id, { label: "inaccessible" })
      yield* credentials.remove(bob.id)
      yield* credentials.activate(bob.id)
      yield* credentials.client.put(key, fields, { client_id: "workspace-client" })
      expect((yield* credentials.all()).map((item) => item.id).sort()).toEqual([shared.id, second.id].sort())
      const database = yield* Database.Service
      const rows = yield* database.use("Credential.test.client", (db) =>
        db.select({ id: CredentialTable.id }).from(CredentialTable).where(eq(CredentialTable.purpose, "client")),
      )
      expect(rows).toHaveLength(1)
      const clientID = rows[0]?.id
      if (!clientID) throw new Error("Client row missing")
      expect(yield* credentials.get(clientID)).toBeUndefined()
      yield* credentials.remove(clientID)
      expect(yield* credentials.client.resolve(key, fields)).toEqual({ client_id: "workspace-client" })
    }).pipe(Effect.provide(aliceLayer)),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      expect((yield* credentials.list(key.integrationID, "member")).map((item) => item.id)).toEqual([bob.id])
      expect((yield* credentials.get(bob.id))?.active).toBe(true)
      expect((yield* credentials.get(bob.id))?.label).toBe("default")
      expect(yield* credentials.get(alice.id)).toBeUndefined()
      expect(yield* credentials.client.resolve(key, fields)).toEqual({ client_id: "workspace-client" })
    }).pipe(Effect.provide(bobLayer)),
  )
  await Effect.runPromise(
    Credential.Service.use((credentials) => credentials.all()).pipe(
      Effect.tap((items) => Effect.sync(() => expect(items.map((item) => item.id)).toEqual([shared.id]))),
      Effect.provide(layer),
    ),
  )
})

it("guards OAuth refresh and removal by owner and promotes only that owner's connection", async () => {
  const value = { type: "oauth" as const, methodID: key.methodID, access: "access", refresh: "refresh", expires: 0 }
  const alice = await Effect.runPromise(
    Credential.Service.use((credentials) =>
      credentials.create({ integrationID: key.integrationID, scope: "member", value }),
    ).pipe(Effect.provide(aliceLayer)),
  )
  const bob = await Effect.runPromise(
    Credential.Service.use((credentials) =>
      credentials.create({ integrationID: key.integrationID, scope: "member", value }),
    ).pipe(Effect.provide(bobLayer)),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      expect(yield* credentials.updateOAuth(alice.id, value, { ...value, access: "stolen" })).toBe(false)
      expect(yield* credentials.removeOAuth(alice.id, value)).toBe(false)
      expect(
        yield* credentials.refreshOAuth(alice.id, 1, () => Effect.die("Other member refresh must not run")),
      ).toBeUndefined()
      expect((yield* credentials.get(bob.id))?.active).toBe(true)
    }).pipe(Effect.provide(bobLayer)),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const replacement = yield* credentials.create({
        integrationID: key.integrationID,
        scope: "member",
        value: { ...value, access: "second" },
      })
      expect(
        yield* credentials.refreshOAuth(replacement.id, 1, () =>
          Effect.succeed({ ...value, access: "refreshed", expires: 10 }),
        ),
      ).toMatchObject({ access: "refreshed" })
      expect(yield* credentials.removeOAuth(replacement.id, { access: "refreshed", refresh: value.refresh })).toBe(true)
      expect((yield* credentials.get(alice.id))?.active).toBe(true)
    }).pipe(Effect.provide(aliceLayer)),
  )
  expect(
    await Effect.runPromise(
      Credential.Service.use((credentials) => credentials.get(bob.id)).pipe(Effect.provide(bobLayer)),
    ),
  ).toMatchObject({ active: true, value })
})
