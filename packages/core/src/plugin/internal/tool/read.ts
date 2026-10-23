import { Tool } from "../../../tool.js"
import { bind } from "./binding.js"
import { Context, Effect, Option, Schema, Stream } from "effect"
import type { Workspace } from "@bymorning/schema/workspace"
import { readFile } from "node:fs/promises"
import { define } from "@bymorning/plugin/effect/plugin"
import { ProjectDirectory } from "../../../project-directory.js"
import { Reference } from "../../../reference.js"
import { ReferenceDirectory } from "../../../reference-directory.js"
import { SessionInstructions } from "../../../session/instructions.js"

const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "Project-relative path or reference:<name>/path of the UTF-8 text file to read",
  }),
})

const description = `Read a UTF-8 text file from the current Project Directory.

Paths are Project-relative. References such as @src/index.ts and @"docs/my file.md" identify Project Files; pass the unquoted path, such as src/index.ts or docs/my file.md. Configured reference files can be read with reference:<name>/path.`

/** Core Project File read Tool plugin. */
export const ReadTool = {
  name: "read",
  options: { codemode: false },
  description,
  input: Input,
  output: Schema.String,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      if (context.caller.type !== "session")
        return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
      const sessionID = context.caller.sessionID
      if (input.path.startsWith("reference:")) {
        const references = yield* Reference.Service
        const logical = ReferenceDirectory.parse(input.path)
        if (Option.isNone(logical))
          return yield* Effect.fail(new Tool.Error({ message: `Invalid reference path: ${input.path}` }))
        const resource = `reference:${logical.value.name}`
        yield* context.permission({
          action: "read",
          resources: [resource],
          save: [resource],
          metadata: { reference: logical.value.name, path: logical.value.path },
        })
        const resolved = yield* ReferenceDirectory.resolve(references, input.path).pipe(
          Effect.mapError(
            (error) =>
              new Tool.Error({
                message:
                  error._tag === "ReferenceDirectory.NotFoundError"
                    ? `Reference file not found: ${input.path}`
                    : `Invalid reference path: ${input.path}`,
              }),
          ),
        )
        const body = yield* Effect.tryPromise(() => readFile(resolved.absolute)).pipe(
          Effect.mapError(
            (error) => new Tool.Error({ message: `Unable to read reference file: ${input.path}`, error }),
          ),
        )
        const result = yield* Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(body)).pipe(
          Effect.mapError(() => new Tool.Error({ message: `Reference file is not valid UTF-8 text: ${input.path}` })),
        )
        return { output: result, content: [{ type: "text" as const, text: result }] }
      }
      const directory = yield* ProjectDirectory.Service
      const path = yield* ProjectDirectory.parse(input.path).pipe(
        Effect.mapError((error) => failure(input.path, error)),
      )
      const resource = ProjectDirectory.resource(directory.projectID, path)
      yield* context.permission({
        action: "read",
        resources: [resource],
        save: [resource],
        metadata: { projectID: directory.projectID, path },
      })
      const file = yield* directory.read(path).pipe(Effect.mapError((error) => failure(input.path, error)))
      const body = yield* Stream.mkUint8Array(file.content).pipe(Effect.mapError((error) => failure(input.path, error)))
      const result = yield* Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(body)).pipe(
        Effect.mapError(
          () =>
            new Tool.Error({
              message: `Project File is binary, not UTF-8 text: ${input.path} (${body.byteLength} bytes). Its contents cannot be read as text with this Tool; process it with the Code Interpreter if available.`,
            }),
        ),
      )
      yield* Effect.gen(function* () {
        const available = new Set(yield* directory.list)
        const paths = SessionInstructions.candidates(path).filter((candidate) => available.has(candidate))
        if (paths.length === 0) return
        const instructions = yield* SessionInstructions.Service
        yield* instructions.load({ sessionID: sessionID, paths })
      }).pipe(Effect.catch((error) => Effect.logWarning("Failed to load nested Project instructions", { error })))
      return { output: result, content: [{ type: "text" as const, text: result }] }
    }),
}

const failure = (
  path: string,
  error: ProjectDirectory.InvalidPathError | ProjectDirectory.NotFoundError | ProjectDirectory.OperationError,
) => {
  if (error._tag === "ProjectDirectory.InvalidPathError")
    return new Tool.Error({ message: `Invalid Project File path: ${path}` })
  if (error._tag === "ProjectDirectory.NotFoundError")
    return new Tool.Error({ message: `Project File not found: ${path}` })
  return new Tool.Error({ message: `Unable to read Project File: ${path}` })
}

/** Existing Session-owned discovery seam, captured once for read and glob setup. */
export class Instructions extends Context.Service<
  Instructions,
  (directory: ProjectDirectory.Interface) => SessionInstructions.Interface
>()("@bymorning/core/PluginInstructions") {}
export const makeInstructions = (workspaceID: Workspace.ID) => SessionInstructions.make(workspaceID)

export const makeRead = Effect.gen(function* () {
  const instructions = yield* Instructions
  return yield* bind({
    ...ReadTool,
    execute: (input, context) =>
      ProjectDirectory.Service.use((directory) =>
        ReadTool.execute(input, context).pipe(
          Effect.provideService(SessionInstructions.Service, instructions(directory)),
        ),
      ),
  })
})

export const ReadPlugin = define({
  id: "core.tool.read",
  effect: (context) =>
    makeRead.pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
