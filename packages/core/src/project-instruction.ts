export * as ProjectInstruction from "./project-instruction.js"

import { Effect, Stream } from "effect"
import { InstructionDiscovery } from "./instruction-discovery.js"
import { Instruction } from "./instruction.js"
import { ProjectDirectory } from "./project-directory.js"

export const path = ProjectDirectory.Path.make("AGENTS.md")

export const read = Effect.fn("ProjectInstruction.read")(function* (directory: ProjectDirectory.Interface) {
  if (!(yield* directory.list).includes(path)) return Instruction.removed
  const file = yield* directory.read(path)
  const content = yield* Stream.mkUint8Array(file.content).pipe(
    Effect.flatMap((bytes) => Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes))),
  )
  return new InstructionDiscovery.File({ path, content, projectID: directory.projectID })
})
