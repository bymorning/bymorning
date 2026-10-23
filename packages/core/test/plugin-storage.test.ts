import { describe, expect, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { Workspace } from "@bymorning/schema/workspace"
import { Storage } from "../src/storage.js"

const layer = Storage.layer({
  configure: (editor) => {
    const provider = Storage.memory()
    editor.add(provider)
    editor.default.set(provider.id)
  },
})

describe("Storage.scope", () => {
  it.effect("reads deployed namespace keys and preserves JSON bytes on replacement", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const scoped = storage.scope({ workspaceID: Workspace.ID.make("wrk_storage"), pluginID: "scan" })
      // These are the deployed hex segments for wrk_storage, scan, and prefix/a.
      const legacy = [
        "workspace",
        { id: "77726b5f73746f72616765" },
        "plugin",
        { id: "7363616e" },
        "key",
        "7072656669782f61",
      ]
      yield* storage.object.set(legacy, {
        body: Stream.succeed(new TextEncoder().encode('{"page":3}')),
        contentType: "application/json",
      })
      expect(yield* scoped.get("prefix/a")).toEqual({ page: 3 })
      expect(yield* scoped.scan({ prefix: "prefix/" })).toEqual({ entries: [{ key: "prefix/a", value: { page: 3 } }] })

      yield* scoped.set("prefix/a", { page: 4 })
      const entry = yield* storage.object.get(legacy)
      expect(entry._tag).toBe("Some")
      if (entry._tag === "Some") {
        expect(entry.value.metadata.contentType).toBe("application/json")
        expect(new TextDecoder().decode(yield* Stream.mkUint8Array(entry.value.body))).toBe('{"page":4}')
      }
    }).pipe(Effect.provide(layer)),
  )

  it.effect("round-trips empty, Unicode, and separator keys through scans", () =>
    Effect.gen(function* () {
      const storage = (yield* Storage.Service).scope({
        workspaceID: Workspace.ID.make("wrk_storage"),
        pluginID: "日本/插件",
      })
      const keys = ["", "日本/😀", "a/b", "a\\b", "%2f", "a:b", "../value"]
      for (const key of keys) yield* storage.set(key, { key })
      expect(yield* storage.scan({ prefix: "" })).toEqual({
        entries: keys.toSorted().map((key) => ({ key, value: { key } })),
      })
      for (const key of keys) expect(yield* storage.get(key)).toEqual({ key })
    }).pipe(Effect.provide(layer)),
  )

  it.effect("reports malformed stored JSON through the typed decoding channel", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const scoped = storage.scope({ workspaceID: Workspace.ID.make("wrk_storage"), pluginID: "scan" })
      yield* storage.object.set(
        ["workspace", { id: "77726b5f73746f72616765" }, "plugin", { id: "7363616e" }, "key", "626164"],
        {
          body: Stream.succeed(new TextEncoder().encode("{invalid")),
          contentType: "application/json",
        },
      )
      expect(yield* scoped.get("bad").pipe(Effect.flip)).toMatchObject({
        _tag: "Storage.DecodeError",
        providerID: "memory",
      })
      expect(yield* scoped.scan({ prefix: "" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Storage.DecodeError",
        providerID: "memory",
      })
    }).pipe(Effect.provide(layer)),
  )

  it.effect("rejects invalid scan limits and runtime non-JSON values as typed input failures", () =>
    Effect.gen(function* () {
      const storage = (yield* Storage.Service).scope({
        workspaceID: Workspace.ID.make("wrk_storage"),
        pluginID: "scan",
      })
      for (const limit of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(yield* storage.scan({ prefix: "", limit }).pipe(Effect.flip)).toMatchObject({
          _tag: "Storage.InputError",
          operation: "scan",
          reason: "limit",
        })
      }
      expect(yield* storage.set("invalid", NaN).pipe(Effect.flip)).toMatchObject({
        _tag: "Storage.InputError",
        operation: "set",
        reason: "json",
      })
      expect(yield* storage.get("invalid")).toBeUndefined()
    }).pipe(Effect.provide(layer)),
  )

  it.effect("isolates plugin namespaces and removes values", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const workspaceID = Workspace.ID.make("wrk_storage")
      const first = storage.scope({ workspaceID, pluginID: "first/plugin" })
      const second = storage.scope({ workspaceID, pluginID: "second/plugin" })

      yield* first.set("shared/key", { owner: "first" })
      yield* second.set("shared/key", { owner: "second" })
      expect(yield* first.get("shared/key")).toEqual({ owner: "first" })
      expect(yield* second.get("shared/key")).toEqual({ owner: "second" })

      yield* first.remove("shared/key")
      expect(yield* first.get("shared/key")).toBeUndefined()
      expect(yield* second.get("shared/key")).toEqual({ owner: "second" })
    }).pipe(Effect.provide(layer)),
  )

  it.effect("scans decoded keys in stable pages", () =>
    Effect.gen(function* () {
      const storage = (yield* Storage.Service).scope({
        workspaceID: Workspace.ID.make("wrk_storage"),
        pluginID: "scan",
      })
      yield* storage.set("prefix/c", 3)
      yield* storage.set("prefix/a", 1)
      yield* storage.set("prefix/b", 2)
      yield* storage.set("other", 0)

      const first = yield* storage.scan({ prefix: "prefix/", limit: 2 })
      expect(first).toEqual({
        entries: [
          { key: "prefix/a", value: 1 },
          { key: "prefix/b", value: 2 },
        ],
        next: "prefix/b",
      })
      expect(yield* storage.scan({ prefix: "prefix/", after: first.next })).toEqual({
        entries: [{ key: "prefix/c", value: 3 }],
      })
    }).pipe(Effect.provide(layer)),
  )

  it.effect("isolates the same plugin ID between Workspaces", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const workspaceA = storage.scope({ workspaceID: Workspace.ID.make("wrk_storage_a"), pluginID: "shared/plugin" })
      const workspaceB = storage.scope({ workspaceID: Workspace.ID.make("wrk_storage_b"), pluginID: "shared/plugin" })

      yield* workspaceA.set("token", "workspace-a")
      yield* workspaceB.set("token", "workspace-b")

      expect(yield* workspaceA.get("token")).toBe("workspace-a")
      expect(yield* workspaceB.get("token")).toBe("workspace-b")
    }).pipe(Effect.provide(layer)),
  )
})
