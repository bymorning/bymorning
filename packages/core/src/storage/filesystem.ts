import { Storage } from "../storage.js"
import { Effect, Option, Schema, Stream } from "effect"
import { createReadStream } from "node:fs"
import { mkdir, open, readdir, rename, rm } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"

const Header = Schema.Struct({ key: Schema.String, contentType: Schema.optionalKey(Schema.String) })
const decodeHeader = Schema.decodeUnknownEffect(Schema.fromJsonString(Header))
const failure = (operation: Storage.OperationError["operation"], cause: unknown) =>
  new Storage.OperationError({
    message: `Filesystem storage ${operation} failed`,
    providerID: Storage.ID.make("filesystem"),
    operation,
    cause,
  })
const missing = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT"

/** Persistent filesystem objects using the existing atomic file format. */
export const filesystem = (config: {
  readonly directory: string
  readonly toolOutputDays?: number
}): Storage.Provider => ({
  id: Storage.ID.make("filesystem"),
  name: "Filesystem",
  open: Effect.sync(() => {
    const directory = path.resolve(config.directory)
    const filename = (key: string) => path.join(directory, `${createHash("sha256").update(key).digest("hex")}.object`)
    const inspect = (file: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Effect.acquireRelease(
            Effect.tryPromise(() => open(file, "r")),
            (handle) => Effect.promise(() => handle.close()),
          )
          const size = Buffer.alloc(4)
          yield* Effect.tryPromise(() => handle.read(size, 0, 4, 0))
          const length = size.readUInt32BE()
          const info = yield* Effect.tryPromise(() => handle.stat())
          if (length > info.size - 4) return yield* failure("get", new Error("Invalid stored object header"))
          const header = Buffer.alloc(length)
          yield* Effect.tryPromise(() => handle.read(header, 0, length, 4))
          return {
            header: yield* decodeHeader(header.toString()),
            offset: length + 4,
            size: info.size - length - 4,
            modified: info.mtimeMs,
          }
        }),
      )
    const init = Effect.gen(function* () {
      yield* Effect.tryPromise(() => mkdir(directory, { recursive: true }))
      const files = yield* Effect.tryPromise(() => readdir(directory))
      yield* Effect.forEach(
        files.filter((file) => file.endsWith(".object")),
        (file) =>
          Effect.gen(function* () {
            const info = yield* inspect(path.join(directory, file))
            if (
              info.header.key.startsWith("tool-output/") &&
              info.modified < Date.now() - (config.toolOutputDays ?? 7) * 86_400_000
            ) {
              yield* Effect.tryPromise(() => rm(path.join(directory, file), { force: true }))
            }
          }),
        { discard: true },
      )
    }).pipe(Effect.mapError((cause) => failure("init", cause)))
    const set = Effect.fn("FileStorage.set")(function* (keyPath: Storage.Path, input: Storage.SetInput) {
      const key = yield* Storage.key(keyPath)
      const header = Buffer.from(
        JSON.stringify({ key, ...(input.contentType === undefined ? {} : { contentType: input.contentType }) }),
      )
      const prefix = Buffer.alloc(4)
      prefix.writeUInt32BE(header.length)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const temporary = `${filename(key)}.${randomUUID()}.tmp`
          yield* Effect.addFinalizer(() => Effect.promise(() => rm(temporary, { force: true })))
          yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* Effect.acquireRelease(
                Effect.tryPromise(() => open(temporary, "wx", 0o600)),
                (handle) => Effect.promise(() => handle.close()),
              )
              yield* Effect.tryPromise(() => handle.writeFile(Buffer.concat([prefix, header])))
              if (!key.endsWith("/"))
                yield* input.body.pipe(Stream.runForEach((chunk) => Effect.tryPromise(() => handle.writeFile(chunk))))
            }),
          )
          yield* Effect.tryPromise(() => rename(temporary, filename(key)))
        }),
      ).pipe(Effect.mapError((cause) => failure("set", cause)))
    })
    const read = Effect.fn("FileStorage.get")(function* (keyPath: Storage.Path, range?: Storage.RangeInput) {
      const key = yield* Storage.key(keyPath)
      if (
        range !== undefined &&
        (!Number.isSafeInteger(range.offset) ||
          range.offset < 0 ||
          !Number.isSafeInteger(range.length) ||
          range.length < 0)
      )
        return yield* failure("get", new Error("Invalid byte range"))
      const found = yield* inspect(filename(key)).pipe(
        Effect.map(Option.some),
        Effect.catch((cause) =>
          missing(cause.cause ?? cause) ? Effect.succeed(Option.none()) : Effect.fail(failure("get", cause)),
        ),
      )
      if (Option.isNone(found)) return Option.none()
      const info = found.value
      const offset = range?.offset ?? 0
      const length = Math.min(range?.length ?? info.size, info.size - offset)
      return Option.some({
        metadata: { contentType: info.header.contentType, contentLength: info.size },
        body:
          length <= 0
            ? Stream.empty
            : Stream.suspend(() =>
                Stream.fromAsyncIterable(
                  createReadStream(filename(key), {
                    start: info.offset + offset,
                    end: info.offset + offset + length - 1,
                  }),
                  (cause) => failure("get", cause),
                ),
              ),
      })
    })
    const remove = Effect.fn("FileStorage.remove")(function* (keyPath: Storage.Path) {
      const key = yield* Storage.key(keyPath)
      yield* Effect.tryPromise({
        try: () => rm(filename(key), { force: true }),
        catch: (cause) => failure("remove", cause),
      })
    })
    const list = Effect.fn("FileStorage.list")(function* (keyPath: Storage.Path) {
      const key = yield* Storage.key(keyPath)
      return yield* Effect.gen(function* () {
        const files = yield* Effect.tryPromise(() => readdir(directory))
        const entries = yield* Effect.forEach(
          files.filter((file) => file.endsWith(".object")),
          (file) => inspect(path.join(directory, file)),
        )
        return entries
          .filter((entry) => entry.header.key.startsWith(key))
          .map((entry) => ({
            key: entry.header.key,
            marker: entry.header.key.endsWith("/"),
            metadata: { contentLength: entry.size },
          }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      }).pipe(Effect.mapError((cause) => failure("list", cause)))
    })
    return {
      init,
      set,
      get: (key) => read(key),
      getRange: (key, range) => read(key, range),
      remove,
      list,
    } satisfies Storage.Driver
  }),
})
