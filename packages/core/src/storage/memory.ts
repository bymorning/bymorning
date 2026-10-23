import { Effect, Option, Ref, Stream } from "effect"
import { ID, OperationError } from "@bymorning/schema/storage"
import type { Driver, Metadata, Path, Provider, RangeInput, SetInput } from "../storage.js"
import { serializePath } from "./path.js"

interface StoredEntry {
  readonly metadata: Metadata
  readonly body: Uint8Array
}
const id = ID.make("memory")
const failure = (operation: OperationError["operation"], cause: unknown) =>
  new OperationError({ message: `Memory storage ${operation} failed`, providerID: id, operation, cause })

/** A fresh in-memory provider for each Application acquisition. */
export const memory = (): Provider => ({
  id,
  name: "Memory",
  open: Effect.gen(function* () {
    const entries = yield* Ref.make<ReadonlyMap<string, StoredEntry>>(new Map())
    const set = Effect.fn("Storage.Memory.set")(function* (path: Path, input: SetInput) {
      const serialized = yield* serializePath(path)
      const body = serialized.marker
        ? new Uint8Array()
        : yield* Stream.mkUint8Array(input.body).pipe(Effect.mapError((cause) => failure("set", cause)))
      const stored = new Uint8Array(body)
      yield* Ref.update(entries, (current) =>
        new Map(current).set(serialized.key, {
          metadata: { contentType: input.contentType, contentLength: stored.length },
          body: stored,
        }),
      )
    })
    const read = Effect.fn("Storage.Memory.get")(function* (path: Path, range?: RangeInput) {
      const serialized = yield* serializePath(path)
      if (
        range !== undefined &&
        (!Number.isSafeInteger(range.offset) ||
          range.offset < 0 ||
          !Number.isSafeInteger(range.length) ||
          range.length < 0)
      )
        return yield* failure("get", new Error("Invalid byte range"))
      const entry = (yield* Ref.get(entries)).get(serialized.key)
      if (entry === undefined) return Option.none()
      return Option.some({
        metadata: entry.metadata,
        body: Stream.succeed(
          new Uint8Array(
            range === undefined ? entry.body : entry.body.slice(range.offset, range.offset + range.length),
          ),
        ),
      })
    })
    const list = Effect.fn("Storage.Memory.list")(function* (prefix: Path) {
      const serialized = yield* serializePath(prefix)
      return [...(yield* Ref.get(entries)).entries()]
        .filter(([key]) => key.startsWith(serialized.key))
        .map(([key, entry]) => ({
          key,
          metadata: { contentLength: entry.metadata.contentLength, etag: entry.metadata.etag },
          marker: key.endsWith("/"),
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    })
    const remove = Effect.fn("Storage.Memory.remove")(function* (path: Path) {
      const serialized = yield* serializePath(path)
      yield* Ref.update(entries, (current) => {
        const next = new Map(current)
        next.delete(serialized.key)
        return next
      })
    })
    return {
      init: Effect.void,
      set,
      get: (path) => read(path),
      getRange: (path, range) => read(path, range),
      list,
      remove,
    } satisfies Driver
  }),
})
