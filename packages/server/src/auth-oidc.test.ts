import { Auth } from "@bymorning/core/auth"
import { Audit } from "@bymorning/core/audit"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { Cipher } from "@bymorning/core/cipher"
import { Database } from "@bymorning/core/database"
import { Installation } from "@bymorning/core/installation"
import { Storage } from "@bymorning/core/storage"
import { AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, ManagedRuntime, Redacted, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { start, type Fixture } from "../test/oidc-idp.js"
import { postgres } from "../test/postgres.js"

const domains = ["example.test"] as const
const redirectURI = new URL("http://127.0.0.1/callback")
const verified = { email_verified: true } as const

const database = postgres()
const storage = Storage.layer({
  configure: (draft) => {
    draft.add(Storage.memory())
    draft.default.set(Storage.ID.make("memory"))
  },
})
const authNode = Auth.makeNode({ database: Database.node, storage: Storage.defaultNode }, [...domains])
const layer = LayerNode.compile(
  LayerNode.group([authNode, AuthProvider.node, Installation.node, Database.node, Storage.defaultNode]),
  {
    replacements: [
      Database.node.replace(database),
      Storage.defaultNode.replace(storage),
      Audit.node.replace(Audit.makeNode({ database: Database.node })),
      Cipher.node.replace(
        Cipher.configured(
          Effect.runSync(
            Cipher.localBackend(Redacted.make(Buffer.alloc(32, 29).toString("base64url"))).pipe(
              Effect.provide(NodeCrypto.layer),
            ),
          ),
        ),
      ),
    ],
  },
)
const build = () => ManagedRuntime.make(layer)

const withRuntime = async <A>(
  fn: (runtime: ReturnType<typeof build>, fixture: Fixture) => Promise<A>,
): Promise<A> => {
  const fixture = await start()
  const runtime = build()
  try {
    return await fn(runtime, fixture)
  } finally {
    await runtime.dispose()
    await fixture.close()
  }
}

const createProvider = (fixture: Fixture, id = AuthProviderSchema.ID.create()) =>
  Effect.gen(function* () {
    const providers = yield* AuthProvider.Service
    return yield* providers.create(
      Schema.decodeUnknownSync(AuthProviderSchema.Create)({
        id,
        displayName: "Fixture IdP",
        kind: "custom",
        issuer: fixture.issuer.href,
        clientID: fixture.clientID,
        clientSecret: fixture.clientSecret,
        domains: [...domains],
      }),
    )
  })

describe("Core Auth OIDC", () => {
  it("opens an OIDC attempt bound to the provider revision", { timeout: 120_000 }, async () => {
    await withRuntime(async (runtime, fixture) => {
      const info = await runtime.runPromise(createProvider(fixture))
      expect(info.revision).toBe(1)
      const opened = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth.open({ selection: { type: "oidc", id: info.id }, redirectURI })
        }),
      )
      expect(opened.redirect.origin).toBe(fixture.issuer.origin)
      expect(opened.redirect.searchParams.get("client_id")).toBe(fixture.clientID)
      expect(opened.attempt.binding).toEqual({ type: "oidc", provider: { id: info.id, revision: info.revision } })
      expect(Redacted.value(opened.attempt.state).length).toBeGreaterThan(0)
      expect(Redacted.value(opened.attempt.verifier).length).toBeGreaterThan(0)
    })
  })

  it("completes the OIDC flow into an AccountActor and Session", { timeout: 120_000 }, async () => {
    await withRuntime(async (runtime, fixture) => {
      const info = await runtime.runPromise(createProvider(fixture))
      const opened = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth.open({ selection: { type: "oidc", id: info.id }, redirectURI })
        }),
      )
      const issued = await fixture.authorize(opened.redirect, {
        sub: "person",
        email: "person@example.test",
        extra: { ...verified },
      })
      const completed = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth.complete({
            attempt: opened.attempt,
            response: Redacted.make(new URLSearchParams(issued.redirect.search)),
          })
        }),
      )
      expect(completed.actor.properties.accountID).toBeTruthy()
      expect(completed.session.accountID).toBe(completed.actor.properties.accountID)
      expect(completed.session.type).toBe("session")
      const authenticated = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth.authenticate(completed.session)
        }),
      )
      expect(authenticated.properties.accountID).toBe(completed.actor.properties.accountID)
    })
  })

  it("rejects an unverified email without weakening the product rule", { timeout: 120_000 }, async () => {
    await withRuntime(async (runtime, fixture) => {
      const info = await runtime.runPromise(createProvider(fixture))
      const opened = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth.open({ selection: { type: "oidc", id: info.id }, redirectURI })
        }),
      )
      const issued = await fixture.authorize(opened.redirect, {
        sub: "unverified",
        email: "unverified@example.test",
        extra: { email_verified: false },
      })
      const error = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth
            .complete({
              attempt: opened.attempt,
              response: Redacted.make(new URLSearchParams(issued.redirect.search)),
            })
            .pipe(Effect.flip)
        }),
      )
      expect(error._tag).toBe("Auth.RejectedError")
      expect((error as Auth.RejectedError).reason).toBe("email-unverified")
    })
  })

  it("rejects a stale attempt after the provider revision changes", { timeout: 120_000 }, async () => {
    await withRuntime(async (runtime, fixture) => {
      const info = await runtime.runPromise(createProvider(fixture))
      const opened = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth.open({ selection: { type: "oidc", id: info.id }, redirectURI })
        }),
      )
      const issued = await fixture.authorize(opened.redirect, {
        sub: "stale",
        email: "stale@example.test",
        extra: { ...verified },
      })
      const updated = await runtime.runPromise(
        Effect.gen(function* () {
          const providers = yield* AuthProvider.Service
          return yield* providers.update(
            Schema.decodeUnknownSync(AuthProviderSchema.Update)({
              id: info.id,
              revision: info.revision,
              displayName: "Fixture IdP v2",
              kind: "custom",
              domains: [...domains],
              status: "enabled",
            }),
          )
        }),
      )
      expect(updated.revision).toBe(2)
      const error = await runtime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          return yield* auth
            .complete({
              attempt: opened.attempt,
              response: Redacted.make(new URLSearchParams(issued.redirect.search)),
            })
            .pipe(Effect.flip)
        }),
      )
      expect(error._tag).toBe("Auth.RejectedError")
      expect((error as Auth.RejectedError).reason).toBe("provider-changed")
    })
  })

  it("keeps two accounts for two providers sharing one email", { timeout: 120_000 }, async () => {
    await withRuntime(async (runtime, fixture) => {
      // Two uninvited first logins require open provisioning (commercial stages);
      // the product default is invite-only.
      await runtime.runPromise(
        Installation.Service.use((service) => service.policy.update({ provisioning: "open" })),
      )
      const first = await runtime.runPromise(createProvider(fixture))
      const second = await runtime.runPromise(createProvider(fixture))
      expect(second.id).not.toBe(first.id)
      const completeOne = (providerID: AuthProviderSchema.ID, sub: string) =>
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          const opened = yield* auth.open({ selection: { type: "oidc", id: providerID }, redirectURI })
          const issued = yield* Effect.promise(() =>
            fixture.authorize(opened.redirect, { sub, email: "shared@example.test", extra: { ...verified } }),
          )
          return yield* auth.complete({
            attempt: opened.attempt,
            response: Redacted.make(new URLSearchParams(issued.redirect.search)),
          })
        })
      const one = await runtime.runPromise(completeOne(first.id, "shared-one"))
      const two = await runtime.runPromise(completeOne(second.id, "shared-two"))
      expect(one.actor.properties.accountID).toBeTruthy()
      expect(two.actor.properties.accountID).toBeTruthy()
      expect(two.actor.properties.accountID).not.toBe(one.actor.properties.accountID)
    })
  })
})
