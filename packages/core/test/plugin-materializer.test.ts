import { layer as storageLayer } from "./fixture/storage.js"
import { ProjectMaterializer } from "@bymorning/core/plugin/project-materializer"
import { ProjectStorage } from "@bymorning/core/project-storage"
import { Storage } from "@bymorning/core/storage"
import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const workspaceID = Workspace.ID.make("wrk_plugin_materializer")
const projectID = Project.ID.make("prj_00000000000000000000000001")
const encoder = new TextEncoder()

describe("ProjectMaterializer", () => {
  it.effect("owns missing-object failures and preserves actual provider failures", () =>
    withFixture({ "plugin/demo.ts": "export default {}" }, ({ materializer, storage }) =>
      Effect.gen(function* () {
        const items = yield* storage.list
        yield* storage.remove(["plugin", "demo.ts"])
        const missing = yield* materializer.materialize({ storage, items }).pipe(Effect.flip)
        expect(missing).toMatchObject({ _tag: "ProjectMaterializer.OperationError", reason: "missing" })
        expect(missing).not.toHaveProperty("providerID")

        const failure = new Storage.OperationError({
          message: "Object read failed",
          providerID: Storage.ID.make("memory"),
          operation: "get",
          cause: undefined,
        })
        expect(
          yield* materializer
            .materialize({
              storage: { ...storage, get: () => Effect.fail(failure) },
              items,
            })
            .pipe(Effect.flip),
        ).toBe(failure)
      }),
    ),
  )

  it.effect("copies the complete relative plugin tree and selects only exact entrypoints", () =>
    withFixture(
      {
        "plugin/z.ts": "export default 'z'",
        "plugin/helper.js": "export const helper = true",
        "plugin/group/index.ts": "export default 'group'",
        "plugin/group/support.ts": "export const support = true",
        "plugin/group/nested/index.ts": "export default 'nested'",
        "plugin/nested/deep.ts": "export default 'deep'",
        "notes.txt": "not a plugin",
      },
      ({ materializer, storage }) =>
        Effect.gen(function* () {
          const generation = yield* materializer.materialize({ storage, items: yield* storage.list })

          expect(generation.entrypoints).toEqual(["plugin/group/index.ts", "plugin/z.ts"])
          expect(yield* readText(path.join(generation.directory, "group/support.ts"))).toBe(
            "export const support = true",
          )
          expect(yield* readText(path.join(generation.directory, "group/nested/index.ts"))).toBe(
            "export default 'nested'",
          )
          expect(
            yield* Effect.promise(() =>
              stat(path.join(generation.directory, "notes.txt")).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
        }),
    ),
  )

  it.effect("hashes sorted path and bytes, reuses completed generations, and changes for support edits", () =>
    withFixture(
      {
        "plugin/demo.ts": "export default {}",
        "plugin/lib/helper.ts": "export const revision = 1",
      },
      ({ materializer, storage }) =>
        Effect.gen(function* () {
          const items = yield* storage.list
          const first = yield* materializer.materialize({ storage, items: [...items].reverse() })
          const firstStat = yield* Effect.promise(() => stat(first.directory))
          const unchanged = yield* materializer.materialize({ storage, items })

          expect(unchanged).toEqual(first)
          expect((yield* Effect.promise(() => stat(unchanged.directory))).ino).toBe(firstStat.ino)

          yield* storage.set(["plugin", "lib", "helper.ts"], {
            body: Stream.succeed(encoder.encode("export const revision = 2")),
          })
          const changed = yield* materializer.materialize({ storage, items: yield* storage.list })
          expect(changed.digest).not.toBe(first.digest)
          expect(changed.directory).not.toBe(first.directory)
          expect(yield* readText(path.join(first.directory, "lib/helper.ts"))).toBe("export const revision = 1")
          expect(yield* readText(path.join(changed.directory, "lib/helper.ts"))).toBe("export const revision = 2")
        }),
    ),
  )
})

function withFixture(
  files: Readonly<Record<string, string>>,
  test: (fixture: {
    readonly materializer: ProjectMaterializer.Interface
    readonly storage: ProjectStorage.Interface
  }) => Effect.Effect<void, unknown>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(tmpdir(), "bm-plugin-materializer-"))),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
      )
      const storage = yield* ProjectStorage.make(workspaceID, projectID)
      for (const [file, contents] of Object.entries(files)) {
        yield* storage.set(file.split("/"), { body: Stream.succeed(encoder.encode(contents)) })
      }
      yield* test({ materializer: ProjectMaterializer.make(root, workspaceID, projectID), storage })
    }),
  ).pipe(Effect.provide(storageLayer))
}

const readText = (file: string) => Effect.promise(() => readFile(file, "utf8"))
