import { isServiceUnavailableError } from "@bymorning/client"
import { Cipher } from "@bymorning/core/cipher"
import { Credential } from "@bymorning/core/credential"
import { CredentialTable, Database } from "@bymorning/core/database"
import { Integration } from "@bymorning/core/integration"
import { AccountActor } from "@bymorning/schema/actor"
import { Provider } from "@bymorning/schema/provider"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Redacted } from "effect"
import { randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

const openCode = Integration.ID.make(Provider.OpenCode)

/**
 * A Cipher over a key this installation does not own, standing in for data
 * written under a key version that was later disabled or retired: its
 * envelopes name a foreign key identity, so the Application's backend refuses
 * them before any unwrap and nothing can prime Cipher's data-key cache.
 */
const retired = Effect.gen(function* () {
  const local = yield* Cipher.localBackend(Redacted.make(randomBytes(32).toString("base64url")))
  return yield* Cipher.make({ ...local, keyID: "arn:aws:kms:us-east-1:000000000000:key/retired" })
}).pipe(Effect.provide(NodeCrypto.layer))

const pairs = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";", 1)[0]?.trim() ?? "")
    .filter((pair) => pair.includes("=") && pair.slice(pair.indexOf("=") + 1) !== "")

/** Sign the fixture identity in over raw HTTP so the response status and body stay observable. */
const sessionCookie = (app: TestApp.Interface) =>
  Effect.tryPromise(async () => {
    const start = await fetch(new URL("/auth/login", app.origin), {
      redirect: "manual",
      headers: { origin: app.origin.origin },
    })
    const location = start.headers.get("location")
    if (start.status !== 302 || location === null) throw new Error("Local login did not redirect")
    const callback = new URL(location)
    const complete = await fetch(new URL(callback.pathname + callback.search, app.origin), {
      redirect: "manual",
      headers: { origin: app.origin.origin, cookie: pairs(start).join("; ") },
    })
    if (complete.status !== 303) throw new Error("Local login did not authenticate")
    return [...pairs(start), ...pairs(complete)].join("; ")
  })

test("[SEC-CRYPT-14] a stored Credential under an unavailable key answers 503 with a clear error, not a bare 500", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const owner = yield* app.login()
        const workspaceID = owner.properties.workspaceID
        const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
        // A current Connection through the public service reads back normally.
        yield* app.workspace(
          { account },
          Integration.Service.use((integration) =>
            integration.connection.key({ integrationID: openCode, key: "test-fixture-key" }),
          ),
        )
        const before = yield* Effect.tryPromise(() => app.client.integration.list())
        expect(before.some((info) => info.id === openCode)).toBe(true)

        // A Connection written under a key this backend no longer serves.
        const cipher = yield* retired
        const envelope = yield* cipher.encrypt(Redacted.make(JSON.stringify({ type: "key", key: "retired-key" })))
        const direct = yield* cipher.encrypt(Redacted.make("retired-key"))
        yield* app.process(
          Database.Service.use((database) =>
            database.use("CredentialKey.retired", (db) =>
              db.insert(CredentialTable).values({
                id: Credential.ID.make("cred_retired_key"),
                workspaceId: workspaceID,
                integration_id: openCode,
                label: "Retired",
                active: false,
                value: direct,
                valueJson: envelope,
              }),
            ),
          ),
        )

        // Listing Integrations resolves every stored Connection; the refused key is a 503 with a JSON body.
        const cookie = yield* sessionCookie(app)
        const response = yield* Effect.tryPromise(() =>
          fetch(new URL("/api/integration", app.origin), { headers: { origin: app.origin.origin, cookie } }),
        )
        expect(response.status).toBe(503)
        expect(response.headers.get("content-type")).toContain("application/json")
        const body = yield* Effect.tryPromise(() => response.json())
        expect(body).toEqual({ _tag: "ServiceUnavailableError", message: "Credential key is unavailable" })
        expect(JSON.stringify(body)).not.toContain("retired-key")
        expect(JSON.stringify(body)).not.toContain("test-fixture-key")

        // The generated SDK decodes the same refusal into its typed error, for list and get alike.
        const listed = yield* Effect.tryPromise(() => app.client.integration.list()).pipe(Effect.flip)
        expect(isServiceUnavailableError(listed.cause)).toBe(true)
        if (isServiceUnavailableError(listed.cause)) expect(listed.cause.message).toBe("Credential key is unavailable")
        const single = yield* Effect.tryPromise(() => app.client.integration.get({ integrationID: openCode })).pipe(
          Effect.flip,
        )
        expect(isServiceUnavailableError(single.cause)).toBe(true)
      }),
    ),
    { signal },
  )
})
