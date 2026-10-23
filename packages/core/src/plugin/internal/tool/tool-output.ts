import { ID } from "@bymorning/schema/tool-output"
import { NonNegativeInt, optional } from "@bymorning/schema/schema"
import { Tool } from "../../../tool.js"
import { Effect, Schema } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { ToolOutput } from "../../../tool-output.js"

const Input = Schema.Struct({
  outputID: ID.annotate({ description: "Opaque ID of the stored Tool output" }),
  cursor: NonNegativeInt.pipe(optional).annotate({
    description: "Optional UTF-8 byte cursor returned by a previous page",
  }),
})

const Output = Schema.Struct({
  next: NonNegativeInt.pipe(optional),
})

/** The core stored Tool output retrieval definition; its Workspace authority comes from Effect context. */
export const ToolOutputPlugin = define({
  id: "core.tool.tool-output",
  effect: (context) =>
    Effect.gen(function* () {
      const toolOutput = yield* ToolOutput.Service
      yield* context.tool.transform((editor) => editor.add(tool(toolOutput)))
    }),
})

const tool = (toolOutput: ToolOutput.Interface) =>
  ({
    name: "tool_output",
    options: { codemode: false },
    description: "Retrieve one bounded page of stored Tool output. Use the returned byte cursor to continue reading.",
    input: Input,
    output: Output,
    execute: (input: typeof Input.Type, context: Tool.Context) =>
      Effect.gen(function* () {
        if (context.caller.type !== "session")
          return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
        const sessionID = context.caller.sessionID
        yield* context.permission({
          action: "tool_output",
          resources: [input.outputID],
          save: [input.outputID],
          metadata: { outputID: input.outputID, cursor: input.cursor ?? 0 },
        })
        const page = yield* toolOutput
          .readForTool(sessionID, input.outputID, input.cursor === undefined ? {} : { cursor: input.cursor })
          .pipe(Effect.mapError(() => new Tool.Error({ message: "Tool output is unavailable" })))
        const next = page.cursor < page.size ? page.cursor : undefined
        return {
          output: next === undefined ? {} : { next },
          content: [{ type: "text" as const, text: page.content }],
          metadata: {
            truncated: next !== undefined,
            outputID: input.outputID,
            cursor: input.cursor ?? 0,
            ...(next === undefined ? {} : { next }),
          },
        }
      }),
  }) satisfies Tool.Info<typeof Input, typeof Output>
