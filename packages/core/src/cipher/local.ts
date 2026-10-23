export * as LocalCipher from "./local.js"

/**
 * Local Cipher backend: a 32-byte master key wrapping per-write data keys with
 * AES-256-GCM, mirroring the KMS envelope shape. Used by the local host (key
 * file beside the cookie key) and by tests. Its only key identity is `local`;
 * an envelope naming any other key is refused before the master key is used.
 */
import { Crypto, Effect, Redacted } from "effect"
import { createCipheriv, createDecipheriv } from "node:crypto"
import { UnavailableError, type Backend } from "../cipher.js"

const unwrapAad = Buffer.from("bymorning/cipher/local/v1", "utf8")
const keyID = "local"

export const backend = (key: Redacted.Redacted<string>): Effect.Effect<Backend, UnavailableError, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const master = yield* Effect.try({
      try: () => {
        const bytes = Buffer.from(Redacted.value(key), "base64url")
        if (bytes.length !== 32) throw new Error("invalid key length")
        return bytes
      },
      catch: () => new UnavailableError({}),
    })

    const wrap = (nonce: Uint8Array, dataKey: Uint8Array) => {
      const cipher = createCipheriv("aes-256-gcm", master, nonce, { authTagLength: 16 })
      cipher.setAAD(unwrapAad)
      return Buffer.concat([cipher.update(dataKey), cipher.final(), cipher.getAuthTag()])
    }

    return {
      keyID,
      generate: Effect.map(
        Effect.all({ key: crypto.randomBytes(32), nonce: crypto.randomBytes(12) }).pipe(
          Effect.mapError(() => new UnavailableError({})),
        ),
        ({ key, nonce }) => ({
          key,
          dataKey: Buffer.concat([nonce, wrap(nonce, key)]),
        }),
      ),
      // The envelope's identity is a database value; the log carries only the fixed reason.
      unwrap: (dataKey, envelopeKeyID) =>
        envelopeKeyID !== keyID
          ? Effect.logWarning("Cipher refused a data key wrapped by another backend", {
              reason: "foreign-key",
            }).pipe(Effect.andThen(new UnavailableError({})))
          : Effect.try({
              try: () => {
                const nonce = dataKey.subarray(0, 12)
                const wrapped = dataKey.subarray(12)
                const decipher = createDecipheriv("aes-256-gcm", master, nonce, { authTagLength: 16 })
                decipher.setAAD(unwrapAad)
                decipher.setAuthTag(wrapped.subarray(wrapped.length - 16))
                return Buffer.concat([decipher.update(wrapped.subarray(0, wrapped.length - 16)), decipher.final()])
              },
              catch: () => new UnavailableError({}),
            }),
    } satisfies Backend
  })
