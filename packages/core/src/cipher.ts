/**
 * Credential-at-rest envelope encryption. Core-internal authority shared by the
 * Credential and Auth Provider stores so key format, caching, and rotation live
 * in exactly one place; not part of the SDK or protocol surface.
 *
 * Envelopes are `v1.<keyID>.<encryptedDataKey>.<nonce>.<ciphertext>` (AES-256-GCM
 * under per-write data keys). The host supplies the backend value — AWS KMS
 * data-key supply lives in `@bymorning/backend-aws`, Azure Key Vault in
 * `@bymorning/backend-azure`; `localBackend` wraps a local master key. The
 * envelope's keyID travels with every unwrap so a backend refuses data keys it
 * does not own and selects the key version that wrapped them. `decrypt` also
 * accepts legacy plaintext rows for the migration window; writes always encrypt.
 */
export * as Cipher from "./cipher.js"

import { makeGlobalNode, tags } from "@bymorning/util/effect/app-node"
import { LayerNodePlatform } from "@bymorning/util/effect/app-node-platform"
import { Clock, Context, Crypto, Effect, Layer, Redacted, Schema, Semaphore } from "effect"
import { createCipheriv, createDecipheriv } from "node:crypto"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import type { Database } from "./database.js"
import { decode, encode, isEnvelope } from "./cipher/envelope.js"
import { LocalCipher } from "./cipher/local.js"
import { migrateWith } from "./cipher/migrate.js"

/** The Cipher backend cannot encrypt or decrypt (wrong, unreadable, or unreachable key material). */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Cipher.UnavailableError", {}) {}

/** Envelope encryption authority for persisted secret columns. */
export interface Interface {
  readonly encrypt: (plaintext: Redacted.Redacted<string>) => Effect.Effect<string, UnavailableError>
  /** Accepts current envelopes and legacy plaintext (migration window). */
  readonly decrypt: (envelope: string) => Effect.Effect<Redacted.Redacted<string>, UnavailableError>
}

/** Envelope encryption authority for persisted secret columns. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Cipher") {}

/**
 * Data-key supply owned by one backend. `dataKey` is the wrapped form stored in
 * the envelope; `keyID` is the envelope's key identity, which the backend must
 * recognize as its own (refusing with UnavailableError otherwise) and may use
 * to select the key version that wrapped `dataKey`.
 */
export interface Backend {
  readonly keyID: string
  readonly generate: Effect.Effect<{ readonly key: Uint8Array; readonly dataKey: Uint8Array }, UnavailableError>
  readonly unwrap: (dataKey: Uint8Array, keyID: string) => Effect.Effect<Uint8Array, UnavailableError>
}

/** AES-256-GCM associated data binding every envelope to this authority and format. */
const aad = Buffer.from("bymorning/cipher/v1", "utf8")
/** Data keys are reused briefly so hot paths do not call the backend per value. */
const keyTTL = 5 * 60 * 1000
const unwrapCacheLimit = 1024

interface LiveKey {
  readonly key: Uint8Array
  readonly dataKey: Uint8Array
  readonly expires: number
}

const seal = (key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array => {
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 })
  cipher.setAAD(aad)
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
}

const open = (key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array => {
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 })
  decipher.setAAD(aad)
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
  return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()])
}

const unavailable = () => new UnavailableError({})

/** Build the service over one backend with a short-TTL data-key cache. */
export const make = (backend: Backend): Effect.Effect<Interface, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const lock = yield* Semaphore.make(1)
    let current: LiveKey | undefined
    const unwrapped = new Map<string, LiveKey>()

    const encryptKey = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (current !== undefined && current.expires > now) return current
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const checked = yield* Clock.currentTimeMillis
          if (current !== undefined && current.expires > checked) return current
          const next = yield* backend.generate
          if (current !== undefined) current.key.fill(0)
          current = { key: next.key, dataKey: next.dataKey, expires: checked + keyTTL }
          return current
        }),
      )
    })

    const decryptKey = Effect.fnUntraced(function* (dataKey: Uint8Array, keyID: string) {
      // Cached under the key identity too: a backend refusal never writes here,
      // and an identical data key under another keyID is a separate entry.
      const cacheID = `${keyID}.${Buffer.from(dataKey).toString("base64url")}`
      const now = yield* Clock.currentTimeMillis
      const hit = unwrapped.get(cacheID)
      if (hit !== undefined && hit.expires > now) return hit
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const checked = yield* Clock.currentTimeMillis
          const cached = unwrapped.get(cacheID)
          if (cached !== undefined && cached.expires > checked) return cached
          const key = yield* backend.unwrap(dataKey, keyID)
          if (cached !== undefined) cached.key.fill(0)
          if (unwrapped.size >= unwrapCacheLimit) {
            const oldest = unwrapped.keys().next().value
            if (oldest !== undefined) {
              unwrapped.get(oldest)?.key.fill(0)
              unwrapped.delete(oldest)
            }
          }
          const live = { key, dataKey, expires: checked + keyTTL } satisfies LiveKey
          unwrapped.set(cacheID, live)
          return live
        }),
      )
    })

    const encrypt = Effect.fn("Cipher.encrypt")(function* (plaintext: Redacted.Redacted<string>) {
      const live = yield* encryptKey
      const nonce = yield* crypto.randomBytes(12).pipe(Effect.mapError(unavailable))
      const ciphertext = yield* Effect.try({
        try: () => seal(live.key, nonce, Buffer.from(Redacted.value(plaintext), "utf8")),
        catch: unavailable,
      })
      return encode({ keyID: backend.keyID, dataKey: live.dataKey, nonce, ciphertext })
    })

    const decrypt = Effect.fn("Cipher.decrypt")(function* (value: string) {
      const envelope = decode(value)
      // Legacy plaintext predates encryption at rest; return it unchanged so the
      // migration window keeps reading until the boot migrator re-encrypts.
      if (envelope === undefined) return Redacted.make(value)
      const live = yield* decryptKey(envelope.dataKey, envelope.keyID)
      const plaintext = yield* Effect.try({
        try: () => Buffer.from(open(live.key, envelope.nonce, envelope.ciphertext)).toString("utf8"),
        catch: unavailable,
      })
      return Redacted.make(plaintext)
    })

    return Service.of({ encrypt, decrypt })
  })

/** Local master-key backend (32 base64url bytes), used by the local host and tests. */
export const local = (key: Redacted.Redacted<string>): Layer.Layer<Service, UnavailableError, Crypto.Crypto> =>
  Layer.effect(Service, Effect.flatMap(localBackend(key), make))

/** Local master-key data-key supply (32 base64url bytes), used by the local host and tests. */
export const localBackend = LocalCipher.backend

/** Build the Cipher layer over one host-supplied backend. */
export const layer = (backend: Backend): Layer.Layer<Service, UnavailableError, Crypto.Crypto> =>
  Layer.effect(Service, make(backend))

/** Host-selected process-global Cipher. */
export const node = LayerNode.unbound<Service, Interface, typeof tags.values.global, unknown>(
  Service,
  tags.values.global,
)

/** Bind a host's Cipher backend. */
export const configured = (backend: Backend) =>
  makeGlobalNode({ service: Service, layer: layer(backend).pipe(Layer.orDie), deps: [LayerNodePlatform.crypto] })

/**
 * Re-encrypt every legacy plaintext secret column under an advisory lock:
 * `credential.value`/`credential.value_json` and `auth_provider.client_secret`.
 * Runs at boot; safe to re-run because envelopes are recognized and skipped.
 */
export const migrate = Effect.flatMap(Service, migrateWith)

/** Re-exported for the boot migrator's row classification. */
export { isEnvelope }
