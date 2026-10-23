import { Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"

export default Plugin.define({
  id: "project.tool.echo",
  effect: (context) =>
    Effect.asVoid(
      context.tool.transform((editor) => {
        editor.add({
          name: "echo",
          description: "Echo text back to the caller.",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          execution: "sandbox",
          implementation: {
            type: "inline",
            language: "typescript",
            body: `return {
  output: input.text,
  content: [{ type: "text", text: input.text }],
}`,
          },
        })
      }),
    ),
})
