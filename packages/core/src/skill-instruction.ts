/** Exposes Skill-derived Instruction sources. */
export * as SkillInstruction from "./skill-instruction.js"

import type { Permission as PermissionSchema } from "@bymorning/schema/permission"
import { SkillSchema } from "@bymorning/schema/skill"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Instruction } from "./instruction.js"
import { Permission } from "./permission.js"
import { Skill } from "./skill.js"

const Summary = Schema.Struct({ id: SkillSchema.ID, name: SkillSchema.Name, description: Schema.String })
type Summary = typeof Summary.Type

const entries = (skills: ReadonlyArray<Summary>) =>
  skills.flatMap((skill) => [
    "  <skill>",
    `    <id>${skill.id}</id>`,
    `    <name>${skill.name}</name>`,
    `    <description>${skill.description}</description>`,
    "  </skill>",
  ])

const render = (skills: ReadonlyArray<Summary>) =>
  [
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    "When the user references an available skill as @<skill-id>, load that skill before responding.",
    ...(skills.length === 0
      ? ["No skills are currently available."]
      : ["<available_skills>", ...entries(skills), "</available_skills>"]),
  ].join("\n")

const update = (previous: ReadonlyArray<Summary>, current: ReadonlyArray<Summary>) => {
  const diff = Instruction.diffByKey(
    previous,
    current,
    (skill) => skill.id,
    (before, after) => before.name !== after.name || before.description !== after.description,
  )
  if (diff.changed.length > 0 || (diff.added.length === 0 && diff.removed.length === 0))
    return [
      "The available skills have changed. This list supersedes the previous available skills list.",
      render(current),
    ].join("\n")
  return [
    ...(diff.added.length === 0
      ? []
      : ["New skills are available in addition to those previously listed:", ...entries(diff.added)]),
    ...(diff.removed.length === 0
      ? []
      : [
          `The following skill IDs are no longer available and must not be used: ${diff.removed.map((skill) => skill.id).join(", ")}.`,
        ]),
  ].join("\n")
}

export interface Interface {
  readonly load: (permissions: PermissionSchema.Ruleset) => Effect.Effect<Instruction.List>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SkillInstruction") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skills = yield* Skill.Service
    return Service.of({
      load: Effect.fn("SkillInstruction.load")(function* (permissions) {
        const available = (yield* skills.list)
          .filter(({ id }) => Permission.evaluate("skill", id, permissions).effect !== "deny")
          .map(({ id, name, description }) => ({ id, name, description }))
          .toSorted((a, b) => a.id.localeCompare(b.id))
        return Instruction.make<ReadonlyArray<Summary>>({
          key: Instruction.Key.make("core/skill-instructions"),
          codec: Schema.toCodecJson(Schema.Array(Summary)),
          read: Effect.succeed(available.length === 0 ? Instruction.removed : available),
          render: {
            initial: render,
            changed: update,
            removed: () => "Skill guidance is no longer available. Do not use any previously listed skill.",
          },
        })
      }),
    })
  }),
)

export const workspaceNodes = <E>(skill: WorkspaceNode<Skill.Service, E>) =>
  makeWorkspaceNode({ service: Service, layer, deps: [skill] })

export const node = makeWorkspaceNode({ service: Service, layer, deps: [Skill.node] })
