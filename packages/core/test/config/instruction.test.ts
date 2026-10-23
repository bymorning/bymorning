import { layer as storageLayer } from "../fixture/storage.js"
import { NodeCrypto } from "@effect/platform-node"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import { Project as ProjectSchema } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "../../src/bus.js"
import { ConfigInstructionPlugin } from "../../src/config/plugin/instruction.js"
import { Database } from "../../src/database.js"
import { InstructionDiscovery } from "../../src/instruction-discovery.js"
import { ProjectDirectory } from "../../src/project-directory.js"
import { Project } from "../../src/project.js"
import { Storage } from "../../src/storage.js"

const workspaceID = Workspace.ID.make("wrk_config_instruction")
const projectID = ProjectSchema.ID.make("prj_00000000000000000000000001")
const emptyProjectID = ProjectSchema.ID.make("prj_00000000000000000000000002")
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
const storage = storageLayer
const projects = Layer.succeed(
  Project.Service,
  Project.Service.of({
    create: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    list: (options) =>
      Effect.succeed(
        options?.archived
          ? []
          : [
              { id: projectID, name: "With instructions", time_created: 0, time_updated: 0 },
              { id: emptyProjectID, name: "Empty", time_created: 1, time_updated: 1 },
            ],
      ),
    update: () => Effect.die("unused"),
    delete: () => Effect.die("unused"),
  }),
)
const discovery = InstructionDiscovery.layer().pipe(Layer.provide(bus))
const layer = Layer.mergeAll(bus, storage, projects, discovery)

describe("ConfigInstructionPlugin", () => {
  it.effect("loads project AGENTS.md, skips absence, and reloads after writes", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const bus = yield* Bus.Service
      const directory = yield* ProjectDirectory.Service.pipe(
        Effect.provide(ProjectDirectory.layer(workspaceID, projectID)),
        Effect.provideService(Storage.Service, storage),
        Effect.provideService(Bus.Service, bus),
      )
      yield* directory.write(ProjectDirectory.Path.make("AGENTS.md"), {
        content: Stream.succeed(new TextEncoder().encode("initial")),
      })
      const instructions = yield* InstructionDiscovery.Service
      yield* ConfigInstructionPlugin.Plugin.effect({
        location: { workspaceID },
        instruction: {
          list: (projectID: ProjectSchema.ID | undefined) =>
            instructions.list(projectID).pipe(Effect.map((files) => (Array.isArray(files) ? files : []))),
          transform: instructions.transform,
          reload: instructions.reload,
        },
      } as unknown as PluginContext)

      expect(yield* instructions.list(projectID)).toEqual([
        new InstructionDiscovery.File({ path: "AGENTS.md", content: "initial", projectID }),
      ])
      expect(yield* instructions.list(emptyProjectID)).toEqual([])

      yield* directory.write(ProjectDirectory.Path.make("AGENTS.md"), {
        content: Stream.succeed(new TextEncoder().encode("changed")),
      })
      yield* TestClock.adjust("1 second")
      expect(yield* instructions.list(projectID)).toEqual([
        new InstructionDiscovery.File({ path: "AGENTS.md", content: "changed", projectID }),
      ])
    }).pipe(Effect.provide(layer)),
  )
})
