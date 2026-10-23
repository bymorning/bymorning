/**
 * The Cipher.Backend contract as one parameterised suite: data-key supply,
 * unwrap fidelity, fail-closed refusal of foreign or damaged data keys, key
 * identity (a backend unwraps only envelopes naming its own key), and the
 * Cipher.make round trip over the backend. Every backend (local, KMS, Key
 * Vault) runs the same cases; each `make` evaluation must produce a backend
 * bound to a fresh key so cross-backend refusal is observable.
 */
export * as CipherContract from "./cipher.js"

import { Cipher } from "@bymorning/core/cipher"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Crypto, Effect, Redacted } from "effect"
import { randomBytes } from "node:crypto"
import { describe, expect } from "vitest"

/** Construct one backend over a fresh key; every evaluation yields an independent key. */
export type Make = Effect.Effect<Cipher.Backend, unknown, Crypto.Crypto>

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")
const equal = (left: Uint8Array, right: Uint8Array) => Buffer.from(left).equals(Buffer.from(right))
const flipLast = (bytes: Uint8Array) => {
  const copy = Uint8Array.from(bytes)
  copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) ^ 0xff
  return copy
}
/** Replace the envelope's keyID segment (index 1) with another identity. */
const rekey = (envelope: string, keyID: string) => {
  const parts = envelope.split(".")
  parts[1] = Buffer.from(keyID, "utf8").toString("base64url")
  return parts.join(".")
}

/** Register the Cipher.Backend contract cases for one implementation. */
export const run = (name: string, make: Make): void => {
  const provided = <A, E>(effect: Effect.Effect<A, E, Crypto.Crypto>) => Effect.provide(effect, NodeCrypto.layer)

  describe(`Cipher.Backend contract: ${name}`, () => {
    it.effect("generates a 32-byte data key whose wrapped form is opaque and unique per call", () =>
      provided(
        Effect.gen(function* () {
          const backend = yield* make
          const first = yield* backend.generate
          const second = yield* backend.generate
          expect(first.key).toHaveLength(32)
          expect(second.key).toHaveLength(32)
          expect(first.dataKey.length).toBeGreaterThan(0)
          expect(equal(first.key, second.key)).toBe(false)
          expect(equal(first.dataKey, second.dataKey)).toBe(false)
          // The wrapped form never carries the plaintext key.
          expect(Buffer.from(first.dataKey).includes(Buffer.from(first.key))).toBe(false)
          expect(Buffer.from(second.dataKey).includes(Buffer.from(second.key))).toBe(false)
        }),
      ),
    )

    it.effect("unwraps its own data keys back to the generated key", () =>
      provided(
        Effect.gen(function* () {
          const backend = yield* make
          const { key, dataKey } = yield* backend.generate
          expect(equal(yield* backend.unwrap(dataKey, backend.keyID), key)).toBe(true)
          expect(equal(yield* backend.unwrap(Uint8Array.from(dataKey), backend.keyID), key)).toBe(true)
        }),
      ),
    )

    it.effect("fails closed with UnavailableError for tampered, garbage, empty, or foreign data keys", () =>
      provided(
        Effect.gen(function* () {
          const backend = yield* make
          const { key, dataKey } = yield* backend.generate
          const foreign = yield* (yield* make).generate
          for (const damaged of [
            flipLast(dataKey),
            dataKey.subarray(0, dataKey.length - 1),
            randomBytes(dataKey.length),
            randomBytes(7),
            new Uint8Array(),
            foreign.dataKey,
          ]) {
            const failure = yield* backend.unwrap(damaged, backend.keyID).pipe(Effect.flip)
            expect(failure).toBeInstanceOf(Cipher.UnavailableError)
            expect(JSON.stringify(failure)).not.toContain(base64(key))
          }
          // The backend still serves its own key after refusing others.
          expect(equal(yield* backend.unwrap(dataKey, backend.keyID), key)).toBe(true)
        }),
      ),
    )

    it.effect("[SEC-CRYPT-11] refuses its own data key under a key identity it does not own", () =>
      provided(
        Effect.gen(function* () {
          const backend = yield* make
          const { key, dataKey } = yield* backend.generate
          expect(backend.keyID.length).toBeGreaterThan(0)
          for (const keyID of [
            "",
            "local",
            "other",
            `${backend.keyID}x`,
            backend.keyID.slice(0, -1),
            backend.keyID.toUpperCase(),
            "arn:aws:kms:us-east-1:000000000000:key/00000000-0000-0000-0000-000000000000",
            "https://other.vault.azure.net/keys/credential/00000000000000000000000000000000",
            "https://bymorning.vault.azure.net/keys/other/00000000000000000000000000000000",
          ].filter((candidate) => candidate !== backend.keyID)) {
            const failure = yield* backend.unwrap(dataKey, keyID).pipe(Effect.flip)
            expect(failure, keyID).toBeInstanceOf(Cipher.UnavailableError)
            expect(JSON.stringify(failure)).not.toContain(base64(key))
          }
          // The backend still serves the same data key under its own identity.
          expect(equal(yield* backend.unwrap(dataKey, backend.keyID), key)).toBe(true)
        }),
      ),
    )

    it.effect("[SEC-CRYPT-01] encrypts through Cipher.make to a versioned envelope and decrypts it back", () =>
      provided(
        Effect.gen(function* () {
          const cipher = yield* Cipher.make(yield* make)
          const envelope = yield* cipher.encrypt(Redacted.make("sk-secret-credential"))
          expect(envelope.startsWith("v1.")).toBe(true)
          expect(envelope.split(".")).toHaveLength(5)
          expect(envelope).not.toContain("sk-secret-credential")
          expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("sk-secret-credential")
          // A second decrypt of the same envelope reuses the unwrapped data key.
          expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("sk-secret-credential")
          const again = yield* cipher.encrypt(Redacted.make("sk-secret-credential"))
          expect(again).not.toBe(envelope)
          expect(Redacted.value(yield* cipher.decrypt(again))).toBe("sk-secret-credential")
        }),
      ),
    )

    it.effect("[SEC-CRYPT-02] fails closed under a different backend key and never serves plaintext", () =>
      provided(
        Effect.gen(function* () {
          const writer = yield* Cipher.make(yield* make)
          const reader = yield* Cipher.make(yield* make)
          const envelope = yield* writer.encrypt(Redacted.make("sk-secret-credential"))
          const failure = yield* reader.decrypt(envelope).pipe(Effect.flip)
          expect(failure).toBeInstanceOf(Cipher.UnavailableError)
          expect(JSON.stringify(failure)).not.toContain("sk-secret-credential")
          // Under the right key, damaged ciphertext still fails closed.
          const parts = envelope.split(".")
          const ciphertext = Buffer.from(parts[4] ?? "", "base64url")
          parts[4] = Buffer.from(flipLast(ciphertext)).toString("base64url")
          const tampered = yield* writer.decrypt(parts.join(".")).pipe(Effect.flip)
          expect(tampered).toBeInstanceOf(Cipher.UnavailableError)
          expect(Redacted.value(yield* writer.decrypt(envelope))).toBe("sk-secret-credential")
        }),
      ),
    )

    it.effect("[SEC-CRYPT-12] refuses an envelope produced by another backend instance, at the backend seam too", () =>
      provided(
        Effect.gen(function* () {
          const own = yield* make
          const other = yield* make
          const reader = yield* Cipher.make(own)
          const writer = yield* Cipher.make(other)
          const envelope = yield* writer.encrypt(Redacted.make("sk-secret-credential"))
          const failure = yield* reader.decrypt(envelope).pipe(Effect.flip)
          expect(failure).toBeInstanceOf(Cipher.UnavailableError)
          expect(JSON.stringify(failure)).not.toContain("sk-secret-credential")
          // The other instance's wrapped data key is refused directly under either identity.
          const dataKey = Buffer.from(envelope.split(".")[2] ?? "", "base64url")
          expect(yield* own.unwrap(dataKey, other.keyID).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
          expect(yield* own.unwrap(dataKey, own.keyID).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
          // The writer still reads its own envelope.
          expect(Redacted.value(yield* writer.decrypt(envelope))).toBe("sk-secret-credential")
        }),
      ),
    )

    it.effect("[SEC-CRYPT-13] refuses an envelope whose keyID segment was replaced and never caches it", () =>
      provided(
        Effect.gen(function* () {
          const backend = yield* make
          const cipher = yield* Cipher.make(backend)
          const envelope = yield* cipher.encrypt(Redacted.make("sk-secret-credential"))
          for (const keyID of [
            "other",
            `${backend.keyID}x`,
            "arn:aws:kms:us-east-1:000000000000:key/00000000-0000-0000-0000-000000000000",
            "https://other.vault.azure.net/keys/credential/00000000000000000000000000000000",
          ]) {
            const tampered = rekey(envelope, keyID)
            expect(tampered).not.toBe(envelope)
            const failure = yield* cipher.decrypt(tampered).pipe(Effect.flip)
            expect(failure, keyID).toBeInstanceOf(Cipher.UnavailableError)
            expect(JSON.stringify(failure)).not.toContain("sk-secret-credential")
          }
          // Restoring the identity reads the value; a refusal before the cache never primed it.
          expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("sk-secret-credential")
          // A primed cache does not make a rekeyed copy of the same data key readable either.
          expect(yield* cipher.decrypt(rekey(envelope, "other")).pipe(Effect.flip)).toBeInstanceOf(
            Cipher.UnavailableError,
          )
        }),
      ),
    )
  })
}
