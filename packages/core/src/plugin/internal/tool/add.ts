import { Effect, Schema } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { Tool } from "../../../tool.js"

const Input = Schema.Struct({ left: Schema.Finite, right: Schema.Finite })

/** Core addition Tool plugin. */
export const AddTool = ({
  name: "add",
  options: { codemode: false },
  description: "Add two numbers.",
  input: Input,
  output: Schema.Finite,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      const { left, right } = input
      yield* context.permission({
        action: "add",
        resources: [`${left}+${right}`],
        save: ["*"],
        metadata: { left, right },
      })
      const result = left + right
      return { result, content: [{ type: "text" as const, text: String(result) }] }
    }),
})

export const AddPlugin = define({
  id: "core.tool.add",
  effect: (context) => Effect.asVoid(context.tool.transform((editor) => editor.add(AddTool))),
})
