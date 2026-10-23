import { Tool } from "../../../tool.js"
import { bind } from "./binding.js"
import { Effect, Schema, Stream } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { CodeInterpreter } from "../../../code-interpreter.js"
import { ProjectDirectory } from "../../../project-directory.js"

const Input = Schema.Struct({
  path: Schema.String.annotate({ description: "Project-relative path of the UTF-8 source file to execute" }),
})
const Output = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.optional(Schema.Finite),
})

const description = `Execute one UTF-8 Project source file in a fresh AgentCore Code Interpreter environment.

Paths are Project-relative. A reference such as @script.ts identifies script.ts; pass script.ts as path. Supported inferred extensions are exactly .py, .js, and .ts. Execution is single-file: sibling Project imports are unavailable.`

/** Core Project source execution Tool. */
export const ExecuteTool = {
  name: "run",
  description,
  input: Input,
  output: Output,
  options: { permission: "execute", codemode: false },
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      if (context.caller.type !== "session")
        return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
      const sessionID = context.caller.sessionID
      const directory = yield* ProjectDirectory.Service
      const path = yield* ProjectDirectory.parse(input.path).pipe(
        Effect.mapError(() => new Tool.Error({ message: `Invalid Project File path: ${input.path}` })),
      )
      const language = CodeInterpreter.languageForPath(path)
      if (language === undefined) {
        return yield* Effect.fail(new Tool.Error({ message: `Unsupported source extension: ${path}` }))
      }
      const resource = ProjectDirectory.resource(directory.projectID, path)
      yield* context.permission({
        action: "execute",
        resources: [resource],
        save: [resource],
        metadata: { projectID: directory.projectID, path, language },
      })
      const file = yield* directory.read(path).pipe(
        Effect.mapError(
          (error) =>
            new Tool.Error({
              message:
                error._tag === "ProjectDirectory.NotFoundError"
                  ? `Project File not found: ${path}`
                  : `Unable to read Project File: ${path}`,
              error,
            }),
        ),
      )
      const body = yield* Stream.mkUint8Array(file.content).pipe(
        Effect.mapError((error) => new Tool.Error({ message: `Unable to read Project File: ${path}`, error })),
      )
      const code = yield* Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(body)).pipe(
        Effect.mapError((error) => new Tool.Error({ message: `Project File is not valid UTF-8 text: ${path}`, error })),
      )
      const codeInterpreter = yield* CodeInterpreter.Service
      const result = yield* codeInterpreter.execute({ type: "code", sessionName: sessionID, language, code }).pipe(
        Effect.timeout("2 minutes"),
        Effect.mapError(
          (error) =>
            new Tool.Error({
              message:
                error._tag === "TimeoutError"
                  ? `Project source timed out after 2 minutes: ${path}`
                  : error._tag === "CodeInterpreter.UnavailableError"
                    ? CodeInterpreter.reason(error)
                    : `Unable to run ${path}: ${CodeInterpreter.reason(error)}`,
              error,
            }),
        ),
      )
      const content = [result.stdout, result.stderr].filter((text) => text.length > 0).join("\n")
      return { output: result, content: [{ type: "text" as const, text: content || `(exit ${result.exitCode ?? 0})` }] }
    }).pipe(Effect.scoped),
}

/** Core Project source execution plugin. */
export const ExecutePlugin = define({
  id: "core.tool.execute",
  effect: (context) =>
    bind(ExecuteTool).pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
