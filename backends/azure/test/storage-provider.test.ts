import { Storage } from "@bymorning/core/storage"
import { StorageContract } from "@bymorning/testing/contract/storage"
import { BlobServiceClient, ContainerClient, StorageSharedKeyCredential } from "@azure/storage-blob"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { it as effect } from "@effect/vitest"
import { Effect, Fiber, Option, Stream } from "effect"
import { TestClock } from "effect/testing"
import { execFile, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { blob } from "../src/blob.js"

const exec = promisify(execFile)
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const docker = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 }).status === 0
// Azurite 3.37.0, the Azure Storage emulator (multi-arch index digest).
const image =
  "mcr.microsoft.com/azure-storage/azurite@sha256:830430c1da1a2d537e08f3e6764dd1f5ae00cf0346bcaf625b968ec3f0971fd5"
// The documented Azurite development account; not a secret.
const account = "devstoreaccount1"
const accountKey = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=="
const connectionString = (port: string) =>
  `DefaultEndpointsProtocol=http;AccountName=${account};AccountKey=${accountKey};BlobEndpoint=http://127.0.0.1:${port}/${account};`

const configured = (provider: Storage.Provider) =>
  Storage.layer({
    configure: (editor) => {
      editor.add(provider)
      editor.default.set(provider.id)
    },
  })

describe.skipIf(!docker)("Storage.blob", () => {
  let container: string | undefined
  let service: BlobServiceClient
  let port: string

  beforeAll(async () => {
    container = (
      await exec("docker", [
        "run",
        "--rm",
        "-d",
        "-p",
        "127.0.0.1::10000",
        image,
        "azurite",
        "--blobHost",
        "0.0.0.0",
        // The SDK's default service version is newer than the pinned emulator supports.
        "--skipApiVersionCheck",
      ])
    ).stdout.trim()
    port = (await exec("docker", ["port", container, "10000/tcp"])).stdout.trim().split(":").at(-1)!
    service = BlobServiceClient.fromConnectionString(connectionString(port))
    await vi.waitFor(
      async () => {
        await expect(service.getProperties()).resolves.toBeDefined()
      },
      { timeout: 20_000 },
    )
  }, 120_000)

  afterAll(async () => {
    if (container !== undefined) await exec("docker", ["rm", "-f", "-v", container])
  })

  // The shared contract: each case receives a fresh container on a caller-owned client.
  StorageContract.run(
    "azure-blob",
    Effect.gen(function* () {
      const name = `storage-${randomUUID()}`
      yield* Effect.promise(() => service.createContainer(name))
      return blob({ container: name, client: service.getContainerClient(name) })
    }),
  )

  describe("provider specifics", () => {
    let provider: Storage.Provider
    let client: ContainerClient
    let containerName: string

    beforeEach(async () => {
      containerName = `storage-${randomUUID()}`
      await service.createContainer(containerName)
      client = service.getContainerClient(containerName)
      provider = blob({ container: containerName, client })
    })

    const run = <A, E>(effect: Effect.Effect<A, E, Storage.Service>, signal: AbortSignal) =>
      Effect.runPromise(effect.pipe(Effect.provide(configured(provider))), { signal })

    it("leaves a caller-owned client serving after layer shutdown", async ({ signal }) => {
      await run(Storage.Service.pipe(Effect.asVoid), signal)
      // Azure SDK clients hold no persistent resources; the caller's client keeps serving.
      const retained = `retained-${randomUUID()}`
      await service.createContainer(retained)
      const response = await client.getProperties()
      expect(response).toBeDefined()
    })

    it("supports provider-owned client construction and reports missing container initialization", async ({
      signal,
    }) => {
      provider = blob({
        container: containerName,
        config: {
          // Azurite's account URL is path-styled: the account name is a path segment.
          url: `http://127.0.0.1:${port}/${account}`,
          credential: new StorageSharedKeyCredential(account, accountKey),
        },
      })
      await run(
        Effect.gen(function* () {
          const storage = yield* Storage.Service
          expect(yield* storage.default()).toEqual({ id: "azure-blob", name: "Azure Blob" })
        }),
        signal,
      )
      await service.deleteContainer(containerName)
      const error = await Effect.runPromise(Storage.Service.pipe(Effect.provide(configured(provider)), Effect.flip), {
        signal,
      })
      expect(error).toMatchObject({ _tag: "Storage.OperationError", providerID: "azure-blob", operation: "init" })
      expect(error).toHaveProperty("cause")
    })

    it("supports provider-owned connection-string construction", async ({ signal }) => {
      provider = blob({ container: containerName, config: { connectionString: connectionString(port) } })
      await run(
        Effect.gen(function* () {
          const { object } = yield* Storage.Service
          yield* object.set(["owned.txt"], { body: Stream.succeed(encoder.encode("owned")) })
          const entry = Option.getOrThrow(yield* object.get(["owned.txt"]))
          expect(decoder.decode(yield* Stream.mkUint8Array(entry.body))).toBe("owned")
        }),
        signal,
      )
    })

    it("reports destination failures without falling back or treating them as missing keys", ({ signal }) =>
      run(
        Effect.gen(function* () {
          const { object } = yield* Storage.Service
          yield* Effect.promise(() => service.deleteContainer(containerName))
          for (const [operation, result] of [
            ["get", object.get(["key"]).pipe(Effect.flip)],
            ["list", object.list(["key"]).pipe(Effect.flip)],
            ["remove", object.remove(["key"]).pipe(Effect.flip)],
            ["set", object.set(["key"], { body: Stream.succeed(encoder.encode("data")) }).pipe(Effect.flip)],
          ] as const) {
            const error = yield* result
            expect(error).toMatchObject({ _tag: "Storage.OperationError", providerID: "azure-blob", operation })
            expect(error).toHaveProperty("cause")
          }
        }),
        signal,
      ))
  })
})

describe("Storage.blob startup probe", () => {
  effect.effect("fails init and aborts the request when the container never answers", () =>
    Effect.gen(function* () {
      let aborted = false
      const stalled = {
        getProperties: (options?: { abortSignal?: AbortSignal }) =>
          new Promise<never>(() =>
            options?.abortSignal?.addEventListener("abort", () => {
              aborted = true
            }),
          ),
      } as unknown as ContainerClient
      const driver = yield* blob({ container: "stalled", client: stalled }).open
      const init = yield* driver.init.pipe(Effect.flip, Effect.forkChild)
      yield* TestClock.adjust("59 seconds")
      expect(init.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(init)).toMatchObject({
        _tag: "Storage.OperationError",
        providerID: "azure-blob",
        operation: "init",
      })
      expect(aborted).toBe(true)
    }),
  )
})
