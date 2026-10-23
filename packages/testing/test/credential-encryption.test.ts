import { AuthProvider } from "@bymorning/core/auth-provider"
import { Cipher } from "@bymorning/core/cipher"
import { Credential } from "@bymorning/core/credential"
import { AuthProviderTable, CredentialTable, Database, InstallationSetupTable } from "@bymorning/core/database"
import { Integration } from "@bymorning/core/integration"
import { Provider } from "@bymorning/schema/provider"
import { Effect, Redacted, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { start } from "../../server/test/oidc-idp.js"

const openCode = Integration.ID.make(Provider.OpenCode)

test("[SEC-CRYPT-07] connection credentials are ciphertext at rest and decrypt through the service", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // Chat.make connects "test-fixture-key" through the public Integration service.
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspaceID = data.owner.properties.workspaceID

        const rows = (yield* app.process(
          Database.Service.use((database) =>
            database.use("CredentialEncryption.rows", (db) => db.select().from(CredentialTable)),
          ),
        )).filter((row) => row.workspaceId === workspaceID)
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
          if (row.value !== null) {
            expect(row.value.startsWith("v1.")).toBe(true)
            expect(row.value).not.toContain("test-fixture-key")
          }
          expect(typeof row.valueJson).toBe("string")
          expect(row.valueJson as string).not.toContain("test-fixture-key")
        }

        // The same record decrypts back to the connected key through Credential.
        const listed = yield* app.process(
          Credential.Service.use((credentials) => credentials.list(openCode)).pipe(
            Effect.provide(Credential.layer(workspaceID)),
          ),
        )
        expect(listed.map((item) => item.value)).toContainEqual({ type: "key", key: "test-fixture-key" })
      }),
    ),
    { signal },
  )
})

test("[SEC-CRYPT-08] the boot migrator re-encrypts legacy plaintext rows in place", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const owner = yield* app.login()
        const workspaceID = owner.properties.workspaceID

        // A legacy row written before encryption at rest: plaintext columns.
        yield* app.process(
          Database.Service.use((database) =>
            database.use("CredentialEncryption.legacy", (db) =>
              db.insert(CredentialTable).values({
                id: Credential.ID.make("cred_boot_legacy"),
                workspaceId: workspaceID,
                integration_id: openCode,
                label: "Legacy",
                active: true,
                value: "boot-legacy-key",
                valueJson: { type: "key", key: "boot-legacy-key" },
              }),
            ),
          ),
        )
        // Reads tolerate legacy plaintext during the migration window.
        const before = yield* app.process(
          Credential.Service.use((credentials) => credentials.get(Credential.ID.make("cred_boot_legacy"))).pipe(
            Effect.provide(Credential.layer(workspaceID)),
          ),
        )
        expect(before?.value).toEqual({ type: "key", key: "boot-legacy-key" })

        // The boot migrator (run here as the same effect the boot node runs).
        yield* app.process(Cipher.migrate)

        const row = (yield* app.process(
          Database.Service.use((database) =>
            database.use("CredentialEncryption.migrated", (db) => db.select().from(CredentialTable)),
          ),
        )).filter((row) => row.id === "cred_boot_legacy")
        expect(row[0]?.value?.startsWith("v1.")).toBe(true)
        expect(typeof row[0]?.valueJson).toBe("string")
        expect(JSON.stringify(row)).not.toContain("boot-legacy-key")

        const after = yield* app.process(
          Credential.Service.use((credentials) => credentials.get(Credential.ID.make("cred_boot_legacy"))).pipe(
            Effect.provide(Credential.layer(workspaceID)),
          ),
        )
        expect(after?.value).toEqual({ type: "key", key: "boot-legacy-key" })
      }),
    ),
    { signal },
  )
})

test("[SEC-CRYPT-09] Auth Provider client_secret is ciphertext at rest and resolves for login", async ({ signal }) => {
  const fixture = await start()
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const app = yield* TestApp.make()
          yield* app.login()
          const input = yield* Schema.decodeUnknownEffect(AuthProvider.Create)({
            id: AuthProvider.ID.create(),
            displayName: "Fixture IdP",
            kind: "custom",
            issuer: fixture.issuer.href,
            clientID: fixture.clientID,
            clientSecret: fixture.clientSecret,
            domains: ["example.test"],
          }).pipe(Effect.orDie)
          const created = yield* app.process(AuthProvider.Service.use((providers) => providers.create(input)))
          const row = (yield* app.process(
            Database.Service.use((database) =>
              database.use("CredentialEncryption.provider", (db) => db.select().from(AuthProviderTable)),
            ),
          )).filter((row) => row.id === created.id)
          expect(row[0]?.client_secret.startsWith("v1.")).toBe(true)
          expect(row[0]?.client_secret).not.toContain(fixture.clientSecret)

          const active = yield* app.process(
            AuthProvider.Service.use((providers) => providers.resolve({ id: created.id })),
          )
          expect(Redacted.value(active.clientSecret)).toBe(fixture.clientSecret)
        }),
      ),
      { signal },
    )
  } finally {
    await fixture.close()
  }
})

test("[SEC-CRYPT-10] the setup token is stored as a hash while the reveal file keeps working", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // No Auth Provider exists yet, so Setup is pending and the token is revealed.
        const app = yield* TestApp.make()
        const revealed = (yield* Effect.tryPromise(() => readFile(join(app.directory, "setup-token"), "utf8"))).trim()
        expect(revealed.length).toBeGreaterThan(32)

        const row = yield* app.process(
          Database.Service.use((database) =>
            database.use("CredentialEncryption.setupToken", (db) => db.select().from(InstallationSetupTable)),
          ),
        )
        const stored = row[0]?.token
        expect(stored?.startsWith("sha256:")).toBe(true)
        expect(stored).not.toContain(revealed)

        // The revealed token still proves setup authority; a wrong token does not.
        const listed = yield* app.process(
          AuthProvider.Service.use((providers) => providers.inspect(Redacted.make(revealed))),
        )
        expect(listed).toEqual([])
        const refused = yield* app.process(
          AuthProvider.Service.use((providers) => providers.inspect(Redacted.make("wrong-token"))).pipe(Effect.flip),
        )
        expect(refused._tag).toBe("AuthProvider.TokenError")
      }),
    ),
    { signal },
  )
})
