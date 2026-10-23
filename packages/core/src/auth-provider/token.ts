export * as AuthProviderToken from "./token.js"

import { Crypto, Effect, Encoding, Redacted } from "effect"
import { createHash, timingSafeEqual } from "node:crypto"

/** Create a 32-byte base64url setup token. */
export const create = Effect.fn("AuthProvider.token.create")(function* () {
  const crypto = yield* Crypto.Crypto
  const bytes = yield* crypto.randomBytes(32).pipe(Effect.orDie)
  return Encoding.encodeBase64Url(bytes)
})

/**
 * Stored form of a setup token: a sha256 digest, never the token itself. The
 * token value lives only in the operator's configuration or the host's
 * owner-read-only setup-token file while Setup is pending.
 */
export const digest = (token: string) => `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`

export const isDigest = (stored: string) => stored.startsWith("sha256:")

/** Compare a presented token to the stored value without leaking length through control flow on match. */
export const matches = (stored: string, presented: Redacted.Redacted<string>) => {
  const right = isDigest(stored) ? digest(Redacted.value(presented)) : Redacted.value(presented)
  const left = Buffer.from(stored)
  const candidate = Buffer.from(right)
  if (left.length !== candidate.length) return false
  return timingSafeEqual(left, candidate)
}
