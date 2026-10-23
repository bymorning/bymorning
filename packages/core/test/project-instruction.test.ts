import { layer as storageLayer } from "./fixture/storage.js"
import { NodeCrypto } from "@effect/platform-node"
import { Bus } from "@bymorning/core/bus"
import { Database } from "@bymorning/core/database"
import { Instruction } from "@bymorning/core/instruction"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { ProjectInstruction } from "@bymorning/core/project-instruction"
import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"

const workspaceID = Workspace.ID.make("wrk_project_instruction")
const projectID = Project.ID.make("prj_00000000000000000000000001")
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

describe("ProjectInstruction", () => {
  it.effect("reports removal when the project has no AGENTS.md", () =>
    Effect.gen(function* () {
      expect(yield* ProjectInstruction.read(yield* ProjectDirectory.Service)).toBe(Instruction.removed)
    }).pipe(Effect.provide(layer)),
  )

  it.effect("reads the root AGENTS.md", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      yield* directory.write(ProjectInstruction.path, {
        content: Stream.succeed(new TextEncoder().encode("Be concise.")),
      })
      expect(yield* ProjectInstruction.read(directory)).toEqual({
        path: "AGENTS.md",
        content: "Be concise.",
        projectID,
      })
    }).pipe(Effect.provide(layer)),
  )

  it.effect("fails on non-UTF-8 content", () =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      yield* directory.write(ProjectInstruction.path, { content: Stream.succeed(Uint8Array.from([0xff])) })
      expect((yield* ProjectInstruction.read(directory).pipe(Effect.flip))._tag).toBe("UnknownError")
    }).pipe(Effect.provide(layer)),
  )
})
