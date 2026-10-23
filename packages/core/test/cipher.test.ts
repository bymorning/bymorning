import { CipherContract } from "@bymorning/testing/contract/cipher"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer, Logger, Redacted } from "effect"
import { randomBytes } from "node:crypto"
import { describe, expect } from "vitest"
import { Cipher } from "../src/cipher.js"

// Every evaluation derives a fresh 32-byte master key, as the contract requires.
CipherContract.run(
  "local",
  Effect.suspend(() => Cipher.localBackend(Redacted.make(randomBytes(32).toString("base64url")))),
)

describe("Cipher local backend", () => {
  const layer = Cipher.local(Redacted.make(Buffer.alloc(32, 1).toString("base64url"))).pipe(
    Layer.provide(NodeCrypto.layer),
    Layer.orDie,
  )

  it.effect("accepts legacy plaintext during the migration window", () =>
    Effect.gen(function* () {
      const cipher = yield* Cipher.Service
      // A legacy row never produced an envelope; decrypt returns it unchanged.
      expect(Redacted.value(yield* cipher.decrypt("legacy-plaintext-value"))).toBe("legacy-plaintext-value")
      // A dotted plaintext prefix is not an envelope either.
      expect(Redacted.value(yield* cipher.decrypt("v1.not-an-envelope"))).toBe("v1.not-an-envelope")
    }).pipe(Effect.provide(layer)),
  )

  it.effect("logs a refused foreign key identity by fixed reason only, never the envelope's value", () =>
    Effect.gen(function* () {
      const entries: unknown[] = []
      const logger = Logger.make(({ message }) => entries.push(message))
      const backend = yield* Cipher.localBackend(Redacted.make(Buffer.alloc(32, 1).toString("base64url")))
      const { dataKey } = yield* backend.generate
      const foreign = "arn:aws:kms:us-east-1:123456789012:key/private-marker"
      const failure = yield* backend
        .unwrap(dataKey, foreign)
        .pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })), Effect.flip)
      expect(failure).toBeInstanceOf(Cipher.UnavailableError)
      expect(entries).toEqual([["Cipher refused a data key wrapped by another backend", { reason: "foreign-key" }]])
      expect(JSON.stringify(entries)).not.toContain("private-marker")
    }).pipe(Effect.provide(NodeCrypto.layer)),
  )

  it.effect("rejects a master key that is not 32 bytes", () =>
    Effect.gen(function* () {
      for (const key of [
        "",
        "short",
        Buffer.alloc(31, 1).toString("base64url"),
        Buffer.alloc(33, 1).toString("base64url"),
      ]) {
        const failure = yield* Cipher.localBackend(Redacted.make(key)).pipe(Effect.flip)
        expect(failure).toBeInstanceOf(Cipher.UnavailableError)
      }
    }).pipe(Effect.provide(NodeCrypto.layer)),
  )
})
