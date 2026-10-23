import { CipherContract } from "@bymorning/testing/contract/cipher"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer, Logger, Redacted } from "effect"
import { randomBytes } from "node:crypto"
import { describe, expect } from "vitest"
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from "@aws-sdk/client-kms"
import { Cipher } from "@bymorning/core/cipher"
import { kms } from "../src/kms.js"

const arn = "arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/credential"

/** Recording KMS stub: issues opaque ciphertext blobs and round-trips only the data keys it issued. */
const mockKMS = () => {
  const calls: Array<{ readonly name: string; readonly input: Record<string, unknown> }> = []
  const issued = new Map<string, Uint8Array>()
  const client = {
    send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      calls.push({ name: command.constructor.name, input: command.input })
      if (command instanceof GenerateDataKeyCommand) {
        const key = randomBytes(32)
        const blob = Buffer.concat([Buffer.from("mock-edk:"), randomBytes(32)])
        issued.set(blob.toString("base64url"), key)
        return Promise.resolve({ Plaintext: key, CiphertextBlob: blob })
      }
      if (command instanceof DecryptCommand) {
        const blob = Buffer.from(command.input.CiphertextBlob as Uint8Array)
        const key = issued.get(blob.toString("base64url"))
        return key === undefined
          ? Promise.reject(new Error("InvalidCiphertextException"))
          : Promise.resolve({ Plaintext: key })
      }
      return Promise.reject(new Error(`Unexpected command ${command.constructor.name}`))
    },
    destroy: () => {},
  }
  return { calls, client: client as unknown as KMSClient }
}

// Every evaluation binds a fresh stub, so data keys from one backend never unwrap under another.
CipherContract.run(
  "kms",
  Effect.suspend(() => kms({ arn, client: mockKMS().client })),
)

describe("Cipher KMS backend", () => {
  it.effect("[SEC-CRYPT-03] wraps data keys through KMS with the constant encryption context", () =>
    Effect.gen(function* () {
      const mock = mockKMS()
      const layer = Cipher.layer(yield* kms({ arn, client: mock.client })).pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.orDie,
      )
      yield* Effect.gen(function* () {
        const cipher = yield* Cipher.Service
        const envelope = yield* cipher.encrypt(Redacted.make("kms-protected-secret"))
        expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("kms-protected-secret")
        // A second decrypt of the same envelope reuses the unwrapped data key.
        expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("kms-protected-secret")
      }).pipe(Effect.provide(layer))

      const generated = mock.calls.filter((call) => call.name === "GenerateDataKeyCommand")
      expect(generated).toHaveLength(1)
      expect(generated[0]?.input).toMatchObject({
        KeyId: arn,
        KeySpec: "AES_256",
        EncryptionContext: { bymorning: "cipher" },
      })
      const decrypted = mock.calls.filter((call) => call.name === "DecryptCommand")
      expect(decrypted).toHaveLength(1)
      expect(decrypted[0]?.input).toMatchObject({ KeyId: arn, EncryptionContext: { bymorning: "cipher" } })
      expect(decrypted[0]?.input.CiphertextBlob).toBeDefined()
    }),
  )

  it.effect("[SEC-CRYPT-11] names only the configured ARN to KMS Decrypt, never the envelope's key identity", () =>
    Effect.gen(function* () {
      const mock = mockKMS()
      const backend = yield* kms({ arn, client: mock.client })
      const cipher = yield* Cipher.make(backend).pipe(Effect.provide(NodeCrypto.layer))
      const envelope = yield* cipher.encrypt(Redacted.make("kms-protected-secret"))
      const foreign = "arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/other"
      // Replace the envelope's keyID segment with another key ARN.
      const parts = envelope.split(".")
      parts[1] = Buffer.from(foreign, "utf8").toString("base64url")
      const failure = yield* cipher.decrypt(parts.join(".")).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(Cipher.UnavailableError)
      // The backend seam refuses the same way before any KMS call.
      const dataKey = Buffer.from(parts[2] ?? "", "base64url")
      expect(yield* backend.unwrap(dataKey, foreign).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
      expect(mock.calls.filter((call) => call.name === "DecryptCommand")).toHaveLength(0)
      // Under its own identity the data key unwraps, and Decrypt still names the configured ARN.
      expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("kms-protected-secret")
      const decrypted = mock.calls.filter((call) => call.name === "DecryptCommand")
      expect(decrypted).toHaveLength(1)
      for (const call of decrypted) {
        expect(call.input.KeyId).toBe(arn)
        expect(JSON.stringify(call.input.KeyId)).not.toContain("other")
      }
    }),
  )

  it.effect("logs a refused foreign key identity with the configured ARN, never the envelope's", () =>
    Effect.gen(function* () {
      const mock = mockKMS()
      const entries: unknown[] = []
      const logger = Logger.make(({ message }) => entries.push(message))
      const backend = yield* kms({ arn, client: mock.client })
      const { dataKey } = yield* backend.generate
      const foreign = "arn:aws-us-gov:kms:us-gov-west-1:123456789012:key/private-marker"
      const failure = yield* backend
        .unwrap(dataKey, foreign)
        .pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })), Effect.flip)
      expect(failure).toBeInstanceOf(Cipher.UnavailableError)
      expect(entries).toEqual([
        ["Cipher refused a data key wrapped by another key", { reason: "foreign-key", keyID: arn }],
      ])
      expect(JSON.stringify(entries)).not.toContain("private-marker")
      expect(mock.calls.filter((call) => call.name === "DecryptCommand")).toHaveLength(0)
    }),
  )

  it.effect("a failed KMS request leaves one warning naming the operation and the SDK error class only", () =>
    Effect.gen(function* () {
      const denied = Object.assign(
        new Error("User: arn:aws:sts::123456789012:assumed-role/private-marker is not authorized"),
        {
          name: "AccessDeniedException",
          $metadata: { requestId: "private-marker-request" },
        },
      )
      const client = { send: () => Promise.reject(denied), destroy: () => {} } as unknown as KMSClient
      const entries: unknown[] = []
      const logger = Logger.make(({ message }) => entries.push(message))
      const backend = yield* kms({ arn, client })
      const logs = Logger.layer([logger], { mergeWithExisting: false })
      expect(yield* backend.generate.pipe(Effect.provide(logs), Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
      expect(yield* backend.unwrap(Buffer.alloc(8), arn).pipe(Effect.provide(logs), Effect.flip)).toBeInstanceOf(
        Cipher.UnavailableError,
      )
      expect(entries).toEqual([
        ["KMS request failed", { operation: "generate", name: "AccessDeniedException" }],
        ["KMS request failed", { operation: "unwrap", name: "AccessDeniedException" }],
      ])
      expect(JSON.stringify(entries)).not.toContain("private-marker")
      // A rejection that is not an Error, or whose name is not one identifier, is reported as unknown.
      const odd = { send: () => Promise.reject("string rejection"), destroy: () => {} } as unknown as KMSClient
      entries.length = 0
      yield* (yield* kms({ arn, client: odd })).generate.pipe(Effect.provide(logs), Effect.flip)
      expect(entries).toEqual([["KMS request failed", { operation: "generate", name: "unknown" }]])
    }),
  )

  it.effect("[SEC-CRYPT-04] fails closed when KMS is unreachable", () =>
    Effect.gen(function* () {
      const offline = {
        send: () => Promise.reject(new Error("NetworkingError: KMS is unreachable")),
        destroy: () => {},
      } as unknown as KMSClient
      const layer = Cipher.layer(yield* kms({ arn, client: offline })).pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.orDie,
      )
      const failure = yield* Cipher.Service.use((cipher) => cipher.encrypt(Redacted.make("never-persisted"))).pipe(
        Effect.provide(layer),
        Effect.flip,
      )
      expect(failure).toBeInstanceOf(Cipher.UnavailableError)
    }),
  )

  it("honors AWS_USE_FIPS_ENDPOINT from the environment", async () => {
    // The deployment image sets AWS_USE_FIPS_ENDPOINT=true; the SDK default
    // config chain must resolve FIPS endpoints without code overrides.
    const { KMSClient } = await import("@aws-sdk/client-kms")
    const previous = process.env.AWS_USE_FIPS_ENDPOINT
    process.env.AWS_USE_FIPS_ENDPOINT = "true"
    try {
      const client = new KMSClient({ region: "us-gov-west-1" })
      try {
        const useFips = client.config.useFipsEndpoint
        expect(typeof useFips === "function" ? await useFips() : useFips).toBe(true)
      } finally {
        client.destroy()
      }
    } finally {
      if (previous === undefined) delete process.env.AWS_USE_FIPS_ENDPOINT
      else process.env.AWS_USE_FIPS_ENDPOINT = previous
    }
  })
})
