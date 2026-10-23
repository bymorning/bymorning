/** Toolkit Skill catalog Tools. */
import type { ToolEditor } from "@bymorning/plugin/effect/tool"
import { SkillSchema } from "@bymorning/schema/skill"
import { Effect, Schema } from "effect"
import { Actor } from "../../../actor.js"
import { Skill } from "../../../skill.js"
import { Tool } from "../../../tool.js"
import { operational } from "./toolkit-shared.js"

export const SkillNamespace = "toolkit.skill" as const

const SkillIDInput = Schema.Struct({ skillID: SkillSchema.ID })
const SkillList = Schema.Struct({ skills: Schema.Array(SkillSchema.Info) })

/** Keep the domain's administrator refusal legible; map only genuine lookup failures to not-found. */
const mapError = (id: string) => (error: unknown) =>
  error instanceof Actor.ForbiddenError
    ? new Tool.Error({ message: error.message })
    : new Tool.Error({ message: `Skill not found: ${id}` })

export const registerSkillTools = (editor: ToolEditor, skill: Skill.Interface) => {
  editor.namespace({
    name: SkillNamespace,
    description: "Use when the user wants to list, get, create, update, or delete Skills in the effective catalog.",
  })
  editor.add({
    name: "list",
    description: "Use when the user wants to list effective Skills.",
    input: Schema.Struct({}),
    output: SkillList,
    options: { ...operational("skill_list", SkillNamespace) },
    execute: (_input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "skill_list", resources: ["skill"] })
        return { output: { skills: yield* skill.list } }
      }),
  })
  editor.add({
    name: "get",
    description: "Use when the user wants to get one Skill by ID.",
    input: SkillIDInput,
    output: SkillSchema.Info,
    options: { ...operational("skill_get", SkillNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "skill_get", resources: [input.skillID] })
        return {
          output: yield* skill.get(input.skillID).pipe(
            Effect.mapError(() => new Tool.Error({ message: `Skill not found: ${input.skillID}` })),
          ),
        }
      }),
  })
  editor.add({
    name: "create",
    description: "Use when the user wants to create a Skill.",
    input: SkillSchema.Create,
    output: SkillSchema.Info,
    options: { ...operational("skill_create", SkillNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "skill_create", resources: [input.name] })
        return {
          output: yield* skill.create(input).pipe(
            Effect.mapError((error) => new Tool.Error({ message: error.message })),
          ),
        }
      }),
  })
  editor.add({
    name: "update",
    description: "Use when the user wants to replace one Skill.",
    input: SkillSchema.Info,
    output: SkillSchema.Info,
    options: { ...operational("skill_update", SkillNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "skill_update", resources: [input.id] })
        return {
          output: yield* skill.update(input).pipe(Effect.mapError(mapError(input.id))),
        }
      }),
  })
  editor.add({
    name: "delete",
    description: "Use when the user wants to delete one Skill.",
    input: SkillIDInput,
    output: Schema.Struct({ deleted: SkillSchema.ID }),
    options: { ...operational("skill_delete", SkillNamespace) },
    execute: (input, toolContext) =>
      Effect.gen(function* () {
        yield* toolContext.permission({ action: "skill_delete", resources: [input.skillID] })
        yield* skill.delete(input.skillID).pipe(Effect.mapError(mapError(input.skillID)))
        return { output: { deleted: input.skillID } }
      }),
  })
}
