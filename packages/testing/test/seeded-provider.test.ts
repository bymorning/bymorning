import { ByMorning } from "@bymorning/client"
import { Cipher } from "@bymorning/core/cipher"
import { Storage } from "@bymorning/core/storage"
import { AuthProvider as AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Option, Redacted, Schema, Stream } from "effect"
import { randomBytes } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { start } from "../../server/test/oidc-idp.js"
import { TestApp } from "../src/application.js"
import { TestDatabase } from "../src/database.js"

const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(";", 1)[0]

/**
 * A non-loopback deployment on the real Application: PostgreSQL, filesystem
 * object storage, a Cipher master key held in a key file (the development
 * host's `local` cipher backend), and an origin where Local Login is refused
 * and sign-in runs through the seeded Auth Provider.
 */
test("a non-loopback origin refuses Local Login and signs in through the seeded Auth Provider", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const idp = yield* Effect.acquireRelease(
          Effect.tryPromise(() => start()),
          (fixture) => Effect.promise(() => fixture.close()).pipe(Effect.orDie),
        )
        // The cipher master key is held in a file, exactly as the development
        // host's local cipher backend reads it.
        const keyDirectory = yield* Effect.acquireRelease(
          Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "bymorning-seeded-key-"))),
          (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(Effect.orDie),
        )
        const keyFile = path.join(keyDirectory, "cipher.key")
        yield* Effect.tryPromise(() =>
          writeFile(keyFile, randomBytes(32).toString("base64url"), { mode: 0o600 }),
        )
        const cipherKey = yield* Effect.tryPromise(() => readFile(keyFile, "utf8"))
        const cipher = yield* Cipher.localBackend(Redacted.make(cipherKey.trim())).pipe(
          Effect.provide(NodeCrypto.layer),
          Effect.orDie,
        )
        const database = yield* TestDatabase.shared
        const app = yield* TestApp.make({
          database,
          cipher,
          appOrigin: new URL("https://bymorning.example.test"),
          seed: Schema.decodeUnknownSync(AuthProviderSchema.Seed)({
            displayName: "Fixture IdP",
            kind: "custom",
            issuer: idp.issuer.href,
            clientID: idp.clientID,
            clientSecret: idp.clientSecret,
            domains: ["example.test"],
          }),
        })

        // The seeded Auth Provider is advertised; Local Login is not offered
        // on a non-loopback origin.
        const method = yield* Effect.tryPromise(() => app.client.auth.method())
        expect(method.state).toBe("ready")
        expect("local" in method && method.local).toBe(false)
        if (method.state !== "ready") throw new Error("unreachable")
        expect(method.providers).toHaveLength(1)
        expect(method.providers[0]).toMatchObject({ displayName: "Fixture IdP", kind: "custom" })

        // Local Login is refused outright: the server rejects the attempt.
        const refused = yield* Effect.tryPromise(() =>
          fetch(new URL("/auth/login", app.origin), { redirect: "manual" }),
        )
        expect(refused.status).toBe(503)

        // Sign in through the real OIDC flow against the seeded provider.
        const providerID = method.providers[0]!.id
        const login = yield* Effect.tryPromise(() =>
          fetch(new URL(`/auth/login?provider=${providerID}`, app.origin), { redirect: "manual" }),
        )
        expect(login.status).toBe(302)
        const authorization = new URL(login.headers.get("location") ?? "invalid:")
        expect(authorization.origin).toBe(idp.issuer.origin)
        const attempt = cookie(login, "bm_local_attempt")
        expect(attempt).toBeDefined()
        const issued = yield* Effect.tryPromise(() =>
          idp.authorize(authorization, {
            sub: "operator-1",
            email: "operator@example.test",
            extra: { email_verified: true },
          }),
        )
        const callback = yield* Effect.tryPromise(() =>
          fetch(new URL(issued.redirect.pathname + issued.redirect.search, app.origin), {
            redirect: "manual",
            headers: { cookie: attempt! },
          }),
        )
        expect(callback.status).toBe(303)
        const account = cookie(callback, "bm_local_auth")
        expect(account).toBeDefined()

        // The first sign-in bootstraps the Installation Admin and its Default
        // Workspace through the real SDK.
        const client = ByMorning.make({ baseUrl: app.origin.href, headers: { cookie: account! } })
        expect(yield* Effect.tryPromise(() => client.workspace.list())).toHaveLength(1)

        // Filesystem storage is the selected provider and serves objects.
        const provider = yield* app.process(Storage.Service.use((storage) => storage.default()))
        expect(provider.id).toBe("filesystem")
        const key = Storage.path("seeded-provider", "probe.txt")
        yield* app.process(
          Storage.Service.use((storage) =>
            storage.object.set(key, { body: Stream.succeed(new TextEncoder().encode("mounted")), contentType: "text/plain" }),
          ),
        )
        const stored = yield* app.process(Storage.Service.use((storage) => storage.object.get(key)))
        expect(Option.isSome(stored)).toBe(true)

        // Secrets are encrypted at rest with the file-held master key, and a
        // backend rebuilt from the same file (a restarted process) decrypts them.
        const envelope = yield* app.process(
          Cipher.Service.use((service) => service.encrypt(Redacted.make("seeded-provider-secret"))),
        )
        expect(envelope).not.toContain("seeded-provider-secret")
        const reloaded = yield* Cipher.localBackend(
          Redacted.make((yield* Effect.tryPromise(() => readFile(keyFile, "utf8"))).trim()),
        ).pipe(Effect.provide(NodeCrypto.layer), Effect.orDie)
        const restarted = yield* Cipher.make(reloaded).pipe(Effect.provide(NodeCrypto.layer))
        const decrypted = yield* restarted.decrypt(envelope)
        expect(Redacted.value(decrypted)).toBe("seeded-provider-secret")
      }),
    ),
    { signal },
  )
}, 120_000)
