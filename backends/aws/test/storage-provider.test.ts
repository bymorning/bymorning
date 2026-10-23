import { Storage } from "@bymorning/core/storage"
import { StorageContract } from "@bymorning/testing/contract/storage"
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
  ListMultipartUploadsCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { Deferred, Effect, Fiber, Option, Stream } from "effect"
import { execFile, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { s3 } from "../src/s3.js"

const exec = promisify(execFile)
const encoder = new TextEncoder()
const docker = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 }).status === 0
// RustFS is an S3-compatible object store on a public registry; Docker Hub no
// longer serves minio/minio anonymously. Pinned by digest.
const image = "ghcr.io/rustfs/rustfs@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff"
const credentials = { accessKeyId: "storage-test", secretAccessKey: "storage-test-password" }
class ObservedClient extends S3Client {
  destroyed = false
  override destroy() {
    this.destroyed = true
    super.destroy()
  }
}
const configured = (provider: Storage.Provider) =>
  Storage.layer({
    configure: (editor) => {
      editor.add(provider)
      editor.default.set(provider.id)
    },
  })

describe.skipIf(!docker)("Storage.s3", () => {
  let container: string | undefined
  let endpoint: string
  const config = (): S3ClientConfig => ({ endpoint, region: "us-east-1", forcePathStyle: true, credentials })

  beforeAll(async () => {
    container = (
      await exec("docker", [
        "run",
        "--rm",
        "-d",
        "-p",
        "127.0.0.1::9000",
        "-e",
        `RUSTFS_ACCESS_KEY=${credentials.accessKeyId}`,
        "-e",
        `RUSTFS_SECRET_KEY=${credentials.secretAccessKey}`,
        image,
      ])
    ).stdout.trim()
    const port = (await exec("docker", ["port", container, "9000/tcp"])).stdout.trim().split(":").at(-1)
    endpoint = `http://127.0.0.1:${port}`
    await vi.waitFor(
      async () => {
        expect((await fetch(`${endpoint}/minio/health/ready`)).ok).toBe(true)
      },
      { timeout: 20_000 },
    )
  }, 120_000)

  afterAll(async () => {
    if (container !== undefined) await exec("docker", ["rm", "-f", "-v", container])
  })

  // The shared contract: each case receives a fresh bucket on a caller-owned client.
  StorageContract.run(
    "s3",
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => new S3Client(config())),
        (client) => Effect.sync(() => client.destroy()),
      )
      const bucket = `storage-${randomUUID()}`
      yield* Effect.promise(() => client.send(new CreateBucketCommand({ Bucket: bucket })))
      return s3({ bucket, client })
    }),
  )

  describe("provider specifics", () => {
    let provider: Storage.Provider
    let client: ObservedClient
    let bucket: string

    beforeEach(async () => {
      client = new ObservedClient(config())
      bucket = `storage-${randomUUID()}`
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
      provider = s3({ bucket, client })
    })

    afterEach(() => {
      client.destroy()
    })

    const run = <A, E>(effect: Effect.Effect<A, E, Storage.Service>, signal: AbortSignal) =>
      Effect.runPromise(effect.pipe(Effect.provide(configured(provider))), { signal })

    it("does not destroy a caller-owned S3 client on layer shutdown", async ({ signal }) => {
      await run(Storage.Service.pipe(Effect.asVoid), signal)
      expect(client.destroyed).toBe(false)
      // Observe destruction without replacing the client's real transport or responses.
      const retained = `retained-${randomUUID()}`
      await client.send(new CreateBucketCommand({ Bucket: retained }))
      expect((await client.send(new HeadBucketCommand({ Bucket: retained }))).$metadata.httpStatusCode).toBe(200)
    })

    it("releases a stalled multipart producer and finishes multipart abort cleanup", async ({ signal }) => {
      const active = client
      const created = Deferred.makeUnsafe<void>()
      const aborted = Deferred.makeUnsafe<void>()
      // Observe real SDK requests without replacing their transport or responses.
      active.middlewareStack.add(
        (next, context) => async (args) => {
          const result = await next(args)
          if (context.commandName === "CreateMultipartUploadCommand") Deferred.doneUnsafe(created, Effect.void)
          if (context.commandName === "AbortMultipartUploadCommand") Deferred.doneUnsafe(aborted, Effect.void)
          return result
        },
        { step: "initialize", name: "observeMultipart" },
      )
      await run(
        Effect.scoped(
          Effect.gen(function* () {
            const { object } = yield* Storage.Service
            const started = yield* Deferred.make<void>()
            let released = false
            const body = Stream.concat(
              Stream.succeed(new Uint8Array(6 * 1024 * 1024)),
              Stream.fromEffect(
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.ensuring(
                    Effect.sync(() => {
                      released = true
                    }),
                  ),
                ),
              ),
            )
            const upload = yield* object.set(["multipart"], { body }).pipe(Effect.forkScoped)
            yield* Deferred.await(started)
            yield* Deferred.await(created)
            yield* Fiber.interrupt(upload)
            expect(released).toBe(true)
            yield* Deferred.await(aborted)
            const pending = yield* Effect.promise(() =>
              active.send(new ListMultipartUploadsCommand({ Bucket: bucket })),
            )
            expect(pending.Uploads ?? []).toEqual([])
            expect(Option.isNone(yield* object.get(["multipart"]))).toBe(true)
          }),
        ),
        signal,
      )
    }, 20_000)

    it("supports provider-owned client construction and reports missing bucket initialization", async ({ signal }) => {
      provider = s3({ bucket, config: config() })
      await run(
        Effect.gen(function* () {
          const storage = yield* Storage.Service
          expect(yield* storage.default()).toEqual({ id: "s3", name: "S3" })
        }),
        signal,
      )
      await client.send(new DeleteBucketCommand({ Bucket: bucket }))
      const error = await Effect.runPromise(Storage.Service.pipe(Effect.provide(configured(provider)), Effect.flip), {
        signal,
      })
      expect(error).toMatchObject({ _tag: "Storage.OperationError", providerID: "s3", operation: "init" })
      expect(error).toHaveProperty("cause")
    })

    it("reports destination failures without falling back or treating them as missing keys", ({ signal }) =>
      run(
        Effect.gen(function* () {
          const { object } = yield* Storage.Service
          yield* Effect.promise(async () => {
            await client.send(new DeleteBucketCommand({ Bucket: bucket }))
          })
          for (const [operation, result] of [
            ["get", object.get(["key"]).pipe(Effect.flip)],
            ["list", object.list(["key"]).pipe(Effect.flip)],
            ["remove", object.remove(["key"]).pipe(Effect.flip)],
            ["set", object.set(["key"], { body: Stream.succeed(encoder.encode("data")) }).pipe(Effect.flip)],
          ] as const) {
            const error = yield* result
            expect(error).toMatchObject({ _tag: "Storage.OperationError", providerID: "s3", operation })
            expect(error).toHaveProperty("cause")
          }
        }),
        signal,
      ))
  })
})
