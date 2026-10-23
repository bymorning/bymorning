import { CipherContract } from "@bymorning/testing/contract/cipher"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Fiber, Layer, Logger, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto"
import { afterEach, describe, expect, vi } from "vitest"
import { CryptographyClient, KeyClient, type UnwrapResult, type WrapResult } from "@azure/keyvault-keys"
import { ContainerClient } from "@azure/storage-blob"
import { createHttpHeaders, type HttpClient } from "@azure/core-rest-pipeline"
import { Cipher } from "@bymorning/core/cipher"
import { keyvault } from "../src/keyvault.js"

const versioned = "https://bymorning.vault.azure.net/keys/credential/8f3a2c1b4d5e6f708192a3b4c5d6e7f8"
const unversioned = "https://bymorning.vault.azure.net/keys/credential"
afterEach(() => vi.restoreAllMocks())

/** The private in-band frame earlier releases wrote around the RSA ciphertext (format 1, version, u16 length). */
const frame = (version: string, wrapped: Uint8Array) => {
  const header = Buffer.from([1, version.length, 0, 0])
  header.writeUInt16BE(wrapped.length, 2)
  return Buffer.concat([header, Buffer.from(version, "ascii"), wrapped])
}
/** The envelope's stored data key segment. */
const stored = (envelope: string) => Buffer.from(envelope.split(".")[2]!, "base64url")
/** The envelope's key identity segment. */
const identity = (envelope: string) => Buffer.from(envelope.split(".")[1]!, "base64url").toString("utf8")

/** Stubbed CryptographyClient: records calls, issues opaque RSA-2048-sized blobs, and round-trips only the data keys it wrapped. */
const stubCrypto = () => {
  const calls: Array<{ readonly name: string; readonly algorithm: string }> = []
  const issued = new Map<string, Uint8Array>()
  const client = {
    wrapKey: (algorithm: string, key: Uint8Array): Promise<WrapResult> => {
      calls.push({ name: "wrapKey", algorithm })
      const blob = randomBytes(256)
      issued.set(blob.toString("base64url"), Uint8Array.from(key))
      return Promise.resolve({ result: blob, algorithm, keyID: versioned }) as Promise<WrapResult>
    },
    unwrapKey: (algorithm: string, dataKey: Uint8Array): Promise<UnwrapResult> => {
      calls.push({ name: "unwrapKey", algorithm })
      const key = issued.get(Buffer.from(dataKey).toString("base64url"))
      return key === undefined
        ? Promise.reject(new Error("KeyVault: ciphertext fails authentication"))
        : (Promise.resolve({ result: key, algorithm, keyID: versioned }) as Promise<UnwrapResult>)
    },
  }
  return { calls, client: client as unknown as CryptographyClient }
}

// Every evaluation binds a fresh stub vault key, so data keys from one backend never unwrap under another.
CipherContract.run(
  "keyvault",
  Effect.suspend(() => keyvault({ key: versioned, client: stubCrypto().client })),
)

describe("Cipher Key Vault backend", () => {
  it.each([
    ["azure.net", "windows.net", "com"],
    ["usgovcloudapi.net", "usgovcloudapi.net", "us"],
  ])("Azure SDK requests cloud token scopes (%s)", async (vault, storage, login) => {
    const scopes: string[] = []
    const credential = { getToken: async (scope: string | string[]) => {
      scopes.push(...(typeof scope === "string" ? [scope] : scope))
      return { token: "fixture-token", expiresOnTimestamp: Date.now() + 3600_000 }
    } }
    const key = `https://scope-test.vault.${vault}/keys/credential/${versioned.split("/").at(-1)}`
    const httpClient: HttpClient = { sendRequest: async (request) => {
      expect(new URL(request.url).hostname).toBe(new URL(key).hostname)
      if (!request.headers.has("authorization")) return {
        request, status: 401, headers: createHttpHeaders({
          "www-authenticate": `Bearer authorization="https://login.microsoftonline.${login}/tenant", resource="https://vault.${vault}"`,
        }),
      }
      expect(request.headers.get("authorization")).toBe("Bearer fixture-token")
      return { request, status: 200, headers: createHttpHeaders({ "content-type": "application/json" }),
        bodyAsText: JSON.stringify(request.method === "GET"
          ? { key: { kid: key, kty: "RSA", key_ops: ["wrapKey", "unwrapKey"] }, attributes: { enabled: true } }
          : { kid: key, value: Buffer.alloc(request.url.includes("/unwrapkey") ? 32 : 256, 1).toString("base64url") }),
      }
    } }
    const backend = await Effect.runPromise(keyvault({
      key: key.slice(0, key.lastIndexOf("/")), credential,
      keys: new KeyClient(new URL(key).origin, credential, { httpClient }),
      client: new CryptographyClient(key, credential, { httpClient }),
    }))
    const generated = await Effect.runPromise(backend.generate)
    await Effect.runPromise(backend.unwrap(generated.dataKey, backend.keyID))
    expect(scopes.length).toBeGreaterThan(0)
    expect(new Set(scopes)).toEqual(new Set([`https://vault.${vault}/.default`]))
    scopes.length = 0
    const container = new ContainerClient(`https://scope-test.blob.core.${storage}/fixture`, credential, {
      audience: "https://storage.azure.com/.default",
      httpClient: { sendRequest: async (request) => {
        expect(request.headers.get("authorization")).toBe("Bearer fixture-token")
        return { request, status: 200, headers: request.headers }
      } },
    })
    await container.getProperties()
    expect(scopes).toEqual(["https://storage.azure.com/.default"])
  })

  it("refuses a cross-cloud Key Vault authentication challenge before requesting a token", async () => {
    const getToken = vi.fn()
    const keys = new KeyClient("https://challenge-test.vault.usgovcloudapi.net", { getToken }, {
      httpClient: { sendRequest: async (request) => ({ request, status: 401, headers: createHttpHeaders({
        "www-authenticate": 'Bearer authorization="https://login.microsoftonline.com/tenant", resource="https://vault.azure.net"',
      }) }) },
    })
    const error = await Effect.runPromise(keyvault({ key: "https://challenge-test.vault.usgovcloudapi.net/keys/credential", keys }).pipe(Effect.flip))
    expect(error).toBeInstanceOf(Cipher.UnavailableError)
    expect(getToken).not.toHaveBeenCalled()
  })

  it.effect("decrypts v1 after restart at v2, writes bare v2 data keys, and caches one client per version", () =>
    Effect.gen(function* () {
      const v1 = versioned.split("/").at(-1)!
      const v2 = "0123456789abcdef0123456789abcdef"
      const keys = new Map([v1, v2].map((version) => [version, generateKeyPairSync("rsa", { modulusLength: 2048 })]))
      const seen = new Map<string, Set<CryptographyClient>>()
      const disabled = new Set<string>()
      vi.spyOn(CryptographyClient.prototype, "wrapKey").mockImplementation(async function (this: CryptographyClient, algorithm, key) {
        const version = this.keyID!.split("/").at(-1)!
        return { algorithm, keyID: this.keyID!, result: publicEncrypt({ key: keys.get(version)!.publicKey, oaepHash: "sha256" }, key) }
      })
      vi.spyOn(CryptographyClient.prototype, "unwrapKey").mockImplementation(async function (this: CryptographyClient, algorithm, wrapped) {
        const version = this.keyID!.split("/").at(-1)!
        const clients = seen.get(version) ?? new Set<CryptographyClient>()
        clients.add(this)
        seen.set(version, clients)
        if (!keys.has(version) || disabled.has(version)) throw new Error("private-vault-error")
        return { algorithm, keyID: this.keyID!, result: privateDecrypt({ key: keys.get(version)!.privateKey, oaepHash: "sha256" }, wrapped) }
      })
      let latest = v1
      const resolver = { getKey: () => Promise.resolve({ id: `${unversioned}/${latest}` }) } as unknown as KeyClient
      const first = yield* keyvault({ key: unversioned, keys: resolver })
      const old = yield* Cipher.Service.use((cipher) => cipher.encrypt(Redacted.make("old-secret"))).pipe(
        Effect.provide(Cipher.layer(first).pipe(Layer.provide(NodeCrypto.layer))),
      )
      latest = v2
      const second = yield* keyvault({ key: unversioned, keys: resolver })
      const next = yield* Cipher.Service.use((cipher) => Effect.gen(function* () {
        // Written under version A; decrypts after a new backend started at version B.
        expect(Redacted.value(yield* cipher.decrypt(old))).toBe("old-secret")
        const next = yield* cipher.encrypt(Redacted.make("new-secret"))
        expect(Redacted.value(yield* cipher.decrypt(next))).toBe("new-secret")
        return next
      })).pipe(Effect.provide(Cipher.layer(second).pipe(Layer.provide(NodeCrypto.layer))))
      // The version lives only in the envelope's key identity; the data key is the bare RSA ciphertext.
      expect(identity(old)).toBe(`${unversioned}/${v1}`)
      expect(identity(next)).toBe(`${unversioned}/${v2}`)
      expect(stored(old)).toHaveLength(256)
      expect(stored(next)).toHaveLength(256)
      yield* second.unwrap(stored(old), identity(old))
      yield* second.unwrap(stored(next), identity(next))
      expect(seen.get(v1)?.size).toBe(1)
      expect(seen.get(v2)?.size).toBe(1)
      // A v1 data key presented under the v2 identity reaches v2, which cannot unwrap it.
      const crossed = yield* second.unwrap(stored(old), identity(next)).pipe(Effect.flip)
      expect(crossed).toBeInstanceOf(Cipher.UnavailableError)
      // Bypass Cipher's existing short-lived plaintext-key cache when testing
      // revocation; every actual unwrap still goes to the selected vault version.
      disabled.add(v1)
      const disabledError = yield* second.unwrap(stored(old), identity(old)).pipe(Effect.flip)
      expect(disabledError).toBeInstanceOf(Cipher.UnavailableError)
      const unknownError = yield* second.unwrap(stored(old), `${unversioned}/${"a".repeat(32)}`).pipe(Effect.flip)
      expect(unknownError).toBeInstanceOf(Cipher.UnavailableError)
      expect(JSON.stringify([crossed, disabledError, unknownError])).not.toContain("private-vault-error")
      // A legacy framed data key still reads when its frame agrees with the identity.
      const framed = frame(v2, stored(next))
      expect(Buffer.from(yield* second.unwrap(framed, identity(next))).equals(
        yield* second.unwrap(stored(next), identity(next)),
      )).toBe(true)
    }),
  )

  it.effect("caches a version's client only after the vault served it, bounded, keeping the startup version", () =>
    Effect.gen(function* () {
      const startup = versioned.split("/").at(-1)!
      const served = new Set<string>([startup])
      const seen = new Map<string, CryptographyClient[]>()
      vi.spyOn(CryptographyClient.prototype, "unwrapKey").mockImplementation(async function (this: CryptographyClient, algorithm, wrapped) {
        const version = this.keyID!.split("/").at(-1)!
        seen.set(version, [...(seen.get(version) ?? []), this])
        if (!served.has(version)) throw new Error("private-vault-error")
        return { algorithm, keyID: this.keyID!, result: Buffer.alloc(32, wrapped[0]) }
      })
      const backend = yield* keyvault({ key: versioned, credential: { getToken: async () => null } })
      const wrapped = Buffer.alloc(256, 7)
      const unwrap = (version: string) => backend.unwrap(wrapped, `${unversioned}/${version}`)
      const distinct = (version: string) => new Set(seen.get(version) ?? []).size
      // A version the vault refuses is never cached: every attempt constructs a new client.
      const unknown = "a".repeat(32)
      expect(yield* unwrap(unknown).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
      expect(yield* unwrap(unknown).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
      expect(seen.get(unknown)).toHaveLength(2)
      expect(distinct(unknown)).toBe(2)
      // A served version is cached after its first success and reused thereafter.
      const rotated = "b".repeat(32)
      served.add(rotated)
      yield* unwrap(rotated)
      yield* unwrap(rotated)
      expect(distinct(rotated)).toBe(1)
      // The bound: after sixteen other served versions, the oldest rotated client
      // is evicted and reconstructed, while the startup version keeps its client.
      const more = Array.from({ length: 16 }, (_, index) => index.toString(16).padStart(32, "0"))
      for (const version of more) {
        served.add(version)
        yield* unwrap(version)
      }
      yield* unwrap(rotated)
      expect(distinct(rotated)).toBe(2)
      yield* unwrap(startup)
      yield* unwrap(startup)
      expect(distinct(startup)).toBe(1)
    }),
  )

  it.effect("logs refusals with the envelope's parsed version or \"malformed\", never the identity itself", () =>
    Effect.gen(function* () {
      const stub = stubCrypto()
      const backend = yield* keyvault({ key: versioned, client: stub.client })
      const { dataKey } = yield* backend.generate
      const entries: Array<readonly unknown[]> = []
      const logger = Logger.make(({ message }) => entries.push(Array.isArray(message) ? message : [message]))
      const logs = Logger.layer([logger], { mergeWithExisting: false })
      const version = versioned.split("/").at(-1)!
      const cases: Array<[Uint8Array, string, string, string]> = [
        [dataKey, "https://private-marker.vault.azure.net/keys/credential/" + version, "foreign-key", version],
        [dataKey, versioned.replace("/credential/", "/private-marker/"), "foreign-key", version],
        [frame("0".repeat(32), dataKey), versioned, "frame-mismatch", version],
        [Buffer.alloc(300, 1), versioned, "invalid-data-key", version],
        [dataKey, unversioned, "invalid-version", "malformed"],
        [dataKey, `${unversioned}/private-marker`, "invalid-version", "malformed"],
        [dataKey, "not a url private-marker", "invalid-key-id", "malformed"],
        [dataKey, "arn:aws:kms:us-east-1:000000000000:key/private-marker", "invalid-key-id", "malformed"],
      ]
      for (const [bytes, keyID, reason, logged] of cases) {
        entries.length = 0
        expect(yield* backend.unwrap(bytes, keyID).pipe(Effect.provide(logs), Effect.flip)).toBeInstanceOf(
          Cipher.UnavailableError,
        )
        expect(entries, keyID).toEqual([["Cipher refused a Key Vault data key", { reason, version: logged }]])
        expect(JSON.stringify(entries)).not.toContain("private-marker")
      }
      expect(stub.calls.filter((call) => call.name === "unwrapKey")).toHaveLength(0)
      // A vault failure logs the selected version, not the identity.
      entries.length = 0
      expect(yield* backend.unwrap(Buffer.alloc(256, 9), versioned).pipe(Effect.provide(logs), Effect.flip)).toBeInstanceOf(
        Cipher.UnavailableError,
      )
      expect(entries).toEqual([["Cipher could not unwrap a Key Vault data key", { reason: "unwrap-failed", version }]])
    }),
  )

  it.effect("unwraps a bare legacy payload with the version named by the envelope keyID", () => Effect.gen(function* () {
    const stub = stubCrypto()
    const backend = yield* keyvault({ key: versioned, client: stub.client })
    const key = randomBytes(32)
    const legacy = (yield* Effect.promise(() => stub.client.wrapKey("RSA-OAEP-256", key))).result
    expect(legacy.length).toBe(256)
    expect(Buffer.from(yield* backend.unwrap(legacy, versioned)).equals(key)).toBe(true)
    const layer = Cipher.layer(backend).pipe(Layer.provide(NodeCrypto.layer))
    const envelope = ["v1", Buffer.from(versioned).toString("base64url"), Buffer.from(legacy).toString("base64url"), Buffer.alloc(12).toString("base64url"), randomBytes(32).toString("base64url")].join(".")
    // Wrong nonce/ciphertext: fails closed at authentication, not by leaking.
    expect(yield* Cipher.Service.use((c) => c.decrypt(envelope)).pipe(Effect.provide(layer), Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
  }))

  it.effect("writes bare RSA ciphertext and reads a legacy frame only when it agrees with the keyID", () => Effect.gen(function* () {
    const stub = stubCrypto()
    const backend = yield* keyvault({ key: versioned, client: stub.client })
    const { key, dataKey } = yield* backend.generate
    // No frame: the data key is exactly the RSA-2048 ciphertext.
    expect(dataKey).toHaveLength(256)
    expect(dataKey[0] === 1 && dataKey[1] === 32).toBe(false)
    const version = versioned.split("/").at(-1)!
    const framed = frame(version, dataKey)
    expect(framed).toHaveLength(292)
    expect(Buffer.from(yield* backend.unwrap(framed, versioned)).equals(key)).toBe(true)
    // A frame naming another version than the keyID is refused before the vault is consulted.
    const before = stub.calls.filter((call) => call.name === "unwrapKey").length
    const disagreeing = frame("0".repeat(32), dataKey)
    expect(yield* backend.unwrap(disagreeing, versioned).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
    expect(yield* backend.unwrap(framed, `${unversioned}/${"0".repeat(32)}`).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
    expect(stub.calls.filter((call) => call.name === "unwrapKey")).toHaveLength(before)
  }))

  it.effect("rejects malformed legacy framing without unwrapping", () => Effect.gen(function* () {
    const stub = stubCrypto()
    const backend = yield* keyvault({ key: versioned, client: stub.client })
    const { dataKey: wrapped } = yield* backend.generate
    const dataKey = frame(versioned.split("/").at(-1)!, wrapped)
    const invalid = [
      ...Array.from({ length: dataKey.length }, (_, length) => dataKey.slice(0, length)),
      Buffer.concat([dataKey, Buffer.from([0])]),
      ...[[0, 2], [1, 0], [1, 255], [2, 255], [3, 1], [4, 47], [4, 255]].map(([offset, value]) => {
        const copy = dataKey.slice()
        copy[offset!] = value!
        return copy
      }),
    ]
    for (const bytes of invalid) {
      expect(yield* backend.unwrap(bytes, versioned).pipe(Effect.flip)).toBeInstanceOf(Cipher.UnavailableError)
    }
    // Only a truncation that is exactly a bare RSA length is legacy-shaped; it
    // reaches the vault, which rejects it (fail closed). Nothing else does.
    expect(stub.calls.filter((call) => call.name === "unwrapKey")).toHaveLength(invalid.filter((bytes) => bytes.length === 256).length)
  }))

  it.effect("refuses an envelope key identity from another vault, key name, or malformed version", () => Effect.gen(function* () {
    const stub = stubCrypto()
    const backend = yield* keyvault({ key: versioned, client: stub.client })
    const { dataKey } = yield* backend.generate
    for (const keyID of [
      versioned.replace("bymorning.", "other."),
      versioned.replace("/credential/", "/other/"),
      versioned.replace("https://", "http://"),
      unversioned,
      `${unversioned}/../evil`,
      `${unversioned}/${"g".repeat(32)}`,
      `${unversioned}/${"0".repeat(31)}`,
      "arn:aws:kms:us-east-1:000000000000:key/credential",
      "local",
      "",
    ]) {
      const failure = yield* backend.unwrap(dataKey, keyID).pipe(Effect.flip)
      expect(failure, keyID).toBeInstanceOf(Cipher.UnavailableError)
      expect(JSON.stringify(failure)).not.toContain(keyID.length === 0 ? "undefined" : keyID)
    }
    // Refusals happen before the vault is consulted.
    expect(stub.calls.filter((call) => call.name === "unwrapKey")).toHaveLength(0)
    expect(yield* backend.unwrap(dataKey, versioned)).toHaveLength(32)
  }))

  it.effect("rejects resolution to a different vault, name, or malformed version", () => Effect.gen(function* () {
    for (const id of [versioned.replace("bymorning.", "other."), versioned.replace("/credential/", "/other/"), `${unversioned}/../evil`]) {
      const failure = yield* keyvault({ key: unversioned, keys: { getKey: async () => ({ id }) } as unknown as KeyClient }).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(Cipher.UnavailableError)
      expect(JSON.stringify(failure)).not.toContain(id)
    }
  }))

  it.effect("fails closed and aborts the request when key resolution never answers", () => Effect.gen(function* () {
    let aborted = false
    const stalled = {
      getKey: (_name: string, options?: { abortSignal?: AbortSignal }) =>
        new Promise<never>(() => options?.abortSignal?.addEventListener("abort", () => { aborted = true })),
    } as unknown as KeyClient
    const resolving = yield* keyvault({ key: unversioned, keys: stalled }).pipe(Effect.flip, Effect.forkChild)
    yield* TestClock.adjust("59 seconds")
    expect(resolving.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 second")
    expect(yield* Fiber.join(resolving)).toBeInstanceOf(Cipher.UnavailableError)
    expect(aborted).toBe(true)
  }))

  it.effect("wraps locally generated data keys through Key Vault RSA-OAEP-256 and records the versioned keyID", () =>
    Effect.gen(function* () {
      const stub = stubCrypto()
      const layer = Cipher.layer(yield* keyvault({ key: versioned, client: stub.client })).pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.orDie,
      )
      yield* Effect.gen(function* () {
        const cipher = yield* Cipher.Service
        const envelope = yield* cipher.encrypt(Redacted.make("keyvault-protected-secret"))
        expect(envelope.startsWith("v1.")).toBe(true)
        // The envelope records the versioned key identifier.
        const encodedKeyID = envelope.split(".")[1] ?? ""
        expect(Buffer.from(encodedKeyID, "base64url").toString("utf8")).toBe(versioned)
        expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("keyvault-protected-secret")
        // A second decrypt of the same envelope reuses the unwrapped data key.
        expect(Redacted.value(yield* cipher.decrypt(envelope))).toBe("keyvault-protected-secret")
      }).pipe(Effect.provide(layer))

      expect(stub.calls.filter((call) => call.name === "wrapKey")).toEqual([
        { name: "wrapKey", algorithm: "RSA-OAEP-256" },
      ])
      expect(stub.calls.filter((call) => call.name === "unwrapKey")).toEqual([
        { name: "unwrapKey", algorithm: "RSA-OAEP-256" },
      ])
    }),
  )

  it.effect("resolves an unversioned key URL to the latest versioned key identifier", () =>
    Effect.gen(function* () {
      const stub = stubCrypto()
      const keys = {
        calls: 0,
        getKey(name: string) {
          this.calls++
          expect(name).toBe("credential")
          return Promise.resolve({ name, id: versioned })
        },
      }
      const backend = yield* keyvault({ key: unversioned, client: stub.client, keys: keys as unknown as KeyClient })
      expect(backend.keyID).toBe(versioned)
      expect(keys.calls).toBe(1)
      // A versioned URL never consults the keys client.
      const direct = yield* keyvault({ key: versioned, client: stub.client, keys: keys as unknown as KeyClient })
      expect(direct.keyID).toBe(versioned)
      expect(keys.calls).toBe(1)
    }),
  )

  it.effect("fails closed when Key Vault is unreachable", () =>
    Effect.gen(function* () {
      const offline = {
        wrapKey: () => Promise.reject(new Error("NetworkingError: Key Vault is unreachable")),
        unwrapKey: () => Promise.reject(new Error("NetworkingError: Key Vault is unreachable")),
      } as unknown as CryptographyClient
      const layer = Cipher.layer(yield* keyvault({ key: versioned, client: offline })).pipe(
        Layer.provide(NodeCrypto.layer),
        Layer.orDie,
      )
      const failure = yield* Cipher.Service.use((cipher) => cipher.encrypt(Redacted.make("never-persisted"))).pipe(
        Effect.provide(layer),
        Effect.flip,
      )
      expect(failure).toBeInstanceOf(Cipher.UnavailableError)
      // Construction-time failures close the same way: an unreachable vault
      // cannot resolve an unversioned key URL.
      const construction = yield* keyvault({
        key: unversioned,
        keys: { getKey: () => Promise.reject(new Error("NetworkingError: Key Vault is unreachable")) } as unknown as KeyClient,
      }).pipe(Effect.flip)
      expect(construction).toBeInstanceOf(Cipher.UnavailableError)
    }),
  )

  it.effect("fails closed on a malformed key URL", () =>
    Effect.gen(function* () {
      const failure = yield* keyvault({ key: "not-a-key-url" }).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(Cipher.UnavailableError)
    }),
  )

  // Opt-in live check against a real vault: set AZURE_KEY_VAULT_KEY to a key URL
  // (versioned or not) and authenticate through the standard Azure environment.
  it.skipIf(process.env.AZURE_KEY_VAULT_KEY === undefined)(
    "round-trips against a real vault (AZURE_KEY_VAULT_KEY)",
    async () => {
      const backend = await Effect.runPromise(keyvault({ key: process.env.AZURE_KEY_VAULT_KEY! }))
      expect(backend.keyID).toContain(process.env.AZURE_KEY_VAULT_KEY!.replace(/\/$/, ""))
      const layer = Cipher.layer(backend).pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
      const envelope = await Effect.runPromise(
        Cipher.Service.use((cipher) => cipher.encrypt(Redacted.make("live-roundtrip"))).pipe(Effect.provide(layer)),
      )
      const plaintext = await Effect.runPromise(
        Cipher.Service.use((cipher) => cipher.decrypt(envelope)).pipe(Effect.provide(layer)),
      )
      expect(Redacted.value(plaintext)).toBe("live-roundtrip")
    },
    30_000,
  )
})
