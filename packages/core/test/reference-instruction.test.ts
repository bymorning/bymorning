import { describe, expect, it } from "@effect/vitest"
import * as ReferenceSchema from "@bymorning/schema/reference"
import { AbsolutePath } from "@bymorning/schema/schema"
import { Effect } from "effect"
import { Instruction } from "../src/instruction.js"
import { ReferenceInstruction } from "../src/reference-instruction.js"
import type { Reference } from "../src/reference.js"

const service = (list: () => ReferenceSchema.Info[]): Reference.Interface => ({
  list: () => Effect.sync(list),
  transform: () => Effect.succeed({ dispose: Effect.void }),
  reload: () => Effect.void,
})

const reference = (name: string, description?: string, hidden?: boolean) =>
  ReferenceSchema.Info.make({
    name,
    path: AbsolutePath.make(`/${name}`),
    ...(description === undefined ? {} : { description }),
    ...(hidden === undefined ? {} : { hidden }),
    source: ReferenceSchema.LocalSource.make({
      type: "local",
      path: AbsolutePath.make(`/${name}`),
      ...(description === undefined ? {} : { description }),
      ...(hidden === undefined ? {} : { hidden }),
    }),
  })

const readAvailable = Effect.fn("ReferenceInstructionTest.readAvailable")(function* (references: Reference.Interface) {
  const instructions = yield* ReferenceInstruction.load(references)
  const source = instructions[0]
  if (source === undefined) return yield* Effect.die("missing reference instruction source")
  const value = yield* source.read
  if (!Array.isArray(value)) return yield* Effect.die("reference instruction source is not available")
  return { source, value }
})

describe("ReferenceInstruction", () => {
  it.effect("lists available references in the instructions using logical paths", () =>
    Effect.gen(function* () {
      const { source, value } = yield* readAvailable(
        service(() => [reference("docs", "Use for product documentation")]),
      )
      const text = source.initial(value)

      expect(text).toContain("<available_references>")
      expect(text).toContain("<name>docs</name>")
      expect(text).toContain("<path>reference:docs</path>")
      expect(text).not.toContain("<path>/docs</path>")
      expect(text).toContain("<description>Use for product documentation</description>")
    }),
  )

  it.effect("omits instructions when no references are available", () =>
    Effect.gen(function* () {
      const instructions = yield* ReferenceInstruction.load(service(() => []))
      const admission = yield* Instruction.read(instructions).pipe(Effect.flatMap((observed) => Instruction.diff(observed)))
      expect(Instruction.renderInitial(instructions, admission.blobs)).toBe("")
    }),
  )

  it.effect("omits references without descriptions", () =>
    Effect.gen(function* () {
      const instructions = yield* ReferenceInstruction.load(service(() => [reference("docs")]))
      const admission = yield* Instruction.read(instructions).pipe(Effect.flatMap((observed) => Instruction.diff(observed)))
      expect(Instruction.renderInitial(instructions, admission.blobs)).toBe("")
    }),
  )

  it.effect("omits hidden references", () =>
    Effect.gen(function* () {
      const { source, value } = yield* readAvailable(
        service(() => [reference("hidden", "Private material", true), reference("docs", "Public material")]),
      )
      const text = source.initial(value)
      expect(text).toContain("<name>docs</name>")
      expect(text).not.toContain("<name>hidden</name>")
    }),
  )

  it.effect("announces added and removed references as deltas", () => {
    const references = { current: [reference("docs", "Use for product documentation")] }
    const referenceService = service(() => references.current)
    return Effect.gen(function* () {
      const initialized = yield* readAvailable(referenceService)

      references.current = [
        reference("docs", "Use for product documentation"),
        reference("examples", "Use for examples"),
      ]
      const added = yield* readAvailable(referenceService)
      expect(added.source.changed(initialized.value, added.value)).toBe(
        [
          "New project references are available in addition to those previously listed:",
          "  <reference>",
          "    <name>examples</name>",
          "    <path>reference:examples</path>",
          "    <description>Use for examples</description>",
          "  </reference>",
        ].join("\n"),
      )

      references.current = [reference("examples", "Use for examples")]
      const removed = yield* readAvailable(referenceService)
      expect(removed.source.changed(added.value, removed.value)).toBe(
        "The following project references are no longer available and must not be used: docs.",
      )
    })
  })
})
