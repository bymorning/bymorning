/**
 * Azure Key Vault Cipher backend: envelope data keys are 32 random bytes
 * generated locally per Cipher rotation window and wrapped with the vault key
 * using RSA-OAEP-256 (`wrapKey`/`unwrapKey`). The envelope keyID is the
 * versioned key URL that wrapped the data key; unwrap parses it, refuses any
 * URL from another vault or key name, and selects the CryptographyClient for
 * that version (one cached client per version the vault has served, bounded),
 * so data written before a key rotation keeps decrypting after the backend
 * starts at the new version.
 * New data keys are the bare RSA ciphertext. Data written by earlier releases
 * carried a private frame naming the version; those still unwrap when the
 * frame's version agrees with the keyID, and bare legacy ciphertext unwraps
 * with the version in the keyID.
 * An unversioned URL resolves once at construction, within 60 seconds. Every failure —
 * construction, resolution, wrap, unwrap, a refused keyID, a disabled or
 * unknown version — fails closed with Cipher.UnavailableError; no key material
 * or secret bytes appear in errors. The refusal reason is logged, never
 * returned, with the envelope's key version (or "malformed") as the only
 * echo of a database value.
 */
import { CryptographyClient, KeyClient, parseKeyVaultKeyIdentifier } from "@azure/keyvault-keys"
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity"
import { Duration, Effect } from "effect"
import { randomBytes } from "node:crypto"
import { Cipher } from "@bymorning/core/cipher"

/** RSA-OAEP with SHA-256: the Key Vault wrap algorithm every RSA and RSA-HSM vault key supports. */
const algorithm = "RSA-OAEP-256" as const

/**
 * Bound on startup key resolution, token exchange included. The Azure SDK sets
 * no request deadline, so a vault or token endpoint that accepts a connection
 * and never answers would otherwise hold startup indefinitely.
 */
const resolveTimeout = Duration.seconds(60)

// Legacy private wire format (read only; no longer written): format byte (1),
// version length (u8), wrapped length (u16 big-endian), ASCII version, RSA
// ciphertext. Azure key versions are 32 hexadecimal characters; RSA-2048/3072/
// 4096 wraps are 256/384/512 bytes.
const versionPattern = /^[0-9a-f]{32}$/
const wrappedLength = (length: number) => length === 256 || length === 384 || length === 512
const parse = (data: Uint8Array) => {
  const bytes = Buffer.from(data)
  if (bytes.length < 4 || bytes[0] !== 1 || bytes[1] !== 32) throw new Error("Invalid data key")
  const length = bytes.readUInt16BE(2)
  if (!wrappedLength(length) || bytes.length !== 36 + length) throw new Error("Invalid data key")
  // UTF-8 decoding preserves invalid/high-bit bytes as non-hex, unlike ASCII's
  // high-bit masking. No URL or path segment can be supplied by the frame.
  const version = bytes.subarray(4, 36).toString("utf8")
  if (!versionPattern.test(version)) throw new Error("Invalid data key")
  return { version, wrapped: bytes.subarray(36) }
}

/** Why one unwrap was refused before the vault was consulted; logged, never returned. */
type Refusal = "invalid-key-id" | "foreign-key" | "invalid-version" | "frame-mismatch" | "invalid-data-key"

/** Azure Key Vault Cipher backend over one RSA or RSA-HSM key. */
export const keyvault = (options: {
  /** Key URL: `https://<vault>.vault.azure.net/keys/<name>[/<version>]`. */
  readonly key: string
  /** Token credential; defaults to DefaultAzureCredential. */
  readonly credential?: TokenCredential
  /** Caller-owned crypto client for the startup version (tests). */
  readonly client?: CryptographyClient
  /** Caller-owned keys client (tests), consulted only to resolve an unversioned key URL. */
  readonly keys?: KeyClient
}): Effect.Effect<Cipher.Backend, Cipher.UnavailableError> =>
  Effect.gen(function* () {
    const identifier = yield* Effect.try({
      try: () => parseKeyVaultKeyIdentifier(options.key),
      catch: () => new Cipher.UnavailableError({}),
    })
    const credential = yield* Effect.try({
      try: () => options.credential ?? new DefaultAzureCredential(),
      catch: () => new Cipher.UnavailableError({}),
    })
    const resolvedID = yield* identifier.version !== undefined
      ? Effect.succeed(identifier.sourceId)
      : Effect.tryPromise({
          try: async (signal) => {
            const keys = options.keys ?? new KeyClient(identifier.vaultUrl, credential)
            const key = await keys.getKey(identifier.name, { abortSignal: signal })
            if (key.id === undefined || parseKeyVaultKeyIdentifier(key.id).version === undefined) {
              throw new Error("Key Vault returned an unversioned key identifier")
            }
            return key.id
          },
          catch: () => new Cipher.UnavailableError({}),
        }).pipe(
          Effect.timeoutOrElse({
            duration: resolveTimeout,
            orElse: () =>
              Effect.logWarning("Key Vault did not resolve the key within 60 seconds").pipe(
                Effect.andThen(new Cipher.UnavailableError({})),
              ),
          }),
          Effect.withSpan("Cipher.keyvault.resolve"),
        )
    /**
     * The version named by one versioned URL of this vault key, or the refusal
     * reason when the URL is malformed, names another vault or key, or carries
     * no well-formed version.
     */
    const ownVersion = (url: string): { readonly version: string } | { readonly refusal: Refusal } => {
      let parsed: ReturnType<typeof parseKeyVaultKeyIdentifier>
      try {
        parsed = parseKeyVaultKeyIdentifier(url)
      } catch {
        return { refusal: "invalid-key-id" }
      }
      if (parsed.vaultUrl !== identifier.vaultUrl || parsed.name !== identifier.name) return { refusal: "foreign-key" }
      if (parsed.version === undefined || !versionPattern.test(parsed.version)) return { refusal: "invalid-version" }
      return { version: parsed.version }
    }
    const resolved = ownVersion(resolvedID)
    if ("refusal" in resolved) return yield* new Cipher.UnavailableError({})
    const version = resolved.version
    const keyURL = (version: string) => `${identifier.vaultUrl}/keys/${identifier.name}/${version}`
    const keyID = keyURL(version)
    /**
     * One client per version that has unwrapped successfully, so a version
     * named only by envelopes never occupies the cache until the vault has
     * served it. The startup version is never evicted; the bound is defense in
     * depth against an envelope flood naming many well-formed versions.
     */
    const limit = 16
    const clients = new Map<string, CryptographyClient>()
    const remember = (selected: string, client: CryptographyClient) => {
      if (clients.has(selected)) return
      if (clients.size >= limit) {
        const oldest = [...clients.keys()].find((key) => key !== version)
        if (oldest !== undefined) clients.delete(oldest)
      }
      clients.set(selected, client)
    }
    const clientFor = (selected: string) =>
      clients.get(selected) ?? new CryptographyClient(keyURL(selected), credential)
    const client = yield* Effect.try({
      try: () => options.client ?? clientFor(version),
      catch: () => new Cipher.UnavailableError({}),
    })
    remember(version, client)

    /** What the log may say about an envelope key identity: its well-formed version, or that it is malformed. */
    const describe = (envelopeKeyID: string) => {
      try {
        const parsed = parseKeyVaultKeyIdentifier(envelopeKeyID).version
        return parsed !== undefined && versionPattern.test(parsed) ? parsed : "malformed"
      } catch {
        return "malformed"
      }
    }
    const refuse = (refusal: Refusal, envelopeKeyID: string) =>
      Effect.logWarning("Cipher refused a Key Vault data key", {
        reason: refusal,
        version: describe(envelopeKeyID),
      }).pipe(Effect.andThen(new Cipher.UnavailableError({})))

    /**
     * Select the version and RSA ciphertext for one stored data key. Bare
     * ciphertext (256/384/512 bytes) uses the keyID's version; a legacy frame
     * (36 bytes longer, so the forms cannot be confused) must name that same
     * version. Nothing from the envelope reaches the vault except the ciphertext.
     */
    const select = (
      dataKey: Uint8Array,
      version: string,
    ): { readonly wrapped: Uint8Array } | { readonly refusal: Refusal } => {
      if (wrappedLength(dataKey.length)) return { wrapped: dataKey }
      let framed: ReturnType<typeof parse>
      try {
        framed = parse(dataKey)
      } catch {
        return { refusal: "invalid-data-key" }
      }
      if (framed.version !== version) return { refusal: "frame-mismatch" }
      return { wrapped: framed.wrapped }
    }

    return {
      keyID,
      generate: Effect.tryPromise({
        try: async () => {
          const key = randomBytes(32)
          const wrapped = await client.wrapKey(algorithm, key)
          if (!wrappedLength(wrapped.result.length)) throw new Error("Invalid data key")
          return { key, dataKey: wrapped.result }
        },
        catch: () => new Cipher.UnavailableError({}),
      }).pipe(Effect.withSpan("Cipher.keyvault.generate", { attributes: { key: keyID } })),
      unwrap: Effect.fn("Cipher.keyvault.unwrap", { attributes: { key: keyID } })(function* (
        dataKey: Uint8Array,
        envelopeKeyID: string,
      ) {
        const own = ownVersion(envelopeKeyID)
        if ("refusal" in own) return yield* refuse(own.refusal, envelopeKeyID)
        const stored = select(dataKey, own.version)
        if ("refusal" in stored) return yield* refuse(stored.refusal, envelopeKeyID)
        // A disabled, expired, or unknown version fails here inside the vault call.
        return yield* Effect.tryPromise({
          try: async () => {
            const selected = clientFor(own.version)
            const result = (await selected.unwrapKey(algorithm, stored.wrapped)).result
            if (result.length !== 32) throw new Error("Invalid data key")
            remember(own.version, selected)
            return result
          },
          catch: () => new Cipher.UnavailableError({}),
        }).pipe(
          Effect.tapError(() =>
            Effect.logWarning("Cipher could not unwrap a Key Vault data key", {
              reason: "unwrap-failed",
              version: own.version,
            }),
          ),
        )
      }),
    } satisfies Cipher.Backend
  })
