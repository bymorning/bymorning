import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { ConfigProvider, DateTime, Effect, Layer, Redacted, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { WebCookie } from "./web-cookie.js"

const cookieLayer = (key: string) =>
  WebCookie.productionLayer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ WEB_COOKIE_KEY: key }))),
  )
const layer = cookieLayer(Buffer.alloc(32, 7).toString("base64url"))

const providerRef = Schema.decodeUnknownSync(AuthProviderSchema.Ref)({
  id: AuthProviderSchema.ID.create(),
  revision: 1,
})

const session = WebCookie.Session.make({
  version: 2,
  type: "session",
  id: Auth.SessionID.make("lgs_cookie_test"),
  accountID: Account.ID.make("acc_cookie_test"),
  issuedAt: DateTime.makeUnsafe("2026-08-14T12:00:00Z"),
  expiresAt: DateTime.makeUnsafe("2026-08-14T12:00:00Z").pipe(DateTime.addDuration("12 hours")),
})

const run = <A, E>(effect: Effect.Effect<A, E, WebCookie.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe("WebCookie", () => {
  it("round trips versioned Session and Attempt payloads", async () => {
    const attempt = WebCookie.Attempt.make({
      version: 1,
      type: "attempt",
      binding: { type: "oidc", provider: providerRef },
      state: Redacted.make("state-value"),
      verifier: Redacted.make("pkce-verifier"),
      redirectURI: new URL("https://app.bymorning.ai/auth/callback"),
      expiresAt: DateTime.makeUnsafe("2026-08-14T12:10:00Z"),
    })

    const [decodedSession, decodedAttempt] = await run(
      Effect.gen(function* () {
        const cookies = yield* WebCookie.Service
        return yield* Effect.all([
          cookies.encrypt(session).pipe(Effect.flatMap(cookies.decrypt)),
          cookies.encrypt(attempt).pipe(Effect.flatMap(cookies.decrypt)),
        ])
      }),
    )

    expect(decodedSession).toEqual(session)
    expect(decodedAttempt).toEqual(attempt)
  })

  it("rejects tampering and unknown envelope fields", async () => {
    const value = await run(
      Effect.gen(function* () {
        const cookies = yield* WebCookie.Service
        return yield* cookies.encrypt(session)
      }),
    )
    const wire = Redacted.value(value)
    const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
      Buffer.from(wire, "base64url").toString("utf8"),
    )
    const envelope = Schema.decodeUnknownSync(
      Schema.Struct({
        version: Schema.Literal("v1"),
        nonce: Schema.String,
        ciphertext: Schema.String,
        tag: Schema.String,
      }),
    )(parsed)
    const tag = envelope.tag
    const tamperedEnvelope = { ...envelope, tag: `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}` }
    const tamperedWire = Buffer.from(JSON.stringify(tamperedEnvelope)).toString("base64url")
    const tampered = Schema.decodeUnknownSync(WebCookie.Value)(Redacted.make(tamperedWire))
    const extended = Schema.decodeUnknownSync(WebCookie.Value)(
      Redacted.make(Buffer.from(JSON.stringify({ ...tamperedEnvelope, extra: true })).toString("base64url")),
    )

    const [tamperedExit, extendedExit] = await Promise.all([
      Effect.runPromiseExit(
        Effect.gen(function* () {
          const cookies = yield* WebCookie.Service
          return yield* cookies.decrypt(tampered)
        }).pipe(Effect.provide(layer)),
      ),
      Effect.runPromiseExit(
        Effect.gen(function* () {
          const cookies = yield* WebCookie.Service
          return yield* cookies.decrypt(extended)
        }).pipe(Effect.provide(layer)),
      ),
    ])

    expect(tamperedExit._tag).toBe("Failure")
    expect(extendedExit._tag).toBe("Failure")
    expect(String(tamperedExit)).not.toContain(wire)
  })

  it("rejects non-32-byte keys and plaintext over 2 KiB", async () => {
    const invalidKey = Buffer.alloc(31).toString("base64url")
    const configExit = await Effect.runPromiseExit(WebCookie.Service.pipe(Effect.provide(cookieLayer(invalidKey))))
    const large = WebCookie.Attempt.make({
      version: 1,
      type: "attempt",
      binding: { type: "oidc", provider: providerRef },
      state: Redacted.make("s".repeat(2050)),
      verifier: Redacted.make("verifier"),
      redirectURI: new URL("https://app.bymorning.ai/auth/callback"),
      expiresAt: DateTime.makeUnsafe("2026-08-14T12:10:00Z"),
    })
    const largeExit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const cookies = yield* WebCookie.Service
        return yield* cookies.encrypt(large)
      }).pipe(Effect.provide(layer)),
    )

    expect(configExit._tag).toBe("Failure")
    expect(largeExit._tag).toBe("Failure")
  })
})
