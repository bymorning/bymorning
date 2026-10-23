import { Storage } from "@bymorning/core/storage"
import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option, Stream } from "effect"

const layer = (provider: Storage.Provider) =>
  Storage.layer({
    configure: (editor) => {
      editor.add(provider)
      editor.default.set(provider.id)
    },
  })

describe("Storage registry and lifecycle", () => {
  it.effect("encodes named paths and rejects unsafe or ambiguous segments", () =>
    Effect.gen(function* () {
      expect(yield* Storage.key([{ workspaces: "one" }, { projects: "two" }, "file.txt"])).toBe(
        "workspaces/one/projects/two/file.txt",
      )
      expect(yield* Storage.key([{ workspaces: "one" }])).toBe("workspaces/one/")
      const paths: Storage.Path[] = [[], [{ a: "one", b: "two" }], [".."], ["a/b"]]
      const errors = yield* Effect.all(paths.map((path) => Storage.key(path).pipe(Effect.flip)))
      expect(errors.map((error) => error.reason)).toEqual(["empty", "object", "segment", "segment"])
    }),
  )

  it.effect("overrides the default, sorts secret-free inventory, and opens only the selected provider", () =>
    Effect.gen(function* () {
      const events: string[] = []
      const selected: Storage.Provider = {
        id: Storage.ID.make("a"),
        name: "Selected",
        open: Effect.gen(function* () {
          events.push("open")
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              events.push("close")
            }),
          )
          const driver = yield* Storage.memory().open
          return {
            ...driver,
            init: Effect.sync(() => {
              events.push("init")
            }),
          }
        }),
      }
      const unused: Storage.Provider = {
        id: Storage.ID.make("z"),
        name: "Unused",
        open: Effect.die("unselected provider opened"),
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Service
          expect(events).toEqual(["open", "init"])
          expect(yield* storage.default()).toEqual({ id: "a", name: "Selected" })
          expect(yield* storage.list()).toEqual([
            { id: "a", name: "Selected" },
            { id: "z", name: "Unused" },
          ])
          yield* storage.list()
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              events.push("consumer close")
            }),
          )
        }),
      ).pipe(
        Effect.provide(
          Storage.layer({
            configure: (editor) => {
              expect(editor.default.get()).toBeUndefined()
              editor.add(unused)
              editor.add(selected)
              editor.default.set(unused.id)
              expect(editor.default.get()).toBe(unused.id)
            },
            selection: selected.id,
          }),
        ),
      )
      expect(events).toEqual(["open", "init", "consumer close", "close"])
    }),
  )

  for (const reason of ["default", "unknown", "duplicate"] as const) {
    it.effect(`rejects ${reason} configuration before acquisition, including explicit selection`, () =>
      Effect.gen(function* () {
        const provider: Storage.Provider = {
          id: Storage.ID.make("test"),
          name: "Test",
          open: Effect.die("invalid registry acquired"),
        }
        for (const selection of [undefined, provider.id]) {
          if (reason === "unknown" && selection !== undefined) continue
          const error = yield* Storage.Service.pipe(
            Effect.provide(
              Storage.layer({
                selection,
                configure: (editor) => {
                  editor.add(provider)
                  if (reason === "unknown") editor.default.set(Storage.ID.make("absent"))
                  if (reason === "duplicate") {
                    editor.add(provider)
                    editor.default.set(provider.id)
                  }
                },
              }),
            ),
            Effect.flip,
          )
          expect(error).toMatchObject({ _tag: "Storage.ConfigError", reason })
          if (reason !== "default") expect(error).toHaveProperty("providerID", reason === "unknown" ? "absent" : "test")
        }
      }),
    )
  }

  it.effect("allows an explicit selection to override an unavailable default", () =>
    Effect.gen(function* () {
      const provider = Storage.memory()
      const storage = yield* Storage.Service.pipe(
        Effect.provide(
          Storage.layer({
            selection: provider.id,
            configure: (editor) => {
              editor.add(provider)
              editor.default.set(Storage.ID.make("s3"))
            },
          }),
        ),
      )
      expect(yield* storage.default()).toEqual({ id: provider.id, name: provider.name })
    }),
  )

  it.effect("rejects an unknown explicit selection", () =>
    Effect.gen(function* () {
      const provider = Storage.memory()
      const error = yield* Storage.Service.pipe(
        Effect.provide(
          Storage.layer({
            selection: Storage.ID.make("absent"),
            configure: (editor) => {
              editor.add(provider)
              editor.default.set(provider.id)
            },
          }),
        ),
        Effect.flip,
      )
      expect(error).toMatchObject({ _tag: "Storage.ConfigError", reason: "unknown", providerID: "absent" })
    }),
  )

  it.effect("snapshots the editor before opening and ignores retained-editor mutations", () =>
    Effect.gen(function* () {
      const opened = yield* Deferred.make<Storage.Editor>()
      const proceed = yield* Deferred.make<void>()
      let captured: Storage.Editor | undefined
      const provider = Storage.memory()
      const selected: Storage.Provider = {
        ...provider,
        open: Effect.gen(function* () {
          if (captured === undefined) return yield* Effect.die("missing editor")
          yield* Deferred.succeed(opened, captured)
          yield* Deferred.await(proceed)
          return yield* provider.open
        }),
      }
      const extra: Storage.Provider = { id: Storage.ID.make("extra"), name: "Extra", open: Effect.die("extra opened") }
      const fiber = yield* Effect.gen(function* () {
        const storage = yield* Storage.Service
        expect(yield* storage.list()).toEqual([{ id: provider.id, name: provider.name }])
        expect(yield* storage.default()).toEqual({ id: provider.id, name: provider.name })
        captured?.add(extra)
        captured?.default.set(extra.id)
        expect(yield* storage.list()).toEqual([{ id: provider.id, name: provider.name }])
        expect(yield* storage.default()).toEqual({ id: provider.id, name: provider.name })
      }).pipe(
        Effect.provide(
          Storage.layer({
            configure: (editor) => {
              captured = editor
              editor.add(selected)
              editor.default.set(selected.id)
            },
          }),
        ),
        Effect.forkScoped,
      )
      const editor = yield* Deferred.await(opened)
      editor.add(extra)
      editor.default.set(extra.id)
      yield* Deferred.succeed(proceed, undefined)
      yield* Fiber.join(fiber)
    }).pipe(Effect.scoped),
  )

  it.effect("releases resources when selected initialization fails", () =>
    Effect.gen(function* () {
      const events: string[] = []
      const failure = new Storage.OperationError({
        message: "init failed",
        providerID: Storage.ID.make("test"),
        operation: "init",
        cause: "unavailable",
      })
      const provider: Storage.Provider = {
        id: Storage.ID.make("test"),
        name: "Test",
        open: Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              events.push("close")
            }),
          )
          const driver = yield* Storage.memory().open
          return { ...driver, init: Effect.fail(failure) }
        }),
      }
      expect(yield* Storage.Service.pipe(Effect.provide(layer(provider)), Effect.flip)).toBe(failure)
      expect(events).toEqual(["close"])
    }),
  )

  it.effect("allocates independent memory for every acquisition of the same factory and layer", () =>
    Effect.gen(function* () {
      const shared = layer(Storage.memory())
      yield* Effect.gen(function* () {
        const storage = yield* Storage.Service
        yield* storage.object.set(["private"], { body: Stream.succeed(new Uint8Array([1])) })
        expect(Option.isSome(yield* storage.object.get(["private"]))).toBe(true)
      }).pipe(Effect.provide(shared))
      yield* Effect.gen(function* () {
        const storage = yield* Storage.Service
        expect(Option.isNone(yield* storage.object.get(["private"]))).toBe(true)
      }).pipe(Effect.provide(shared))
    }),
  )
})
