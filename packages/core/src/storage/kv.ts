export * as StorageKV from "./kv.js"

import { Effect, Option, Schema, Stream } from "effect"
import { DecodeError, InputError, OperationError, type ID } from "@bymorning/schema/storage"
import type { KV, Namespace, Object as StorageObject, ScanInput } from "../storage.js"
import { serializePath } from "./path.js"

/** Bind the established Workspace/Plugin namespace to JSON operations. */
export const make = (namespace: Namespace, storage: StorageObject, providerID: ID): KV => {
  const prefix = [
    "workspace",
    { id: encode(namespace.workspaceID) },
    "plugin",
    { id: encode(namespace.pluginID) },
    "key",
  ] as const
  const path = (key: string) => [...prefix, encode(key)]
  const invalid = (operation: OperationError["operation"]) =>
    Effect.mapError((cause: import("@bymorning/schema/storage").InvalidPathError | OperationError) =>
      cause._tag === "Storage.OperationError"
        ? cause
        : new OperationError({ message: "Invalid encoded storage namespace", providerID, operation, cause }),
    )
  const decode = (body: Uint8Array) =>
    Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(body),
      catch: () => new DecodeError({ message: "Stored value is not valid UTF-8 JSON", providerID }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))),
      Effect.mapError(() => new DecodeError({ message: "Stored value is not valid JSON", providerID })),
    )
  const get = Effect.fn("Storage.KV.get")(function* (key: string) {
    const entry = yield* storage.get(path(key)).pipe(invalid("get"))
    if (Option.isNone(entry)) return undefined
    return yield* decode(yield* Stream.mkUint8Array(entry.value.body))
  })
  const set = Effect.fn("Storage.KV.set")(function* (key: string, value: Schema.Json) {
    const json = yield* Effect.try({
      try: () => {
        // Reject runtime values that JSON.stringify would silently omit or coerce.
        return JSON.stringify(parseJson(value, new Set()))
      },
      catch: () => new InputError({ message: "Storage value must be JSON", operation: "set", reason: "json" }),
    })
    yield* storage
      .set(path(key), { body: Stream.succeed(new TextEncoder().encode(json)), contentType: "application/json" })
      .pipe(invalid("set"))
  })
  const remove = Effect.fn("Storage.KV.remove")((key: string) => storage.remove(path(key)).pipe(invalid("remove")))
  const scan = Effect.fn("Storage.KV.scan")(function* (input: ScanInput) {
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit <= 0))
      return yield* new InputError({
        message: "Storage scan limit must be a positive safe integer",
        operation: "scan",
        reason: "limit",
      })
    const base = `${(yield* serializePath(prefix).pipe(invalid("list"))).key}/`
    const items = yield* storage.list(prefix).pipe(invalid("list"))
    const keys = items
      .filter((item) => item.key.startsWith(base) && !item.marker)
      .map((item) => decodeKey(item.key.slice(base.length)))
      .filter((key) => key.startsWith(input.prefix) && (input.after === undefined || key > input.after))
      .sort()
    const selected = keys.slice(0, input.limit)
    const entries = (yield* Effect.forEach(selected, (key) =>
      get(key).pipe(Effect.map((value) => (value === undefined ? undefined : { key, value }))),
    )).filter((entry) => entry !== undefined)
    const next = entries.at(-1)?.key
    return input.limit !== undefined && keys.length > input.limit && next !== undefined
      ? { entries, next }
      : { entries }
  })
  return { get, set, remove, scan }
}

// Retain the deployed namespace and JSON-key encoding byte-for-byte.
const encode = (value: string) =>
  Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("") || "00"
const decodeKey = (value: string) =>
  value === "00"
    ? ""
    : new TextDecoder().decode(Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)))

function parseJson(value: unknown, parents: Set<object>): Schema.Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "object" || value === null || parents.has(value)) throw new Error("Invalid JSON")
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error("Invalid JSON object")
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) throw new Error("Invalid JSON key")
  if ("toJSON" in value && typeof value.toJSON === "function") throw new Error("Custom JSON conversion is unsupported")
  parents.add(value)
  // Snapshot values once so getters cannot change the value between parsing and encoding.
  const parsed = Array.isArray(value)
    ? Array.from(value, (child) => parseJson(child, parents))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, parseJson(child, parents)]))
  parents.delete(value)
  return parsed
}
