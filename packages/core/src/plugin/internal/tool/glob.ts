import { Tool } from "../../../tool.js"
import { bind } from "./binding.js"
import { define } from "@bymorning/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"
import { minimatch } from "minimatch"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { ProjectDirectory } from "../../../project-directory.js"
import { Reference } from "../../../reference.js"
import { ReferenceDirectory } from "../../../reference-directory.js"
import { SessionInstructions } from "../../../session/instructions.js"
import { Instructions } from "./read.js"

const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))
const Input = Schema.Struct({
  pattern: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "Glob pattern to match files against" }),
  path: Schema.optionalKey(Schema.String).annotate({
    description: "Project-relative or reference:<name>/path directory to search. Defaults to the Project root.",
  }),
  limit: Schema.optionalKey(Limit).annotate({
    description: "Maximum number of matching files to return (default: 100)",
  }),
})
const Output = Schema.Array(Schema.String)

/** Core Project File glob Tool. */
export const GlobTool = {
  name: "glob",
  description:
    'Search Project File paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx"). A path can use reference:<name>/path to search a configured reference.',
  input: Input,
  output: Output,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      if (context.caller.type !== "session")
        return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
      const sessionID = context.caller.sessionID
      if (input.path?.startsWith("reference:")) {
        const references = yield* Reference.Service
        const logical = ReferenceDirectory.parse(input.path)
        if (Option.isNone(logical))
          return yield* Effect.fail(new Tool.Error({ message: `Invalid reference path: ${input.path}` }))
        const resource = `reference:${logical.value.name}`
        yield* context.permission({
          action: "glob",
          resources: [resource],
          save: [resource],
          metadata: {
            reference: logical.value.name,
            path: logical.value.path,
            pattern: input.pattern,
            limit: input.limit,
          },
        })
        const resolved = yield* ReferenceDirectory.resolve(references, input.path).pipe(
          Effect.mapError(
            (error) =>
              new Tool.Error({
                message:
                  error._tag === "ReferenceDirectory.NotFoundError"
                    ? `Reference path not found: ${input.path}`
                    : `Invalid reference path: ${input.path}`,
              }),
          ),
        )
        const files = yield* Effect.tryPromise(async () => {
          const pending = [resolved.absolute]
          const found: string[] = []
          while (pending.length > 0) {
            const directory = pending.pop()
            if (directory === undefined) break
            for (const entry of await readdir(directory, { withFileTypes: true })) {
              const absolute = path.join(directory, entry.name)
              if (entry.isDirectory()) pending.push(absolute)
              else if (entry.isFile()) found.push(path.relative(resolved.absolute, absolute).split(path.sep).join("/"))
            }
          }
          return found.toSorted()
        }).pipe(
          Effect.mapError(
            (error) => new Tool.Error({ message: `Unable to list reference files: ${input.path}`, error }),
          ),
        )
        const limit = input.limit ?? 100
        const matches = files.filter((file) => minimatch(file, input.pattern, { dot: true, nocase: false }))
        const result = matches
          .slice(0, limit)
          .map((file) => `${resource}/${logical.value.path ? `${logical.value.path}/` : ""}${file}`)
        return {
          output: result,
          content: [
            {
              type: "text" as const,
              text: result.length === 0 ? "No files found" : result.map((file) => `@${file}`).join("\n"),
            },
          ],
          metadata: { count: result.length, truncated: matches.length > limit },
        }
      }
      const directory = yield* ProjectDirectory.Service
      const prefix =
        input.path === undefined
          ? undefined
          : yield* ProjectDirectory.parse(input.path.replace(/\/$/, "")).pipe(
              Effect.mapError(() => new Tool.Error({ message: `Invalid Project File path: ${input.path}` })),
            )
      yield* context.permission({
        action: "glob",
        resources: [input.pattern],
        save: [input.pattern],
        metadata: {
          projectID: directory.projectID,
          pattern: input.pattern,
          path: input.path,
          limit: input.limit,
        },
      })
      const limit = input.limit ?? 100
      const matches = (yield* directory.list.pipe(
        Effect.mapError((error) => new Tool.Error({ message: "Unable to list Project Files", error })),
      )).filter((path) => {
        if (prefix !== undefined && path !== prefix && !path.startsWith(`${prefix}/`)) return false
        const candidate = prefix === undefined ? path : path.slice(prefix.length + 1)
        return minimatch(candidate, input.pattern, { dot: true, nocase: false })
      })
      const result = matches.slice(0, limit)
      const content = result.length === 0 ? "No files found" : result.map((path) => `@${path}`).join("\n")
      if (prefix !== undefined) {
        yield* Effect.gen(function* () {
          const available = new Set(yield* directory.list)
          const paths = SessionInstructions.candidates(
            ProjectDirectory.Path.make(`${prefix}/.instruction-discovery`),
          ).filter((candidate) => available.has(candidate))
          if (paths.length === 0) return
          const instructions = yield* SessionInstructions.Service
          yield* instructions.load({ sessionID: sessionID, paths })
        }).pipe(Effect.catch((error) => Effect.logWarning("Failed to load nested Project instructions", { error })))
      }
      return {
        output: result,
        content: [{ type: "text" as const, text: content }],
        metadata: { count: result.length, truncated: matches.length > limit },
      }
    }),
}

/** Core Project File glob Tool plugin. */
export const makeGlob = Effect.gen(function* () {
  const instructions = yield* Instructions
  return yield* bind({
    ...GlobTool,
    execute: (input, context) =>
      ProjectDirectory.Service.use((directory) =>
        GlobTool.execute(input, context).pipe(
          Effect.provideService(SessionInstructions.Service, instructions(directory)),
        ),
      ),
  })
})

export const GlobPlugin = define({
  id: "core.tool.glob",
  effect: (context) =>
    makeGlob.pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
