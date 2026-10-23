import { S3Client } from "@aws-sdk/client-s3"
import { Storage } from "@bymorning/core/storage"
import { Deferred, Effect, Fiber, Option, Stream } from "effect"
import { createServer, type ServerResponse } from "node:http"
import { describe, expect, it } from "vitest"
import { s3 } from "../src/s3.js"

const bucket = "stream-test"
const key = "object.txt"
const content = "0123456789abcdef"
const metadata = { contentLength: content.length, contentType: "text/plain", etag: '"stream-test-etag"' }

// This protocol fixture deliberately leaves GetObject incomplete. The test closes
// its response only after Storage's public body stream has delivered the prefix.
const fixture = Effect.gen(function* () {
  const received = yield* Deferred.make<ServerResponse>()
  const requests: Array<{ method: string | undefined; path: string; range: string | undefined }> = []
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createServer((request, response) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname
        requests.push({ method: request.method, path, range: request.headers.range })
        if (request.method === "HEAD" && (path === `/${bucket}` || path === `/${bucket}/`)) {
          response.writeHead(200, { "x-amz-bucket-region": "us-east-1" })
          response.end()
          return
        }
        if (request.method === "HEAD" && path === `/${bucket}/${key}`) {
          response.writeHead(200, {
            "content-length": content.length,
            "content-type": metadata.contentType,
            etag: metadata.etag,
          })
          response.end()
          return
        }
        if (request.method === "GET" && path === `/${bucket}/${key}`) {
          const ranged = request.headers.range === "bytes=4-11"
          response.writeHead(ranged ? 206 : 200, {
            "content-length": ranged ? 8 : content.length,
            "content-type": metadata.contentType,
            etag: metadata.etag,
            ...(ranged ? { "content-range": `bytes 4-11/${content.length}` } : {}),
          })
          response.write(ranged ? content.slice(4, 7) : content.slice(0, 3))
          Deferred.doneUnsafe(received, Effect.succeed(response))
          return
        }
        response.writeHead(500)
        response.end("Unexpected S3 request")
      }),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
            server.closeAllConnections()
          }),
      ),
  )
  yield* Effect.tryPromise(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject)
          resolve()
        })
      }),
  )
  const address = server.address()
  if (address === null || typeof address === "string") return yield* Effect.die("Missing fixture TCP address")
  const client = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new S3Client({
          endpoint: `http://127.0.0.1:${address.port}`,
          region: "us-east-1",
          forcePathStyle: true,
          maxAttempts: 1,
          credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
        }),
    ),
    (client) => Effect.sync(() => client.destroy()),
  )
  const provider = s3({ bucket, client })
  const layer = Storage.layer({
    configure: (editor) => {
      editor.add(provider)
      editor.default.set(provider.id)
    },
  })
  return { layer, received, requests }
})

describe("Storage.s3 mid-read transport failure", () => {
  for (const operation of ["get", "getRange"] as const) {
    it(`${operation} returns an entry whose body fails with a typed operation error after receiving bytes`, ({
      signal,
    }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const server = yield* fixture
          yield* Effect.gen(function* () {
            const { object } = yield* Storage.Service
            const entry = Option.getOrThrow(
              yield* operation === "get" ? object.get([key]) : object.getRange([key], { offset: 4, length: 8 }),
            )
            expect(entry.metadata).toEqual(metadata)
            const response = yield* Deferred.await(server.received)
            const prefix = yield* Deferred.make<void>()
            const chunks: Uint8Array[] = []
            const reader = yield* entry.body.pipe(
              Stream.runForEach((chunk) =>
                Effect.gen(function* () {
                  chunks.push(chunk)
                  if (Buffer.concat(chunks).length >= 3) yield* Deferred.succeed(prefix, undefined)
                }),
              ),
              Effect.flip,
              Effect.forkScoped,
            )
            yield* Deferred.await(prefix)
            expect(Buffer.concat(chunks).toString()).toBe(operation === "get" ? "012" : "456")
            expect(response.writableEnded).toBe(false)
            yield* Effect.sync(() => response.destroy())

            // Flip only the body's typed error channel: acquisition failures,
            // defects, and successful-but-truncated bodies must fail this test.
            const error = yield* Fiber.join(reader)
            expect(error).toBeInstanceOf(Storage.OperationError)
            expect(error).toMatchObject({ _tag: "Storage.OperationError", providerID: "s3", operation: "get" })
            expect(error.cause).toBeInstanceOf(Error)
            expect(error.message.length).toBeGreaterThan(0)
            expect(server.requests).toEqual([
              { method: "HEAD", path: `/${bucket}/`, range: undefined },
              ...(operation === "getRange" ? [{ method: "HEAD", path: `/${bucket}/${key}`, range: undefined }] : []),
              {
                method: "GET",
                path: `/${bucket}/${key}`,
                range: operation === "getRange" ? "bytes=4-11" : undefined,
              },
            ])
          }).pipe(Effect.provide(server.layer))
        }).pipe(Effect.scoped),
        { signal },
      ))
  }
})
