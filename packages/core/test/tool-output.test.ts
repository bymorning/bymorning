import { layer as storageLayer } from "./fixture/storage.js"
import { Config } from "@bymorning/core/config"
import { Storage } from "@bymorning/core/storage"
import { ToolOutput } from "@bymorning/core/tool-output"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import { Session } from "@bymorning/schema/session"
import { ToolOutput as ToolOutputSchema } from "@bymorning/schema/tool-output"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Ref, Schema, Stream } from "effect"

const workspaceID = Workspace.ID.make("wrk_test")
const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000001")
const configInfo = (tool_output: { readonly max_lines?: number; readonly max_bytes?: number }) =>
  Schema.decodeUnknownSync(ConfigSchema.Info)({ tool_output })

describe("ToolOutput", () => {
  it.effect("stores exact joined text and preserves output and mixed content ordering", () =>
    withOutput({ max_lines: 2, max_bytes: 1_000 }, (output, storage) =>
      Effect.gen(function* () {
        const structured = { answer: 42 }
        const file = { type: "file" as const, uri: "file:///image.png", mime: "image/png" }
        const result = yield* output.truncate(sessionID, {
          output: structured,
          content: [{ type: "text", text: "one" }, file, { type: "text", text: "two\nthree" }],
          metadata: { source: "tool" },
        })
        expect(result.output).toBe(structured)
        expect(result.content).toEqual([
          { type: "text", text: "one" },
          file,
          { type: "text", text: "two" },
          { type: "text", text: expect.stringContaining("1 line truncated") },
        ])
        expect(result.metadata).toMatchObject({ source: "tool", truncated: true })
        const outputID = ToolOutputSchema.ID.make(String(result.metadata?.outputID))
        const stored = Option.getOrThrow(
          yield* storage.object.get([
            "tool-output",
            { workspace: workspaceID },
            { session: sessionID },
            { output: outputID },
            "content",
          ]),
        )
        expect(new TextDecoder().decode(yield* Stream.mkUint8Array(stored.body))).toBe("one\ntwo\nthree")
      }),
    ),
  )

  it.effect("normalizes strings, observes Config on every call, and counts trailing empty lines", () =>
    Effect.gen(function* () {
      const config = yield* Ref.make(configInfo({ max_lines: 2, max_bytes: 1_000 }))
      yield* runWithServices(config, undefined, (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate(sessionID, { content: "one\ntwo\n" })
          expect(result.content?.[0]).toEqual({ type: "text", text: "one\ntwo" })
          expect(result.content?.[1]).toEqual({ type: "text", text: expect.stringContaining("1 line truncated") })
          yield* Ref.set(config, configInfo({ max_lines: 3, max_bytes: 1_000 }))
          expect((yield* output.truncate(sessionID, { content: "one\ntwo\n" })).metadata?.truncated).toBe(false)
        }),
      )
    }),
  )

  it.effect("uses UTF-8-safe previews and byte-cursor pages", () =>
    withOutput({ max_lines: 100, max_bytes: 5 }, (output) =>
      Effect.gen(function* () {
        const result = yield* output.truncate(sessionID, { content: "a🙂b🙂c" })
        expect(result.content?.[0]).toEqual({ type: "text", text: expect.stringContaining("11 bytes truncated") })
        const outputID = ToolOutputSchema.ID.make(String(result.metadata?.outputID))
        const first = yield* output.read(sessionID, outputID, { limit: 5 })
        const second = yield* output.read(sessionID, outputID, { cursor: first.cursor, limit: 5 })
        expect(first).toEqual({ content: "a🙂", cursor: 5, size: 11 })
        expect(second).toEqual({ content: "b🙂", cursor: 10, size: 11 })
        expect(yield* output.read(sessionID, outputID, { cursor: second.cursor, limit: 5 })).toEqual({
          content: "c",
          cursor: 11,
          size: 11,
        })
        expect((yield* output.read(sessionID, outputID, { cursor: 2 }).pipe(Effect.flip))._tag).toBe(
          "ToolOutput.UnavailableError",
        )
      }),
    ),
  )

  it.effect("makes progress for tiny limits and never performs a full object read", () =>
    Effect.gen(function* () {
      const memory = yield* Storage.Service
      const config = yield* Ref.make(configInfo({ max_lines: 100, max_bytes: 4 }))
      const requests = yield* Ref.make<ReadonlyArray<Storage.RangeInput>>([])
      const ranged = Storage.Service.of({
        ...memory,
        object: {
          ...memory.object,
          get: () => Effect.die("full reads are forbidden"),
          getRange: (path, input) =>
            Ref.update(requests, (current) => [...current, input]).pipe(Effect.andThen(memory.object.getRange(path, input))),
        },
      })
      yield* runWithServices(config, ranged, (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate(sessionID, { content: "🙂🙂x" })
          const outputID = ToolOutputSchema.ID.make(String(result.metadata?.outputID))
          const first = yield* output.read(sessionID, outputID, { limit: 1 })
          const second = yield* output.read(sessionID, outputID, { cursor: first.cursor, limit: 2 })
          const third = yield* output.read(sessionID, outputID, { cursor: second.cursor, limit: 100 })
          expect([first.content, second.content, third.content]).toEqual(["🙂", "🙂", "x"])
          expect([first.cursor, second.cursor, third.cursor]).toEqual([4, 8, 9])
          expect((yield* Ref.get(requests)).map((request) => request.length)).toEqual([4, 5, 7])
        }),
      )
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("isolates exact IDs, Sessions, and Workspaces and validates cursor bounds", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const config = yield* Ref.make(configInfo({ max_lines: 2, max_bytes: 100 }))
      const result = yield* runWithServices(config, storage, (output) =>
        output.truncate(sessionID, { content: "one\ntwo\nthree" }),
      )
      const outputID = ToolOutputSchema.ID.make(String(result.metadata?.outputID))
      const marker = Array.isArray(result.content)
        ? result.content.find((item) => item.type === "text" && item.text.includes("full content saved"))
        : undefined
      expect(marker?.type === "text" ? marker.text : "").toContain(`saved as ${outputID} ...`)
      const wrongID = ToolOutputSchema.ID.create()
      const wrongSession = Session.ID.make("00000000-0000-4000-8000-000000000002")
      yield* runWithServices(config, storage, (output) =>
        Effect.gen(function* () {
          for (const read of [
            output.read(sessionID, wrongID),
            output.read(wrongSession, outputID),
            output.read(sessionID, outputID, { cursor: 14 }),
          ])
            expect((yield* read.pipe(Effect.flip))._tag).toBe("ToolOutput.UnavailableError")
          expect(yield* output.read(sessionID, outputID, { cursor: 13 })).toEqual({
            content: "",
            cursor: 13,
            size: 13,
          })
        }),
      )
      const otherWorkspace = Workspace.ID.make("wrk_other")
      yield* runWithServices(
        config,
        storage,
        (output) =>
          Effect.gen(function* () {
            expect((yield* output.read(sessionID, outputID).pipe(Effect.flip))._tag).toBe("ToolOutput.UnavailableError")
          }),
        otherWorkspace,
      )
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("hides ranged read failures and malformed UTF-8", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const config = yield* Ref.make(configInfo({ max_lines: 2, max_bytes: 4 }))
      const outputID = ToolOutputSchema.ID.create()
      yield* storage.object.set(outputPath(outputID), { body: Stream.succeed(new Uint8Array([0xf0, 0x28, 0x8c, 0x28])) })
      yield* runWithServices(config, storage, (output) =>
        Effect.gen(function* () {
          expect((yield* output.read(sessionID, outputID).pipe(Effect.flip))._tag).toBe("ToolOutput.UnavailableError")
        }),
      )
      const failed = Storage.Service.of({
        ...storage,
        object: {
          ...storage.object,
          getRange: () =>
            Effect.succeed(
              Option.some({
                metadata: { contentLength: 10 },
                body: Stream.fail(new Storage.OperationError({
                  operation: "get",
                  cause: "failed",
                  message: "Read failed",
                  providerID: Storage.ID.make("memory"),
                })),
              }),
            ),
        },
      })
      yield* runWithServices(config, failed, (output) =>
        Effect.gen(function* () {
          expect((yield* output.read(sessionID, outputID).pipe(Effect.flip))._tag).toBe("ToolOutput.UnavailableError")
        }),
      )
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("preserves fitting producer truncation states but centrally bounds spoofed oversized output", () =>
    withOutput({ max_lines: 2, max_bytes: 5 }, (output) =>
      Effect.gen(function* () {
        const yes = { content: "small", metadata: { truncated: true, outputID: "producer" } }
        const no = { content: "small", metadata: { truncated: false } }
        expect((yield* output.truncate(sessionID, yes)).metadata).toEqual({ truncated: true, outputID: "producer" })
        expect((yield* output.truncate(sessionID, no)).metadata).toEqual({ truncated: false })

        const oversized = yield* output.truncate(sessionID, {
          content: "spoofed oversized output",
          metadata: { source: "plugin", truncated: true, outputID: "out_spoofed" },
        })
        expect(oversized.metadata).toMatchObject({ source: "plugin", truncated: true })
        expect(oversized.metadata?.outputID).not.toBe("out_spoofed")
        expect(oversized.content).not.toEqual([{ type: "text", text: "spoofed oversized output" }])

        const claimedOutputID = ToolOutputSchema.ID.create()
        const hint = `[More output is available. Call tool_output with {"outputID":"${claimedOutputID}","cursor":1} to continue.]`
        const claimedRetrieval = yield* output.truncate(sessionID, {
          content: `123456\n\n${hint}`,
          metadata: { truncated: true, outputID: claimedOutputID, next: 1 },
        })
        expect(claimedRetrieval.metadata?.outputID).not.toBe(claimedOutputID)
        expect(claimedRetrieval.content).not.toEqual([{ type: "text", text: `123456\n\n${hint}` }])
      }),
    ),
  )

  it.effect("bounds retrieval content and its continuation without recursively archiving it", () =>
    withOutput({ max_lines: 3, max_bytes: 140 }, (output) =>
      Effect.gen(function* () {
        const archived = yield* output.truncate(sessionID, { content: "a".repeat(300) })
        const outputID = ToolOutputSchema.ID.make(String(archived.metadata?.outputID))
        const page = yield* output.readForTool(sessionID, outputID)
        expect(page.cursor).toBeGreaterThan(0)
        expect(page.cursor).toBeLessThan(page.size)
        expect(page.content).toContain(`"outputID":"${outputID}"`)
        const [preview] = page.content.split("\n\n[More output is available.")
        expect(new TextEncoder().encode(preview ?? "").length).toBeLessThanOrEqual(140)
        expect(new TextEncoder().encode(page.content).length).toBeGreaterThan(140)
        expect(page.content.split("\n")).toHaveLength(3)

        const retrieval = yield* output.truncate(sessionID, {
          content: [{ type: "text", text: page.content }],
          metadata: { truncated: true, outputID, next: page.cursor },
        })
        expect(retrieval.metadata).toEqual({ truncated: true, outputID, next: page.cursor })
        expect(retrieval.content).toEqual([{ type: "text", text: page.content }])
      }),
    ),
  )

  it.effect("returns every scalar and a discoverable continuation at minimum preview limits", () =>
    withOutput({ max_lines: 2, max_bytes: 4 }, (output) =>
      Effect.gen(function* () {
        const archived = yield* output.truncate(sessionID, { content: "🙂\n\nx" })
        const outputID = ToolOutputSchema.ID.make(String(archived.metadata?.outputID))
        const previews: string[] = []
        let cursor = 0
        while (cursor < 7) {
          const page = yield* output.readForTool(sessionID, outputID, { cursor })
          const next = page.cursor < page.size ? page.cursor : undefined
          expect(page.cursor).toBeGreaterThan(cursor)
          if (next !== undefined) expect(page.content).toContain(`"cursor":${next}`)
          const [preview] = page.content.split("\n\n[More output is available.")
          previews.push(preview ?? "")
          const retained = yield* output.truncate(sessionID, {
            content: page.content,
            metadata: { truncated: next !== undefined, outputID, ...(next === undefined ? {} : { next }) },
          })
          expect(retained.content).toEqual([{ type: "text", text: page.content }])
          expect(retained.metadata?.outputID).toBe(outputID)
          cursor = page.cursor
        }
        expect(previews.join("")).toBe("🙂\n\nx")
      }),
    ),
  )

  it.effect("keeps range arithmetic safe at the maximum configured byte limit", () =>
    Effect.gen(function* () {
      const memory = yield* Storage.Service
      const requests = yield* Ref.make<ReadonlyArray<Storage.RangeInput>>([])
      const storage = Storage.Service.of({
        ...memory,
        object: {
          ...memory.object,
          getRange: (_path, input) =>
            Ref.update(requests, (current) => [...current, input]).pipe(
              Effect.as(
                Option.some({
                  metadata: { contentLength: Number.MAX_SAFE_INTEGER },
                  body: Stream.succeed(new TextEncoder().encode(input.offset === 0 ? "x" : "🙂")),
                }),
              ),
            ),
        },
      })
      const config = yield* Ref.make(configInfo({ max_lines: 2, max_bytes: Number.MAX_SAFE_INTEGER }))
      const pages = yield* runWithServices(config, storage, (output) =>
        Effect.all([
          output.read(sessionID, ToolOutputSchema.ID.create()),
          output.read(sessionID, ToolOutputSchema.ID.create(), { cursor: Number.MAX_SAFE_INTEGER - 4 }),
        ]),
      )
      expect(pages).toEqual([
        { content: "x", cursor: 1, size: Number.MAX_SAFE_INTEGER },
        { content: "🙂", cursor: Number.MAX_SAFE_INTEGER, size: Number.MAX_SAFE_INTEGER },
      ])
      expect(yield* Ref.get(requests)).toEqual([
        { offset: 0, length: Number.MAX_SAFE_INTEGER },
        { offset: Number.MAX_SAFE_INTEGER - 4, length: 4 },
      ])
    }).pipe(Effect.provide(storageLayer)),
  )

  it.effect("returns a bounded truthful result when real Storage is decorated to fail writes", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const failed = Storage.Service.of({
        ...storage,
        object: {
          ...storage.object,
          set: () => Effect.fail(new Storage.OperationError({
            operation: "set",
            cause: "unavailable",
            message: "Write unavailable",
            providerID: Storage.ID.make("memory"),
          })),
        },
      })
      const config = yield* Ref.make(configInfo({ max_lines: 2, max_bytes: 100 }))
      yield* runWithServices(config, failed, (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate(sessionID, { content: "one\ntwo\nthree" })
          expect(result.content).toEqual([
            { type: "text", text: "one\ntwo" },
            { type: "text", text: "... 1 line truncated; full content unavailable ..." },
          ])
          expect(result.metadata).toEqual({ truncated: true })
        }),
      )
    }).pipe(Effect.provide(storageLayer)),
  )
})

const withOutput = <A, E>(
  limits: { readonly max_lines?: number; readonly max_bytes?: number },
  use: (output: ToolOutput.Interface, storage: Storage.Interface) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    const config = yield* Ref.make(configInfo(limits))
    return yield* runWithServices(config, storage, (output) => use(output, storage))
  }).pipe(Effect.provide(storageLayer))

const runWithServices = <A, E>(
  config: Ref.Ref<ConfigSchema.Info>,
  storage: Storage.Interface | undefined,
  use: (output: ToolOutput.Interface) => Effect.Effect<A, E>,
  workspace: Workspace.ID = workspaceID,
) => {
  const configLayer = Layer.succeed(
    Config.Service,
    Config.Service.of({
      provider: { update: () => Effect.die("unused") },
      model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      get: Ref.get(config),
      update: () => Effect.die("unused"),
      refresh: Effect.die("unused"),
      mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
      modelPolicy: {
        reconcile: () => Effect.die("unused"),
        initialize: () => Effect.die("unused"),
        toggle: () => Effect.die("unused"),
        setDefault: () => Effect.die("unused"),
      },
      plugin: Config.pluginUnavailable,
      entries: () => Effect.die("unused"),
      changes: () => Stream.empty,
    }),
  )
  const dependencies =
    storage === undefined
      ? Layer.merge(configLayer, storageLayer)
      : Layer.merge(configLayer, Layer.succeed(Storage.Service, storage))
  return Effect.gen(function* () {
    return yield* use(yield* ToolOutput.Service)
  }).pipe(Effect.provide(ToolOutput.layer(workspace).pipe(Layer.provide(dependencies))))
}

const outputPath = (outputID: ToolOutputSchema.ID) =>
  Storage.path("tool-output", { workspace: workspaceID }, { session: sessionID }, { output: outputID }, "content")
