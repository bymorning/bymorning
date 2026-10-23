export * as ReferenceInstruction from "./reference-instruction.js"

import { Effect, Schema } from "effect"
import { Instruction } from "./instruction.js"
import { Reference } from "./reference.js"

const Summary = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  description: Schema.String.pipe(Schema.optional),
})

const entries = (references: ReadonlyArray<typeof Summary.Type>) =>
  references.flatMap((reference) => [
    "  <reference>",
    `    <name>${reference.name}</name>`,
    `    <path>${reference.path}</path>`,
    ...(reference.description === undefined ? [] : [`    <description>${reference.description}</description>`]),
    "  </reference>",
  ])

const render = (references: ReadonlyArray<typeof Summary.Type>) =>
  [
    "Project references provide additional directories that can be accessed when relevant.",
    "<available_references>",
    ...entries(references),
    "</available_references>",
  ].join("\n")

const update = (previous: ReadonlyArray<typeof Summary.Type>, current: ReadonlyArray<typeof Summary.Type>) => {
  const diff = Instruction.diffByKey(
    previous,
    current,
    (reference) => reference.name,
    (before, after) => before.path !== after.path || before.description !== after.description,
  )
  // Additions and removals render as small deltas; anything else restates the full list.
  if (diff.changed.length > 0 || (diff.added.length === 0 && diff.removed.length === 0))
    return [
      "The available project references have changed. This list supersedes the previous reference list.",
      render(current),
    ].join("\n")
  return [
    ...(diff.added.length === 0
      ? []
      : ["New project references are available in addition to those previously listed:", ...entries(diff.added)]),
    ...(diff.removed.length === 0
      ? []
      : [
          `The following project references are no longer available and must not be used: ${diff.removed.map((reference) => reference.name).join(", ")}.`,
        ]),
  ].join("\n")
}

export function load(references: Reference.Interface): Effect.Effect<Instruction.List> {
  return Effect.gen(function* () {
    const available = (yield* references.list())
      .filter((reference) => reference.hidden !== true && reference.description !== undefined)
      .map((reference) => ({
        name: reference.name,
        path: `reference:${reference.name}`,
        description: reference.description,
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name))
    return Instruction.make<ReadonlyArray<typeof Summary.Type>>({
      key: Instruction.Key.make("core/reference-guidance"),
      codec: Schema.toCodecJson(Schema.Array(Summary)),
      read: Effect.succeed(available.length === 0 ? Instruction.removed : available),
      render: {
        initial: render,
        changed: update,
        removed: () => "Project reference guidance is no longer available. Do not use previously listed references.",
      },
    })
  })
}
