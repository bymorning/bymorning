import { Storage } from "@bymorning/core/storage"
import { afterEach, beforeEach, expect, it } from "vitest"
import { Deferred, Effect, Fiber, Option, Stream } from "effect"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "bymorning-storage-compat-"))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
const layer = () => {
  const provider = Storage.filesystem({ directory })
  return Storage.layer({
    configure: (editor) => {
      editor.add(provider)
      editor.default.set(provider.id)
    },
  })
}
const run = <A, E>(effect: Effect.Effect<A, E, Storage.Service>, signal: AbortSignal) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer())), { signal })
const filename = (key: string) => path.join(directory, `${createHash("sha256").update(key).digest("hex")}.object`)

// Pre-migration file format: SHA-256 key filename, four-byte BE JSON header length,
// JSON {key, contentType?}, then unmodified object bytes. No provider prefix.
const legacy = async (key: string, body: string, contentType?: string) => {
  const header = Buffer.from(JSON.stringify({ key, ...(contentType === undefined ? {} : { contentType }) }))
  const size = Buffer.alloc(4)
  size.writeUInt32BE(header.length)
  await writeFile(filename(key), Buffer.concat([size, header, Buffer.from(body)]))
}

it("selects filesystem when the declared S3 default is unavailable and not registered", async ({ signal }) => {
  const provider = Storage.filesystem({ directory })
  await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      expect(yield* storage.default()).toEqual({ id: "filesystem", name: "Filesystem" })
      expect(yield* storage.list()).toEqual([{ id: "filesystem", name: "Filesystem" }])
      yield* storage.object.set(["local"], { body: Stream.empty })
    }).pipe(
      Effect.provide(
        Storage.layer({
          configure: (editor) => {
            editor.add(provider)
            editor.default.set(Storage.ID.make("s3"))
          },
          selection: provider.id,
        }),
      ),
    ),
    { signal },
  )
})

it("preserves metadata, markers, ranges and atomic replacement across application lifetimes", async ({ signal }) => {
  await run(
    Effect.gen(function* () {
      const { object } = yield* Storage.Service
      yield* object.set([{ project: "one" }], { body: Stream.succeed(new TextEncoder().encode("ignored")) })
      yield* object.set([{ project: "one" }, "hello.txt"], {
        contentType: "text/plain",
        body: Stream.succeed(new TextEncoder().encode("hello world")),
      })
      expect(
        yield* object.set([{ project: "one" }, "hello.txt"], { body: Stream.fail("source failed") }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "Storage.OperationError", operation: "set", providerID: "filesystem" })
    }),
    signal,
  )
  await run(
    Effect.gen(function* () {
      const { object } = yield* Storage.Service
      expect((yield* object.list([{ project: "one" }])).map((item) => [item.key, item.marker])).toEqual([
        ["project/one/", true],
        ["project/one/hello.txt", false],
      ])
      const found = Option.getOrThrow(yield* object.get([{ project: "one" }, "hello.txt"]))
      expect(found.metadata).toEqual({ contentType: "text/plain", contentLength: 11 })
      expect(new TextDecoder().decode(yield* Stream.mkUint8Array(found.body))).toBe("hello world")
      const range = Option.getOrThrow(
        yield* object.getRange([{ project: "one" }, "hello.txt"], { offset: 6, length: 50 }),
      )
      expect(new TextDecoder().decode(yield* Stream.mkUint8Array(range.body))).toBe("world")
      yield* object.remove([{ project: "one" }, "hello.txt"])
      yield* object.remove([{ project: "one" }, "hello.txt"])
      expect(Option.isNone(yield* object.get([{ project: "one" }, "hello.txt"]))).toBe(true)
    }),
    signal,
  )
})

it("reads legacy file bytes without rewriting and applies the seven-day tool-output retention only", async ({
  signal,
}) => {
  await legacy("project/one/hello.txt", "legacy content", "text/plain")
  await legacy("tool-output/old", "expired")
  await legacy("tool-output/recent", "recent")
  const old = new Date(Date.now() - 8 * 86_400_000)
  await utimes(filename("tool-output/old"), old, old)
  await utimes(filename("project/one/hello.txt"), old, old)
  const original = await readFile(filename("project/one/hello.txt"))
  await run(
    Effect.gen(function* () {
      const { object } = yield* Storage.Service
      const entry = Option.getOrThrow(yield* object.get([{ project: "one" }, "hello.txt"]))
      expect(entry.metadata).toEqual({ contentType: "text/plain", contentLength: 14 })
      expect(new TextDecoder().decode(yield* Stream.mkUint8Array(entry.body))).toBe("legacy content")
      expect(Option.isNone(yield* object.get(["tool-output", "old"]))).toBe(true)
      expect(Option.isSome(yield* object.get(["tool-output", "recent"]))).toBe(true)
    }),
    signal,
  )
  expect(await readFile(filename("project/one/hello.txt"))).toEqual(original)
  expect((await readdir(directory)).sort()).toEqual(
    [path.basename(filename("project/one/hello.txt")), path.basename(filename("tool-output/recent"))].sort(),
  )
})

it("reports corrupt persisted headers as typed initialization failures", async ({ signal }) => {
  await writeFile(filename("broken"), Buffer.from([0, 0, 1, 0]))
  const error = await Effect.runPromise(Storage.Service.pipe(Effect.provide(layer()), Effect.flip), { signal })
  expect(error).toMatchObject({ _tag: "Storage.OperationError", operation: "init", providerID: "filesystem" })
  expect(error).toHaveProperty("cause")
  expect(error.message.length).toBeGreaterThan(0)
})

it("opens filesystem bodies only when consumed and owns each read separately", ({ signal }) =>
  run(
    Effect.gen(function* () {
      const { object } = yield* Storage.Service
      yield* object.set(["lazy"], { body: Stream.succeed(new TextEncoder().encode("content")) })
      const entry = Option.getOrThrow(yield* object.get(["lazy"]))
      expect(new TextDecoder().decode(yield* Stream.mkUint8Array(entry.body))).toBe("content")
      expect(new TextDecoder().decode(yield* Stream.mkUint8Array(entry.body))).toBe("content")
      const unread = Option.getOrThrow(yield* object.get(["lazy"]))
      yield* object.remove(["lazy"])
      expect(yield* Stream.mkUint8Array(unread.body).pipe(Effect.flip)).toMatchObject({
        _tag: "Storage.OperationError",
        operation: "get",
        providerID: "filesystem",
      })
    }),
    signal,
  ))

it("interrupts a streaming overwrite without leaving temporary files", ({ signal }) =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const { object } = yield* Storage.Service
        yield* object.set(["existing"], { body: Stream.succeed(new TextEncoder().encode("original")) })
        const started = yield* Deferred.make<void>()
        const source = Stream.concat(
          Stream.succeed(new Uint8Array(1024 * 1024)),
          Stream.fromEffect(Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))),
        )
        const fiber = yield* object.set(["existing"], { body: source }).pipe(Effect.forkScoped)
        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
        expect((yield* Effect.promise(() => readdir(directory))).filter((file) => file.endsWith(".tmp"))).toEqual([])
        const old = Option.getOrThrow(yield* object.get(["existing"]))
        expect(new TextDecoder().decode(yield* Stream.mkUint8Array(old.body))).toBe("original")
      }),
    ),
    signal,
  ))

it("reports corruption introduced after initialization at the get and list boundaries", ({ signal }) =>
  run(
    Effect.gen(function* () {
      const { object } = yield* Storage.Service
      yield* Effect.promise(() => writeFile(filename("broken"), Buffer.from([0, 0, 1, 0])))
      for (const [operation, effect] of [
        ["get", object.get(["broken"]).pipe(Effect.flip)],
        ["list", object.list(["broken"]).pipe(Effect.flip)],
      ] as const) {
        const error = yield* effect
        expect(error).toMatchObject({ _tag: "Storage.OperationError", operation, providerID: "filesystem" })
        expect(error).toHaveProperty("cause")
      }
    }),
    signal,
  ))
