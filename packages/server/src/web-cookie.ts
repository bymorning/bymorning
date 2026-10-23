export * as WebCookie from "./web-cookie.js"

import { NodeCrypto } from "@effect/platform-node"
import { Auth } from "@bymorning/schema/auth"
import { Config, Context, Crypto, Duration, Effect, Layer, Redacted, Schema } from "effect"
import { createCipheriv, createDecipheriv } from "node:crypto"
import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"

/** One-use login attempt cookie payload. Carries the Core Auth Attempt value, nothing else. */
export const Attempt = Auth.Attempt
export interface Attempt extends Auth.Attempt {}

/** Login Session cookie payload. Carries the Core Auth Session value, nothing else. */
export const Session = Auth.Session
export interface Session extends Auth.Session {}

/** @deprecated Use Session (Auth.Session). Kept while callers migrate off the Account cookie name. */
export const Account = Auth.Session
export interface Account extends Auth.Session {}

const Payload = Schema.Union([Auth.Attempt, Auth.Session])
export type Payload = Auth.Attempt | Auth.Session

const Base64Url = Schema.String.check(Schema.isBase64Url())
const Envelope = Schema.Struct({
  version: Schema.Literal("v1"),
  nonce: Base64Url,
  ciphertext: Base64Url,
  tag: Base64Url,
})
const EnvelopeJson = Schema.toCodecJson(Envelope)
const PayloadJson = Schema.toCodecJson(Payload)
const strict = { onExcessProperty: "error" } as const

const ValueText = Schema.String.check(Schema.isBase64Url(), Schema.isMaxLength(4096)).pipe(
  Schema.brand("WebCookie.Value"),
)
export const Value = Schema.Redacted(ValueText)
export type Value = typeof Value.Type

const KeyText = Schema.String.check(Schema.isBase64Url()).pipe(Schema.brand("WebCookie.Key"))
const Key = Schema.Redacted(KeyText)
type Key = typeof Key.Type

export class ConfigError extends Schema.TaggedError<ConfigError>()("WebCookie.ConfigError", {}) {}

export class CookieError extends Schema.TaggedError<CookieError>()("WebCookie.CookieError", {
  operation: Schema.Literals(["encrypt", "decrypt"]),
}) {}

export interface Interface {
  readonly encrypt: (payload: Payload) => Effect.Effect<Value, CookieError>
  readonly decrypt: (value: Value) => Effect.Effect<Payload, CookieError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/server/WebCookie") {}

const fail = (operation: "encrypt" | "decrypt") => new CookieError({ operation })
const aad = Buffer.from("v1", "utf8")

const decodeKey = (key: Key) =>
  Effect.try({
    try: () => {
      const bytes = Buffer.from(Redacted.value(key), "base64url")
      if (bytes.length !== 32) throw new Error("invalid key length")
      return bytes
    },
    catch: () => new ConfigError({}),
  })

const layerWith = (key: Key): Layer.Layer<Service, ConfigError, Crypto.Crypto> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const keyBytes = yield* decodeKey(key)
      const crypto = yield* Crypto.Crypto

      const encrypt = Effect.fn("WebCookie.encrypt")(function* (payload: Payload) {
        const plaintext = yield* Schema.encodeUnknownEffect(PayloadJson)(payload).pipe(
          Effect.flatMap((encoded) =>
            Effect.try({
              try: () => Buffer.from(JSON.stringify(encoded), "utf8"),
              catch: () => fail("encrypt"),
            }),
          ),
          Effect.mapError(() => fail("encrypt")),
        )
        if (plaintext.length > 2048) return yield* fail("encrypt")
        const nonce = yield* crypto.randomBytes(12).pipe(Effect.mapError(() => fail("encrypt")))
        return yield* Effect.try({
          try: () => {
            const cipher = createCipheriv("aes-256-gcm", keyBytes, nonce, { authTagLength: 16 })
            cipher.setAAD(aad)
            const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
            const envelope = Envelope.make({
              version: "v1",
              nonce: Buffer.from(nonce).toString("base64url"),
              ciphertext: ciphertext.toString("base64url"),
              tag: cipher.getAuthTag().toString("base64url"),
            })
            const wire = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")
            if (wire.length > 4096) throw new Error("cookie is too large")
            return Redacted.make(ValueText.make(wire))
          },
          catch: () => fail("encrypt"),
        })
      })

      const decrypt = Effect.fn("WebCookie.decrypt")(function* (value: Value) {
        const wire = Redacted.value(value)
        if (wire.length > 4096) return yield* fail("decrypt")
        const envelopeText = yield* Effect.try({
          try: () => {
            const bytes = Buffer.from(wire, "base64url")
            if (bytes.toString("base64url") !== wire) throw new Error("non-canonical value")
            return bytes.toString("utf8")
          },
          catch: () => fail("decrypt"),
        })
        const envelope = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(EnvelopeJson),
          strict,
        )(envelopeText).pipe(Effect.mapError(() => fail("decrypt")))
        const nonce = Buffer.from(envelope.nonce, "base64url")
        const ciphertext = Buffer.from(envelope.ciphertext, "base64url")
        const tag = Buffer.from(envelope.tag, "base64url")
        if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > 2048) return yield* fail("decrypt")
        const plaintext = yield* Effect.try({
          try: () => {
            const decipher = createDecipheriv("aes-256-gcm", keyBytes, nonce, { authTagLength: 16 })
            decipher.setAAD(aad)
            decipher.setAuthTag(tag)
            const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()])
            if (bytes.length > 2048) throw new Error("plaintext is too large")
            return bytes.toString("utf8")
          },
          catch: () => fail("decrypt"),
        })
        return yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(PayloadJson),
          strict,
        )(plaintext).pipe(Effect.mapError(() => fail("decrypt")))
      })

      return Service.of({ encrypt, decrypt })
    }),
  )

/** Cookie encryption configured by WEB_COOKIE_KEY. */
const configuredLayer = Layer.unwrap(
  Config.redacted("WEB_COOKIE_KEY").pipe(
    Effect.flatMap((key) => Schema.decodeUnknownEffect(Key)(key)),
    Effect.map(layerWith),
    Effect.mapError(() => new ConfigError({})),
  ),
)

/** Production cookie encryption backed by Node crypto. */
export const productionLayer = configuredLayer.pipe(Layer.provide(NodeCrypto.layer))
export const defaultLayer = productionLayer

/** Configured production cookie implementation for hosts which use WEB_COOKIE_KEY. */
export const configured = makeGlobalNode({ service: Service, layer: productionLayer.pipe(Layer.orDie), deps: [] })
/** @deprecated Use configured. */
export const productionNode = configured

/** Host-selected process-global cookie authority. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)

/** HTTP cookie policy selected by the application entrypoint. */
export interface Policy {
  readonly accountName: string
  readonly attemptName: string
  readonly secure: boolean
  /**
   * Reference absolute lifetime for the Login Session cookie and payload. The
   * authoritative bound is the host's SESSION_ABSOLUTE_TIMEOUT (default 12 h);
   * this constant documents and preserves that default.
   */
  readonly sessionLifetime: Duration.Input
}
/** Login attempt cookie and payload lifetime. */
export const attemptLifetime = "10 minutes" as const
/** Login Session cookie and payload lifetime (Max-Age=43200). */
export const sessionLifetime = "12 hours" as const

export const secure = {
  accountName: "__Host-bm_auth",
  attemptName: "__Secure-bm_auth_attempt_v1",
  secure: true,
  sessionLifetime,
} satisfies Policy
export const local = {
  accountName: "bm_local_auth",
  attemptName: "bm_local_attempt",
  secure: false,
  sessionLifetime,
} satisfies Policy
export const layer = (value: Redacted.Redacted<string>) =>
  Layer.unwrap(Schema.decodeUnknownEffect(Key)(value).pipe(Effect.map(layerWith))).pipe(Layer.provide(NodeCrypto.layer))
export const makeNode = (key: Redacted.Redacted<string>) =>
  makeGlobalNode({ service: Service, layer: layer(key).pipe(Layer.orDie), deps: [] })
