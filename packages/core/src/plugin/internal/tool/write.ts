import { Tool } from "../../../tool.js"
import { bind } from "./binding.js"
import { Effect, Schema, Stream } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { ProjectDirectory } from "../../../project-directory.js"
import { activationNote, isEntrypoint } from "./plugin-entrypoint.js"

const Input = Schema.Struct({
  path: Schema.String.annotate({ description: "Project-relative path of the UTF-8 text file to write" }),
  content: Schema.String.annotate({ description: "Complete UTF-8 text content for the file" }),
})

const description = `Write a UTF-8 text file in the current Project Directory, replacing existing content at the same path.

Paths are Project-relative. References such as @src/index.ts and @"docs/my file.md" identify Project Files; pass the unquoted path, such as src/index.ts or docs/my file.md.`

/** Core Project File write Tool plugin. */
export const WriteTool = {
  name: "write",
  options: { codemode: false },
  description,
  input: Input,
  output: Schema.String,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const path = yield* ProjectDirectory.parse(input.path).pipe(
        Effect.mapError((error) => failure(input.path, error)),
      )
      const resource = ProjectDirectory.resource(directory.projectID, path)
      yield* context.permission({
        action: "write",
        resources: [resource],
        save: [resource],
        metadata: { projectID: directory.projectID, path },
      })
      const body = new TextEncoder().encode(input.content)
      yield* directory
        .write(path, {
          content: Stream.succeed(body),
          contentType: "text/plain; charset=utf-8",
          contentLength: body.length,
        })
        .pipe(Effect.mapError((error) => failure(input.path, error)))
      const result = `Wrote Project File: @${path}${isEntrypoint(path) ? ` ${activationNote}` : ""}`
      return { output: result, content: [{ type: "text" as const, text: result }] }
    }),
}

const failure = (path: string, error: ProjectDirectory.InvalidPathError | ProjectDirectory.OperationError) =>
  new Tool.Error({
    message:
      error._tag === "ProjectDirectory.InvalidPathError"
        ? `Invalid Project File path: ${path}`
        : `Unable to write Project File: ${path}`,
  })

export const WritePlugin = define({
  id: "core.tool.write",
  effect: (context) =>
    bind(WriteTool).pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
