/**
 * The Storage.Provider contract as one parameterised suite. Every provider
 * (filesystem, memory, S3, Azure Blob) registers the same cases against a fresh,
 * empty provider per case, so key encoding, marker semantics, range reads,
 * listing order, removal, and failure typing match byte for byte across
 * implementations. Provider-specific behaviour (client ownership, destination
 * failures, transport observation) stays in the owning package's tests.
 */
export * as StorageContract from "./storage.js"

import { Storage } from "@bymorning/core/storage"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option, Scope, Stream } from "effect"
import { describe, expect } from "vitest"

/** Acquire one fresh, empty provider for a single case; owned resources close with the case scope. */
export type Open = Effect.Effect<Storage.Provider, unknown, Scope.Scope>

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const text = (value: string) => Stream.succeed(encoder.encode(value))
const read = (entry: Storage.Entry) => Effect.map(Stream.mkUint8Array(entry.body), (bytes) => decoder.decode(bytes))

/** Register the Storage.Provider contract cases for one implementation. */
export const run = (name: string, open: Open): void => {
  const configured = (provider: Storage.Provider) =>
    Storage.layer({
      configure: (editor) => {
        editor.add(provider)
        editor.default.set(provider.id)
      },
    })
  // Every case goes through Storage.layer so init and the public object surface are exercised.
  const withStorage = <A, E, R>(body: (object: Storage.Object, provider: Storage.Provider) => Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const provider = yield* open
      return yield* Storage.Service.pipe(
        Effect.flatMap(({ object }) => body(object, provider)),
        Effect.provide(configured(provider)),
      )
    })

  describe(`Storage.Provider contract: ${name}`, () => {
    it.live("roundtrips multi-chunk binary and text with metadata and overwrite semantics", () =>
      withStorage((object) =>
        Effect.gen(function* () {
          yield* object.set(["text.txt"], {
            body: Stream.make(encoder.encode("hello "), encoder.encode("world")),
            contentType: "text/plain",
          })
          yield* object.set(["binary.bin"], {
            body: Stream.make(new Uint8Array([0, 1]), new Uint8Array([254, 255])),
            contentLength: 4,
            contentType: "application/octet-stream",
          })
          const found = Option.getOrThrow(yield* object.get(["text.txt"]))
          expect(yield* read(found)).toBe("hello world")
          expect(found.metadata).toMatchObject({ contentLength: 11, contentType: "text/plain" })
          const binary = Option.getOrThrow(yield* object.get(["binary.bin"]))
          expect([...(yield* Stream.mkUint8Array(binary.body))]).toEqual([0, 1, 254, 255])
          expect(binary.metadata.contentLength).toBe(4)
          yield* object.set(["text.txt"], { body: text("new"), contentType: "text/markdown" })
          const replaced = Option.getOrThrow(yield* object.get(["text.txt"]))
          expect(yield* read(replaced)).toBe("new")
          expect(replaced.metadata).toMatchObject({ contentLength: 3, contentType: "text/markdown" })
        }),
      ),
    )

    it.live("encodes keys byte for byte: segments join with slashes and a trailing named pair is a marker", () =>
      withStorage((object) =>
        Effect.gen(function* () {
          const paths: ReadonlyArray<readonly [Storage.Path, string, boolean]> = [
            [["root", "a"], "root/a", false],
            [["root", { project: "p1" }, "file.txt"], "root/project/p1/file.txt", false],
            [["root", { project: "p1" }], "root/project/p1/", true],
            [["root", { project: "p1" }, { folder: "f" }], "root/project/p1/folder/f/", true],
            [["root", "x", { y: "z" }, "w"], "root/x/y/z/w", false],
            [["root", "B"], "root/B", false],
            [["root", "a-1"], "root/a-1", false],
            [["root", "a0"], "root/a0", false],
          ]
          for (const [path, key, marker] of paths) {
            expect(yield* Storage.key(path)).toBe(key)
            yield* object.set(path, { body: marker ? Stream.fail("marker body must not be consumed") : text(key) })
          }
          // Recursive listing returns every key beneath the prefix in code-unit order with marker flags.
          expect((yield* object.list(["root"])).map(({ key, marker }) => [key, marker])).toEqual([
            ["root/B", false],
            ["root/a", false],
            ["root/a-1", false],
            ["root/a0", false],
            ["root/project/p1/", true],
            ["root/project/p1/file.txt", false],
            ["root/project/p1/folder/f/", true],
            ["root/x/y/z/w", false],
          ])
          // A named-pair prefix lists only its own subtree.
          expect((yield* object.list(["root", { project: "p1" }])).map(({ key }) => key)).toEqual([
            "root/project/p1/",
            "root/project/p1/file.txt",
            "root/project/p1/folder/f/",
          ])
          expect((yield* object.list(["root", { project: "p1" }, { folder: "f" }])).map(({ key }) => key)).toEqual([
            "root/project/p1/folder/f/",
          ])
        }),
      ),
    )

    it.live("roundtrips keys whose segments contain special characters", () =>
      withStorage((object) =>
        Effect.gen(function* () {
          const segments = [
            "sp ace",
            "plus+sign",
            "percent%25encoded",
            "unicode-ünï-✓",
            "symbols-!$&'()*,;=:@",
            "dots.in.name",
            "question?mark",
            "hash#tag",
            "tilde~and`backtick",
          ]
          for (const segment of segments) {
            const path = ["special", { [segment]: segment }, segment]
            const key = `special/${segment}/${segment}/${segment}`
            expect(yield* Storage.key(path)).toBe(key)
            yield* object.set(path, { body: text(key), contentType: "text/plain" })
            const found = Option.getOrThrow(yield* object.get(path))
            expect(yield* read(found)).toBe(key)
            expect(found.metadata.contentLength).toBe(encoder.encode(key).length)
            const window = Option.getOrThrow(yield* object.getRange(path, { offset: 8, length: 3 }))
            expect(yield* read(window)).toBe(key.slice(8, 11))
          }
          const listed = yield* object.list(["special"])
          expect(listed.map(({ key }) => key)).toEqual(
            segments.map((segment) => `special/${segment}/${segment}/${segment}`).sort(),
          )
          expect(listed.every(({ marker }) => !marker)).toBe(true)
          for (const segment of segments) {
            yield* object.remove(["special", { [segment]: segment }, segment])
            expect(Option.isNone(yield* object.get(["special", { [segment]: segment }, segment]))).toBe(true)
          }
          expect(yield* object.list(["special"])).toEqual([])
        }),
      ),
    )

    it.live("keeps markers empty, recursively lists sorted prefixes, and removes idempotently", () =>
      withStorage((object) =>
        Effect.gen(function* () {
          yield* object.set([{ project: "one" }], { body: Stream.fail("marker body must not be consumed") })
          yield* object.set([{ project: "one" }, "z"], { body: text("z") })
          yield* object.set([{ project: "one" }, { folder: "nested" }, "a"], { body: text("abc") })
          yield* object.set([{ project: "other" }, "hidden"], { body: Stream.empty })
          const marker = Option.getOrThrow(yield* object.get([{ project: "one" }]))
          expect((yield* Stream.mkUint8Array(marker.body)).length).toBe(0)
          expect(marker.metadata.contentLength).toBe(0)
          expect(
            (yield* object.list([{ project: "one" }])).map(({ key, marker, metadata }) => [
              key,
              marker,
              metadata.contentLength,
            ]),
          ).toEqual([
            ["project/one/", true, 0],
            ["project/one/folder/nested/a", false, 3],
            ["project/one/z", false, 1],
          ])
          expect(Option.isNone(yield* object.get(["missing"]))).toBe(true)
          yield* object.remove([{ project: "one" }, "z"])
          yield* object.remove([{ project: "one" }, "z"])
          expect(Option.isNone(yield* object.get([{ project: "one" }, "z"]))).toBe(true)
        }),
      ),
    )

    it.live("stores markers as zero bytes regardless of body and distinguishes them from empty objects", () =>
      withStorage((object) =>
        Effect.gen(function* () {
          yield* object.set([{ project: "one" }], { body: text("ignored"), contentType: "text/plain" })
          const marker = Option.getOrThrow(yield* object.get([{ project: "one" }]))
          expect((yield* Stream.mkUint8Array(marker.body)).length).toBe(0)
          expect(marker.metadata.contentLength).toBe(0)
          const window = Option.getOrThrow(yield* object.getRange([{ project: "one" }], { offset: 0, length: 10 }))
          expect((yield* Stream.mkUint8Array(window.body)).length).toBe(0)
          expect(window.metadata.contentLength).toBe(0)
          // Rewriting a marker keeps it a marker.
          yield* object.set([{ project: "one" }], { body: text("again") })
          // An empty object at a string-terminal path is an object, not a marker.
          yield* object.set([{ project: "one" }, "empty"], { body: Stream.empty })
          const empty = Option.getOrThrow(yield* object.get([{ project: "one" }, "empty"]))
          expect((yield* Stream.mkUint8Array(empty.body)).length).toBe(0)
          expect(
            (yield* object.list([{ project: "one" }])).map(({ key, marker, metadata }) => [
              key,
              marker,
              metadata.contentLength,
            ]),
          ).toEqual([
            ["project/one/", true, 0],
            ["project/one/empty", false, 0],
          ])
          yield* object.remove([{ project: "one" }])
          yield* object.remove([{ project: "one" }])
          expect(Option.isNone(yield* object.get([{ project: "one" }]))).toBe(true)
          expect((yield* object.list([{ project: "one" }])).map(({ key }) => key)).toEqual(["project/one/empty"])
        }),
      ),
    )

    it.live("treats missing objects as absent and lists only the exact prefix subtree", () =>
      withStorage((object) =>
        Effect.gen(function* () {
          expect(Option.isNone(yield* object.get(["missing"]))).toBe(true)
          expect(Option.isNone(yield* object.getRange(["missing"], { offset: 0, length: 1 }))).toBe(true)
          expect(yield* object.list(["missing"])).toEqual([])
          yield* object.remove(["missing"])
          yield* object.remove([{ project: "missing" }])
          yield* object.set([{ project: "one" }, "x"], { body: text("x") })
          yield* object.set([{ project: "one-more" }, "x"], { body: text("x") })
          yield* object.set([{ project: "on" }, "x"], { body: text("x") })
          expect((yield* object.list([{ project: "one" }])).map(({ key }) => key)).toEqual(["project/one/x"])
          expect((yield* object.list([{ project: "on" }])).map(({ key }) => key)).toEqual(["project/on/x"])
          expect(Option.isNone(yield* object.get([{ project: "one" }]))).toBe(true)
        }),
      ),
    )

    it.live("clamps ranges, retains whole-object metadata, and rejects invalid numeric ranges", () =>
      withStorage((object, provider) =>
        Effect.gen(function* () {
          yield* object.set(["range"], { body: text("0123456789"), contentType: "text/plain" })
          for (const [offset, length, expected] of [
            [0, 10, "0123456789"],
            [0, 11, "0123456789"],
            [3, 4, "3456"],
            [8, 20, "89"],
            [9, 1, "9"],
            [10, 1, ""],
            [20, 2, ""],
            [0, 0, ""],
            [4, 0, ""],
          ] as const) {
            const entry = Option.getOrThrow(yield* object.getRange(["range"], { offset, length }))
            expect(yield* read(entry)).toBe(expected)
            expect(entry.metadata).toMatchObject({ contentLength: 10, contentType: "text/plain" })
          }
          expect(Option.isNone(yield* object.getRange(["missing"], { offset: 0, length: 1 }))).toBe(true)
          for (const input of [
            { offset: -1, length: 1 },
            { offset: 0, length: -1 },
            { offset: NaN, length: 1 },
            { offset: 0, length: Infinity },
            { offset: 0.5, length: 1 },
          ]) {
            const error = yield* object.getRange(["range"], input).pipe(Effect.flip)
            expect(error).toMatchObject({ _tag: "Storage.OperationError", providerID: provider.id, operation: "get" })
            expect(error).toHaveProperty("cause")
            expect(error.message.length).toBeGreaterThan(0)
          }
        }),
      ),
    )

    it.live("preserves existing content after a source failure and does not publish partial new objects", () =>
      withStorage((object, provider) =>
        Effect.gen(function* () {
          yield* object.set(["existing"], { body: text("original") })
          for (const key of ["existing", "new"]) {
            const error = yield* object
              .set([key], { body: Stream.concat(Stream.succeed(new Uint8Array([1, 2])), Stream.fail("source failed")) })
              .pipe(Effect.flip)
            expect(error).toMatchObject({ _tag: "Storage.OperationError", providerID: provider.id, operation: "set" })
            expect(error).toHaveProperty("cause")
            expect(error.message.length).toBeGreaterThan(0)
          }
          const old = Option.getOrThrow(yield* object.get(["existing"]))
          expect(yield* read(old)).toBe("original")
          expect(Option.isNone(yield* object.get(["new"]))).toBe(true)
        }),
      ),
    )

    it.live(
      "interrupts a stalled producer, releasing the source without publishing new or replaced bytes",
      () =>
        withStorage((object) =>
          Effect.gen(function* () {
            yield* object.set(["existing"], { body: text("original") })
            for (const key of ["existing", "new"]) {
              const started = yield* Deferred.make<void>()
              let released = false
              const source = Stream.concat(
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
              const upload = yield* object.set([key], { body: source }).pipe(Effect.forkScoped)
              yield* Deferred.await(started)
              yield* Fiber.interrupt(upload)
              expect(released).toBe(true)
            }
            const old = Option.getOrThrow(yield* object.get(["existing"]))
            expect(yield* read(old)).toBe("original")
            expect(Option.isNone(yield* object.get(["new"]))).toBe(true)
          }).pipe(Effect.scoped),
        ),
      20_000,
    )

    it.live("reports invalid paths at the public boundary for every object operation", () =>
      withStorage((object) =>
        Effect.gen(function* () {
          const invalid: ReadonlyArray<readonly [Storage.Path, Storage.InvalidPathError["reason"], number]> = [
            [[], "empty", -1],
            [[""], "segment", 0],
            [["."], "segment", 0],
            [[".."], "segment", 0],
            [["a/b"], "segment", 0],
            [["ok", "../escape"], "segment", 1],
            [[{ "a/b": "c" }], "segment", 0],
            [[{ a: "" }], "segment", 0],
            [["ok", { a: "1", b: "2" }], "object", 1],
            [[{}], "object", 0],
          ]
          for (const [path, reason, index] of invalid) {
            for (const effect of [
              object.get(path),
              object.getRange(path, { offset: 0, length: 1 }),
              object.set(path, { body: Stream.fail("must not be consumed") }),
              object.list(path),
              object.remove(path),
            ]) {
              expect(yield* effect.pipe(Effect.flip)).toMatchObject({
                _tag: "Storage.InvalidPathError",
                reason,
                index,
              })
            }
          }
        }),
      ),
    )

    it.live(
      "lists across the continuation boundary in stable order",
      () =>
        withStorage((object) =>
          Effect.gen(function* () {
            const keys = Array.from({ length: 1005 }, (_, index) => `entry-${String(index).padStart(4, "0")}`)
            yield* Effect.forEach(keys, (key) => object.set(["page", key], { body: Stream.empty }), {
              concurrency: 24,
              discard: true,
            })
            expect((yield* object.list(["page"])).map((item) => item.key)).toEqual(keys.map((key) => `page/${key}`))
          }),
        ),
      30_000,
    )
  })
}
