import { SkillSchema } from "@bymorning/schema/skill"
import { Tool } from "../../../tool.js"
import { Effect, Schema } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { Skill } from "../../../skill.js"

const Input = Schema.Struct({
  id: SkillSchema.ID.annotate({ description: "ID of the available Skill to load" }),
})

/** Core Skill-loading Tool plugin. */
export const SkillTool = {
  name: "skill",
  options: { codemode: false },
  description: "Load the complete instructions for an available Skill by ID.",
  input: Input,
  output: SkillSchema.Info,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* context.permission({
        action: "skill",
        resources: [input.id],
        save: [input.id],
        metadata: { skillID: input.id },
      })
      const loaded = yield* skill
        .get(input.id)
        .pipe(Effect.mapError(() => new Tool.Error({ message: `Skill not found: ${input.id}` })))
      return { output: loaded, content: [{ type: "text" as const, text: loaded.instructions }] }
    }),
}

export const makeSkill = Effect.gen(function* () {
  const skill = yield* Skill.Service
  const tool = {
    ...SkillTool,
    execute: (input: typeof Input.Type, caller: Tool.Context) =>
      SkillTool.execute(input, caller).pipe(Effect.provideService(Skill.Service, skill)),
  } satisfies Tool.Info<typeof Input, typeof SkillSchema.Info>
  return tool
})

export const SkillToolPlugin = define({
  id: "core.tool.skill",
  effect: (context) =>
    makeSkill.pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
