import { layer as storageLayer } from "./fixture/storage.js"
import { NodeCrypto } from "@effect/platform-node"
import { Bus } from "@bymorning/core/bus"
import { Database } from "@bymorning/core/database"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { Permission } from "@bymorning/core/permission"
import { Storage } from "@bymorning/core/storage"
import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const workspaceID = Workspace.ID.make("wrk_project_directory")
const projectID = Project.ID.make("prj_00000000000000000000000001")
const otherProjectID = Project.ID.make("prj_00000000000000000000000002")
const storage = storageLayer
const database = Layer.succeed(
  Database.Service,
  Database.Service.of({
    use: () => Effect.die("unexpected database use"),
    transact: (effect) => effect,
    transactRoot: (effect) => effect,
    afterCommit: (effect) => Effect.asVoid(effect),
  }),
)
const bus = Bus.layer.pipe(Layer.provide(database), Layer.provide(NodeCrypto.layer))
const layer = Layer.mergeAll(
  ProjectDirectory.layer(workspaceID, projectID).pipe(Layer.provide(storage), Layer.provide(bus)),
  storage,
  bus,
)

describe("ProjectDirectory", () => {
  it.effect("validates Project-relative file paths", () =>
    Effect.gen(function* () {
      expect(yield* ProjectDirectory.parse("src/main.ts")).toBe("src/main.ts")
      for (const path of [
        "",
        "/root",
        "C:/root",
        "../secret",
        "src/../secret",
        "src//main.ts",
        "src\\main.ts",
        `src/${String.fromCharCode(0)}.txt`,
        "src/",
      ]) {
        const error = yield* ProjectDirectory.parse(path).pipe(Effect.flip)
        expect(error).toEqual(new ProjectDirectory.InvalidPathError({ path }))
      }
    }),
  )

  it.effect("scopes exact Permission resources by Project identity", () =>
    Effect.gen(function* () {
      const path = yield* ProjectDirectory.parse("packages/@scope/file*.ts")
      const resource = ProjectDirectory.resource(projectID, path)
      const rule = { action: "read", resource, effect: "allow" as const }
      // Production rules carry an ask-by-default baseline, so an allow rule
      // scoped to one Project must not admit another Project's files.
      const baseline = { action: "read", resource: "*", effect: "ask" as const }

      expect(resource).toBe(`project:${projectID}:packages%2F%40scope%2Ffile%2A.ts`)
      expect(Permission.evaluate("read", resource, [baseline, rule]).effect).toBe("allow")
      expect(
        Permission.evaluate("read", ProjectDirectory.resource(otherProjectID, path), [baseline, rule]).effect,
      ).toBe("ask")
    }),
  )

  it.effect("roundtrips streamed bytes with metadata and returns a sorted listing", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const first = yield* ProjectDirectory.parse("notes/zeta.txt")
      const second = yield* ProjectDirectory.parse("notes/alpha.txt")
      yield* directory.write(first, {
        content: Stream.make(Uint8Array.from([0, 1]), Uint8Array.from([0xfe, 0xff])),
        contentType: "application/x-project-test",
        contentLength: 4,
      })
      yield* directory.write(second, {
        content: Stream.succeed(new TextEncoder().encode("morning")),
        contentType: "text/plain; charset=utf-8",
        contentLength: 7,
      })

      const file = yield* directory.read(first)
      expect(file.contentType).toBe("application/x-project-test")
      expect(file.contentLength).toBe(4)
      expect(yield* Stream.mkUint8Array(file.content)).toEqual(Uint8Array.from([0, 1, 0xfe, 0xff]))
      const files = yield* directory.list
      expect(files).toEqual([second, first])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("publishes plugin and ordinary paths only after their writes persist", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const bus = yield* Bus.Service
      const stream = yield* bus.subscribe(Project.FileChanged)
      const events = yield* stream.pipe(
        Stream.take(2),
        Stream.mapEffect((event) =>
          Storage.Service.use((storage) =>
            storage.object
              .get([{ workspaces: workspaceID }, { projects: projectID }, ...event.data.path.split("/")])
              .pipe(Effect.map((entry) => ({ data: event.data, persisted: Option.isSome(entry) }))),
          ),
        ),
        Stream.runCollect,
        Effect.forkChild,
      )
      yield* Effect.yieldNow
      const pluginPath = yield* ProjectDirectory.parse("plugin/demo.ts")
      const ordinaryPath = yield* ProjectDirectory.parse("notes/readme.md")
      yield* directory.write(pluginPath, { content: Stream.succeed(new TextEncoder().encode("plugin")) })
      yield* directory.write(ordinaryPath, { content: Stream.succeed(new TextEncoder().encode("notes")) })

      expect(yield* Fiber.join(events)).toEqual([
        { data: { projectID, path: pluginPath }, persisted: true },
        { data: { projectID, path: ordinaryPath }, persisted: true },
      ])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("does not publish a failed write", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const bus = yield* Bus.Service
      const event = yield* (yield* bus.subscribe(Project.FileChanged)).pipe(Stream.runHead, Effect.forkChild)
      yield* Effect.yieldNow
      const failedPath = yield* ProjectDirectory.parse("notes/failed.md")
      const successfulPath = yield* ProjectDirectory.parse("plugin/success.ts")
      yield* directory.write(failedPath, { content: Stream.fail("write failed") }).pipe(Effect.flip)
      yield* directory.write(successfulPath, { content: Stream.empty })

      expect((yield* Fiber.join(event)).pipe(Option.map((item) => item.data))).toEqual(
        Option.some({ projectID, path: successfulPath }),
      )
    }).pipe(Effect.provide(layer)),
  )

  it.effect("isolates Project File namespaces", () =>
    Effect.gen(function* () {
      const path = yield* ProjectDirectory.parse("private.txt")
      yield* Storage.Service.use((raw) =>
        raw.object.set([{ workspaces: workspaceID }, { projects: otherProjectID }, path], {
          body: Stream.succeed(new TextEncoder().encode("other")),
        }),
      )
      const error = yield* ProjectDirectory.Service.use((directory) => directory.read(path)).pipe(Effect.flip)
      expect(error).toEqual(new ProjectDirectory.NotFoundError({ path }))
    }).pipe(Effect.provide(layer)),
  )

  it.effect("returns arbitrary stored bytes without text decoding", () =>
    Effect.gen(function* () {
      const path = yield* ProjectDirectory.parse("binary.txt")
      yield* Storage.Service.use((raw) =>
        raw.object.set([{ workspaces: workspaceID }, { projects: projectID }, path], {
          body: Stream.succeed(Uint8Array.from([0xff])),
        }),
      )
      const bytes = yield* ProjectDirectory.Service.use((directory) =>
        directory.read(path).pipe(Effect.flatMap((file) => Stream.mkUint8Array(file.content))),
      )
      expect(bytes).toEqual(Uint8Array.from([0xff]))
    }).pipe(Effect.provide(layer)),
  )
})

/** The memory provider and a real filesystem provider rooted in a disposable directory. */
const adapters = [
  { name: "memory", storage: storageLayer },
  {
    name: "filesystem",
    storage: Layer.unwrap(
      Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "bymorning-project-directory-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      ).pipe(
        Effect.map((directory) =>
          Storage.layer({
            configure: (editor) => {
              editor.add(Storage.filesystem({ directory }))
              editor.default.set(Storage.ID.make("filesystem"))
            },
          }).pipe(Layer.orDie),
        ),
      ),
    ),
  },
] as const

describe.each(adapters)("ProjectDirectory delete and move over $name storage", ({ storage }) => {
  // Each test acquires its own storage so listings never see another test's files.
  const layer = Layer.fresh(
    Layer.mergeAll(ProjectDirectory.layer(workspaceID, projectID).pipe(Layer.provide(bus)), bus).pipe(
      Layer.provideMerge(storage),
    ),
  )
  const encode = (text: string) => new TextEncoder().encode(text)
  const text = (path: ProjectDirectory.Path) =>
    ProjectDirectory.Service.use((directory) =>
      directory.read(path).pipe(
        Effect.flatMap((file) => Stream.mkUint8Array(file.content)),
        Effect.map((bytes) => new TextDecoder().decode(bytes)),
      ),
    )
  /** Collect the next `count` file-changed paths published while `effect` runs. */
  const changes = <A, E, R>(count: number, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const events = yield* (yield* bus.subscribe(Project.FileChanged)).pipe(
        Stream.take(count),
        Stream.map((event) => event.data),
        Stream.runCollect,
        Effect.forkChild,
      )
      yield* Effect.yieldNow
      yield* effect
      return yield* Fiber.join(events)
    })

  it.effect("deletes one file, publishes its path, and leaves its siblings", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const doomed = yield* ProjectDirectory.parse("notes/doomed.md")
      const kept = yield* ProjectDirectory.parse("notes/kept.md")
      yield* directory.write(doomed, { content: Stream.succeed(encode("doomed")) })
      yield* directory.write(kept, { content: Stream.succeed(encode("kept")) })

      expect(yield* changes(1, directory.delete(doomed))).toEqual([{ projectID, path: doomed }])
      expect(yield* directory.list).toEqual([kept])
      expect(yield* directory.read(doomed).pipe(Effect.flip)).toEqual(
        new ProjectDirectory.NotFoundError({ path: doomed }),
      )
      expect(yield* text(kept)).toBe("kept")
    }).pipe(Effect.provide(layer)),
  )

  it.effect("refuses to delete a missing file without publishing", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const missing = yield* ProjectDirectory.parse("missing.md")
      const marker = yield* ProjectDirectory.parse("marker.md")
      const published = yield* changes(
        1,
        Effect.gen(function* () {
          const error = yield* directory.delete(missing).pipe(Effect.flip)
          expect(error).toEqual(new ProjectDirectory.NotFoundError({ path: missing }))
          // The first publication observed must be this later write, not the refused delete.
          yield* directory.write(marker, { content: Stream.empty })
        }),
      )
      expect(published).toEqual([{ projectID, path: marker }])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("moves bytes and content type to a free path and publishes both paths", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const from = yield* ProjectDirectory.parse("drafts/report.bin")
      const to = yield* ProjectDirectory.parse("final/2026/report.bin")
      const bytes = Uint8Array.from([0, 1, 0xfe, 0xff])
      yield* directory.write(from, {
        content: Stream.succeed(bytes),
        contentType: "application/x-report",
        contentLength: bytes.length,
      })

      expect(yield* changes(2, directory.move(from, to))).toEqual([
        { projectID, path: to },
        { projectID, path: from },
      ])
      expect(yield* directory.list).toEqual([to])
      const moved = yield* directory.read(to)
      expect(moved.contentType).toBe("application/x-report")
      expect(yield* Stream.mkUint8Array(moved.content)).toEqual(bytes)
      expect(yield* directory.read(from).pipe(Effect.flip)).toEqual(new ProjectDirectory.NotFoundError({ path: from }))
    }).pipe(Effect.provide(layer)),
  )

  it.effect("refuses to move onto an occupied path and leaves both files unchanged", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const from = yield* ProjectDirectory.parse("a.txt")
      const to = yield* ProjectDirectory.parse("b.txt")
      yield* directory.write(from, { content: Stream.succeed(encode("a")) })
      yield* directory.write(to, { content: Stream.succeed(encode("b")) })

      const error = yield* directory.move(from, to).pipe(Effect.flip)
      expect(error).toEqual(new ProjectDirectory.ConflictError({ path: to }))
      expect(yield* text(from)).toBe("a")
      expect(yield* text(to)).toBe("b")
    }).pipe(Effect.provide(layer)),
  )

  it.effect("refuses to move a missing file", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const from = yield* ProjectDirectory.parse("missing.txt")
      const to = yield* ProjectDirectory.parse("elsewhere.txt")
      expect(yield* directory.move(from, to).pipe(Effect.flip)).toEqual(
        new ProjectDirectory.NotFoundError({ path: from }),
      )
      expect(yield* directory.list).toEqual([])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("treats moving a file onto its own path as an unpublished no-op", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const path = yield* ProjectDirectory.parse("same.txt")
      const marker = yield* ProjectDirectory.parse("marker.txt")
      yield* directory.write(path, { content: Stream.succeed(encode("same")), contentType: "text/plain" })
      const published = yield* changes(
        1,
        Effect.gen(function* () {
          yield* directory.move(path, path)
          yield* directory.write(marker, { content: Stream.empty })
        }),
      )
      expect(published).toEqual([{ projectID, path: marker }])
      expect(yield* text(path)).toBe("same")
      const missing = yield* ProjectDirectory.parse("absent.txt")
      expect(yield* directory.move(missing, missing).pipe(Effect.flip)).toEqual(
        new ProjectDirectory.NotFoundError({ path: missing }),
      )
    }).pipe(Effect.provide(layer)),
  )
})
