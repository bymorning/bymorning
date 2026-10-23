import { NodeCrypto } from "@effect/platform-node"
import { Bus } from "@bymorning/core/bus"
import { Database } from "@bymorning/core/database"
import { InstructionDiscovery } from "@bymorning/core/instruction-discovery"
import { Instruction } from "@bymorning/core/instruction"
import { Project } from "@bymorning/schema/project"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

const projectA = Project.ID.make("prj_0000000000000000000000000a")
const projectB = Project.ID.make("prj_0000000000000000000000000b")
const database = Layer.succeed(
  Database.Service,
  Database.Service.of({
    use: () => Effect.die("unexpected database use"),
    transact: (effect) => effect,
    transactRoot: (effect) => effect,
    afterCommit: (effect) => Effect.asVoid(effect),
  }),
)
const bus = Bus.layer.pipe(
  Layer.provide(database),
  Layer.provide(NodeCrypto.layer),
)
const layer = InstructionDiscovery.layer().pipe(Layer.provide(bus))
const file = (path: string, content: string, projectID?: Project.ID) =>
  new InstructionDiscovery.File({ path, content, ...(projectID === undefined ? {} : { projectID }) })

describe("InstructionDiscovery", () => {
  it.effect("preserves insertion order through update, replacement, and removal", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      yield* discovery.transform((editor) => {
        editor.add(file("one", "first"))
        editor.add(file("two", "second"))
        editor.add(file("one", "replacement"))
        editor.update("two", undefined, (current) => {
          current.content = "updated"
          current.path = "ignored"
        })
        editor.remove("missing", undefined)
      })
      expect(yield* discovery.list()).toEqual([file("one", "replacement"), file("two", "updated")])
      yield* discovery.transform((editor) => editor.remove("one", undefined))
      expect(yield* discovery.list()).toEqual([file("two", "updated")])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("filters by project and renders workspace files before project files", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      yield* discovery.transform((editor) => {
        editor.add(file("a/AGENTS.md", "project a", projectA))
        editor.add(file("workspace-first", "one"))
        editor.add(file("b/AGENTS.md", "project b", projectB))
        editor.add(file("workspace-second", "two"))
      })
      expect(yield* discovery.list(projectA)).toEqual([
        file("workspace-first", "one"),
        file("workspace-second", "two"),
        file("a/AGENTS.md", "project a", projectA),
      ])
      const [source] = yield* discovery.load(projectA)
      const value = yield* source.read
      if (!Array.isArray(value)) throw new Error("expected instruction files")
      expect(source.initial(value)).toBe(
        [
          "Instructions from: workspace-first\none",
          "Instructions from: workspace-second\ntwo",
          "Instructions from: a/AGENTS.md\nproject a",
        ].join("\n\n"),
      )
    }).pipe(Effect.provide(layer)),
  )

  it.effect("loads unavailable and removed states", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      expect(yield* (yield* discovery.load(projectA))[0].read).toBe(Instruction.removed)
      yield* discovery.transform((editor) => editor.unavailable())
      expect(yield* (yield* discovery.load(projectA))[0].read).toBe(Instruction.unavailable)
    }).pipe(Effect.provide(layer)),
  )
})
