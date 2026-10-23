import { Tool } from "../../../tool.js"
import { bind } from "./binding.js"
import { define } from "@bymorning/plugin/effect/plugin"
import { Effect, Option, Schema, Stream } from "effect"
import { minimatch } from "minimatch"
import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { ProjectDirectory } from "../../../project-directory.js"
import { Reference } from "../../../reference.js"
import { ReferenceDirectory } from "../../../reference-directory.js"

const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))
const Input = Schema.Struct({
  pattern: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "JavaScript regular expression to search for in Project File contents",
  }),
  path: Schema.optionalKey(Schema.String).annotate({
    description: "Project-relative file/directory or reference:<name>/path to search. Defaults to the Project root.",
  }),
  include: Schema.optionalKey(Schema.String).annotate({
    description: 'Glob pattern to filter files (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: Schema.optionalKey(Limit).annotate({
    description: "Maximum number of matching lines to return (default: 100)",
  }),
})
const Match = Schema.Struct({ path: Schema.String, line: Schema.Int, text: Schema.String })
const Output = Schema.Array(Match)

/** Core Project File grep Tool. */
export const GrepTool = {
  name: "grep",
  description:
    "Search Project File contents using regular expressions. Returns matching paths, line numbers, and line previews. A path can use reference:<name>/path to search a configured reference.",
  input: Input,
  output: Output,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      const directory = yield* ProjectDirectory.Service
      const pattern = yield* Effect.try({
        try: () => new RegExp(input.pattern),
        catch: (error): Tool.Error =>
          new Tool.Error({
            message: `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`,
          }),
      })
      if (input.path?.startsWith("reference:")) {
        const referencePath = input.path
        const references = yield* Reference.Service
        const logical = ReferenceDirectory.parse(referencePath)
        if (Option.isNone(logical))
          return yield* Effect.fail(new Tool.Error({ message: `Invalid reference path: ${referencePath}` }))
        const resource = `reference:${logical.value.name}`
        yield* context.permission({
          action: "grep",
          resources: [resource],
          save: [resource],
          metadata: {
            reference: logical.value.name,
            path: logical.value.path,
            pattern: input.pattern,
            include: input.include,
            limit: input.limit,
          },
        })
        const resolved = yield* ReferenceDirectory.resolve(references, referencePath).pipe(
          Effect.mapError(
            (error) =>
              new Tool.Error({
                message:
                  error._tag === "ReferenceDirectory.NotFoundError"
                    ? `Reference path not found: ${referencePath}`
                    : `Invalid reference path: ${referencePath}`,
              }),
          ),
        )
        const candidates = yield* Effect.tryPromise(async () => {
          if ((await stat(resolved.absolute)).isFile()) return [""]
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
            (error) => new Tool.Error({ message: `Unable to list reference files: ${referencePath}`, error }),
          ),
        )
        const selected = candidates.filter(
          (file) =>
            input.include === undefined ||
            minimatch(file || path.basename(resolved.absolute), input.include, { dot: true, matchBase: true }),
        )
        const limit = input.limit ?? 100
        const matches = yield* Effect.reduce(
          selected,
          () => [] as Array<typeof Match.Type>,
          (matches, file) => {
            if (matches.length > limit) return Effect.succeed(matches)
            const input = file.length === 0 ? referencePath : `${referencePath}/${file}`
            return ReferenceDirectory.resolve(references, input).pipe(
              Effect.flatMap((target) => Effect.tryPromise(() => readFile(target.absolute))),
              Effect.option,
              Effect.flatMap((body) =>
                Option.isNone(body) || body.value.includes(0)
                  ? Effect.succeedNone
                  : Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(body.value)).pipe(Effect.option),
              ),
              Effect.map((text) => {
                if (Option.isNone(text)) return matches
                const logicalPath = file.length === 0 ? referencePath : `${referencePath}/${file}`
                for (const [index, line] of text.value.replaceAll("\r\n", "\n").split("\n").entries()) {
                  pattern.lastIndex = 0
                  if (pattern.test(line)) matches.push({ path: logicalPath, line: index + 1, text: line })
                  if (matches.length > limit) break
                }
                return matches
              }),
            )
          },
        )
        const result = matches.slice(0, limit)
        return {
          output: result,
          content: [
            {
              type: "text" as const,
              text:
                result.length === 0
                  ? "No matches found"
                  : result.map((match) => `@${match.path}:${match.line}: ${match.text}`).join("\n"),
            },
          ],
          metadata: { matches: result.length, truncated: matches.length > limit },
        }
      }
      const target =
        input.path === undefined
          ? undefined
          : yield* ProjectDirectory.parse(input.path.replace(/\/$/, "")).pipe(
              Effect.mapError(() => new Tool.Error({ message: `Invalid Project File path: ${input.path}` })),
            )
      yield* context.permission({
        action: "grep",
        resources: [input.pattern],
        save: [input.pattern],
        metadata: {
          projectID: directory.projectID,
          pattern: input.pattern,
          path: input.path,
          include: input.include,
          limit: input.limit,
        },
      })
      const candidates = (yield* directory.list.pipe(
        Effect.mapError((error) => new Tool.Error({ message: "Unable to list Project Files", error })),
      )).filter((path) => {
        if (target !== undefined && path !== target && !path.startsWith(`${target}/`)) return false
        return input.include === undefined || minimatch(path, input.include, { dot: true, matchBase: true })
      })
      const limit = input.limit ?? 100
      const matches = yield* Effect.reduce(
        candidates,
        () => [] as Array<typeof Match.Type>,
        (matches, path) => {
          if (matches.length > limit) return Effect.succeed(matches)
          return directory.read(path).pipe(
            Effect.mapError((error) => new Tool.Error({ message: `Unable to read Project File: ${path}`, error })),
            Effect.flatMap((file) => Stream.mkUint8Array(file.content)),
            Effect.flatMap((body) =>
              body.includes(0)
                ? Effect.succeedNone
                : Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(body)).pipe(Effect.option),
            ),
            Effect.map((text) => {
              if (text._tag === "None") return matches
              for (const [index, line] of text.value.replaceAll("\r\n", "\n").split("\n").entries()) {
                pattern.lastIndex = 0
                if (pattern.test(line)) matches.push({ path, line: index + 1, text: line })
                if (matches.length > limit) break
              }
              return matches
            }),
          )
        },
      )
      const result = matches.slice(0, limit)
      return {
        output: result,
        content: [
          {
            type: "text" as const,
            text:
              result.length === 0
                ? "No matches found"
                : result.map((match) => `@${match.path}:${match.line}: ${match.text}`).join("\n"),
          },
        ],
        metadata: { matches: result.length, truncated: matches.length > limit },
      }
    }),
}

/** Core Project File grep Tool plugin. */
export const GrepPlugin = define({
  id: "core.tool.grep",
  effect: (context) =>
    bind(GrepTool).pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
