/**
 * Versioned envelope wire format for Cipher ciphertexts.
 *
 * `v1.<base64url(keyID)>.<base64url(encryptedDataKey)>.<base64url(nonce)>.<base64url(ciphertext+tag)>`
 *
 * The encrypted-data-key segment is backend-opaque (a KMS CiphertextBlob, or a
 * locally wrapped data key). A value that does not parse is legacy plaintext
 * from before encryption-at-rest, never a corrupt envelope.
 */

const version = "v1"
const pattern = /^[A-Za-z0-9_-]+$/

export interface Envelope {
  readonly keyID: string
  readonly dataKey: Uint8Array
  readonly nonce: Uint8Array
  readonly ciphertext: Uint8Array
}

export const encode = (envelope: Envelope): string =>
  [
    version,
    Buffer.from(envelope.keyID, "utf8").toString("base64url"),
    Buffer.from(envelope.dataKey).toString("base64url"),
    Buffer.from(envelope.nonce).toString("base64url"),
    Buffer.from(envelope.ciphertext).toString("base64url"),
  ].join(".")

/** Parse one stored value; returns undefined for legacy plaintext. */
export const decode = (value: string): Envelope | undefined => {
  if (!value.startsWith(`${version}.`)) return undefined
  const parts = value.split(".")
  if (parts.length !== 5) return undefined
  const [marker, keyID, dataKey, nonce, ciphertext] = parts as [string, string, string, string, string]
  if (marker !== version) return undefined
  if (!pattern.test(keyID) || !pattern.test(dataKey) || !pattern.test(nonce) || !pattern.test(ciphertext))
    return undefined
  const decodedKeyID = Buffer.from(keyID, "base64url").toString("utf8")
  const decodedDataKey = Buffer.from(dataKey, "base64url")
  const decodedNonce = Buffer.from(nonce, "base64url")
  const decodedCiphertext = Buffer.from(ciphertext, "base64url")
  if (decodedKeyID.length === 0 || decodedDataKey.length === 0 || decodedCiphertext.length <= 16) return undefined
  // AES-256-GCM nonces are 12 bytes; reject anything else before touching a backend.
  if (decodedNonce.length !== 12) return undefined
  return { keyID: decodedKeyID, dataKey: decodedDataKey, nonce: decodedNonce, ciphertext: decodedCiphertext }
}

export const isEnvelope = (value: string): boolean => decode(value) !== undefined
