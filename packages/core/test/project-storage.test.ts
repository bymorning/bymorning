import { layer as storageLayer } from "./fixture/storage.js"
import { ProjectStorage } from "@bymorning/core/project-storage"
import { Storage } from "@bymorning/core/storage"
import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Stream } from "effect"

const workspaceID = Workspace.ID.make("wrk_project_storage")
const projectID = Project.ID.make("prj_000000000000projectstorage")
const otherProjectID = Project.ID.make("prj_000000000000000000000other")
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const storage = storageLayer
const layer = Layer.merge(ProjectStorage.layer(workspaceID, projectID).pipe(Layer.provide(storage)), storage)

describe("ProjectStorage", () => {
  it.effect("roundtrips objects through the Project namespace", () =>
    Effect.gen(function* () {
      const projectStorage = yield* ProjectStorage.Service
      const rawStorage = yield* Storage.Service
      yield* projectStorage.set(["notes.txt"], {
        body: Stream.succeed(encoder.encode("project notes")),
        contentType: "text/plain",
      })

      const entry = Option.getOrThrow(yield* projectStorage.get(["notes.txt"]))
      expect(decoder.decode(yield* Stream.mkUint8Array(entry.body))).toBe("project notes")
      expect(entry.metadata).toEqual({ contentType: "text/plain", contentLength: 13 })
      expect(
        Option.isSome(yield* rawStorage.object.get([{ workspaces: workspaceID }, { projects: projectID }, "notes.txt"])),
      ).toBe(true)
    }).pipe(Effect.provide(layer)),
  )

  it.effect("constructs independently namespaced Project storage without a Layer", () =>
    Effect.gen(function* () {
      const first = yield* ProjectStorage.make(workspaceID, projectID)
      const second = yield* ProjectStorage.make(workspaceID, otherProjectID)
      yield* first.set(["shared.txt"], { body: Stream.succeed(encoder.encode("first")) })
      yield* second.set(["shared.txt"], { body: Stream.succeed(encoder.encode("second")) })

      const firstEntry = Option.getOrThrow(yield* first.get(["shared.txt"]))
      const secondEntry = Option.getOrThrow(yield* second.get(["shared.txt"]))
      expect(decoder.decode(yield* Stream.mkUint8Array(firstEntry.body))).toBe("first")
      expect(decoder.decode(yield* Stream.mkUint8Array(secondEntry.body))).toBe("second")
    }).pipe(Effect.provide(storage)),
  )

  it.effect("lists recursive relative keys without exposing another Project", () =>
    Effect.gen(function* () {
      const projectStorage = yield* ProjectStorage.Service
      const rawStorage = yield* Storage.Service
      yield* rawStorage.object.set([{ workspaces: workspaceID }, { projects: projectID }], { body: Stream.empty })
      yield* projectStorage.set([{ skills: "skill-id" }], { body: Stream.empty })
      yield* projectStorage.set([{ skills: "skill-id" }, "SKILL.md"], {
        body: Stream.succeed(encoder.encode("skill")),
        contentType: "text/markdown",
      })
      yield* rawStorage.object.set([{ workspaces: workspaceID }, { projects: otherProjectID }, "private.txt"], {
        body: Stream.succeed(encoder.encode("private")),
      })

      expect(yield* projectStorage.list).toEqual([
        {
          key: "skills/skill-id/",
          metadata: { contentLength: 0, etag: undefined },
          marker: true,
        },
        {
          key: "skills/skill-id/SKILL.md",
          metadata: { contentLength: 5, etag: undefined },
          marker: false,
        },
      ])
      expect(Option.isNone(yield* projectStorage.get(["private.txt"]))).toBe(true)
    }).pipe(Effect.provide(layer)),
  )

  it.effect("preserves invalid relative path errors", () =>
    ProjectStorage.Service.use((projectStorage) =>
      projectStorage.set([".."], { body: Stream.empty }).pipe(
        Effect.flip,
        Effect.map((error) => expect(error._tag).toBe("Storage.InvalidPathError")),
      ),
    ).pipe(Effect.provide(layer)),
  )
})
