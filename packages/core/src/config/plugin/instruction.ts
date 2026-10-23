export * as ConfigInstructionPlugin from "./instruction.js"

import { define } from "@bymorning/plugin/effect/plugin"
import { Deleted, FileChanged, Updated, type ID } from "@bymorning/schema/project"
import { Effect, Stream } from "effect"
import { Bus } from "../../bus.js"
import { InstructionDiscovery } from "../../instruction-discovery.js"
import { Instruction } from "../../instruction.js"
import { ProjectDirectory } from "../../project-directory.js"
import { Project } from "../../project.js"
import { ProjectInstruction } from "../../project-instruction.js"
import { Storage } from "../../storage.js"

type Loaded = InstructionDiscovery.File | Instruction.Removed | Instruction.Unavailable

export const Plugin = define({
  id: "bymorning.config.instruction",
  effect: Effect.fn(function* (context) {
    const discovery = yield* InstructionDiscovery.Service
    if (!discovery.project) return
    const projects = yield* Project.Service
    const bus = yield* Bus.Service
    const storage = yield* Storage.Service
    const loaded = new Map<ID, Loaded>()

    const read = Effect.fn("ConfigInstructionPlugin.read")(function* (projectID: ID) {
      const directory = yield* ProjectDirectory.Service.pipe(
        Effect.provide(ProjectDirectory.layer(context.location.workspaceID, projectID)),
        Effect.provideService(Storage.Service, storage),
        Effect.provideService(Bus.Service, bus),
      )
      return yield* ProjectInstruction.read(directory).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to load instruction source", { source: projectID, cause }).pipe(
            Effect.as(Instruction.unavailable),
          ),
        ),
      )
    })

    const refresh = Effect.fn("ConfigInstructionPlugin.refresh")(function* (projectID: ID) {
      loaded.set(projectID, yield* read(projectID))
    })

    const changes = yield* bus.subscribe([FileChanged, Updated, Deleted])
    yield* changes.pipe(
      Stream.filter((event) => event.type !== "project.file.changed" || event.data.path === ProjectInstruction.path),
      Stream.debounce("100 millis"),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "project.deleted") loaded.delete(event.data.projectID)
          else yield* refresh(event.type === "project.updated" ? event.data.project.id : event.data.projectID)
          yield* context.instruction.reload()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    // Archiving keeps a Project's instructions so restoring returns it to how it was.
    const all = [...(yield* projects.list()), ...(yield* projects.list({ archived: true }))]
    yield* Effect.forEach(all, (project) => refresh(project.id), { discard: true })
    yield* context.instruction.transform((editor) => {
      for (const value of loaded.values()) {
        if ("_tag" in value && value._tag === "Unavailable") {
          editor.unavailable()
          continue
        }
        if (!("_tag" in value)) editor.add(value)
      }
    })
  }),
})
