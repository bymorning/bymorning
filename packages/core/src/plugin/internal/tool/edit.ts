import { Tool } from "../../../tool.js"
import { bind } from "./binding.js"
import { Effect, Schema, Stream } from "effect"
import { define } from "@bymorning/plugin/effect/plugin"
import { ProjectDirectory } from "../../../project-directory.js"
import { activationNote, isEntrypoint } from "./plugin-entrypoint.js"

const Input = Schema.Struct({
  path: Schema.String.annotate({ description: "Project-relative path of the UTF-8 text file to edit" }),
  oldString: Schema.String.annotate({ description: "Exact text to find and replace" }),
  newString: Schema.String.annotate({ description: "Text to replace oldString with (must differ from oldString)" }),
  replaceAll: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Whether to replace every occurrence of oldString. When false, oldString must occur exactly once. Defaults to false.",
  }),
})

const Output = Schema.Struct({ replacements: Schema.Int })

interface Match {
  readonly start: number
  readonly end: number
}

const description = `Edit a UTF-8 text file in the current Project Directory by replacing exact text.

oldString and newString must differ, and oldString must include exact whitespace and indentation. By default oldString must occur exactly once; include more surrounding context to make it unique, or set replaceAll to true to replace every occurrence.

Paths are Project-relative. References such as @src/index.ts and @"docs/my file.md" identify Project Files; pass the unquoted path, such as src/index.ts or docs/my file.md.`

/** Core Project File exact-edit Tool plugin. */
export const EditTool = {
  name: "edit",
  options: { codemode: false },
  description,
  input: Input,
  output: Output,
  execute: (input: typeof Input.Type, context: Tool.Context) =>
    Effect.gen(function* () {
      if (input.oldString === input.newString) {
        return yield* Effect.fail(
          new Tool.Error({ message: "No changes to apply: oldString and newString are identical." }),
        )
      }
      if (input.oldString === "") {
        return yield* Effect.fail(
          new Tool.Error({ message: "oldString must not be empty. Use write to create or overwrite a file." }),
        )
      }

      const directory = yield* ProjectDirectory.Service
      const path = yield* ProjectDirectory.parse(input.path).pipe(
        Effect.mapError((error) => failure(input.path, error)),
      )
      const resource = ProjectDirectory.resource(directory.projectID, path)
      yield* context.permission({
        action: "edit",
        resources: [resource],
        save: [resource],
        metadata: { projectID: directory.projectID, path },
      })
      const file = yield* directory.read(path).pipe(Effect.mapError((error) => failure(input.path, error)))
      const body = yield* Stream.mkUint8Array(file.content).pipe(Effect.mapError((error) => failure(input.path, error)))
      const source = yield* Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(body)).pipe(
        Effect.mapError(() => new Tool.Error({ message: `Project File is not valid UTF-8 text: ${input.path}` })),
      )
      const ending = source.includes("\r\n") ? "\r\n" : "\n"
      const oldString = input.oldString.replaceAll("\r\n", "\n").replaceAll("\n", ending)
      const newString = input.newString.replaceAll("\r\n", "\n").replaceAll("\n", ending)
      const exact = findOccurrences(source, oldString)
      // These one-to-one mappings preserve offsets into the original source.
      const unicode = exact.length > 0 ? [] : findOccurrences(normalizeForMatch(source), normalizeForMatch(oldString))
      const trailing = exact.length > 0 || unicode.length > 0 ? [] : findLineOccurrences(source, oldString)
      const matches = exact.length > 0 ? exact : unicode.length > 0 ? unicode : trailing
      const replacements = matches.length
      if (replacements === 0) {
        return yield* Effect.fail(
          new Tool.Error({
            message: `Could not find oldString in ${input.path}. It must match exactly, including whitespace and indentation.`,
          }),
        )
      }
      if (replacements > 1 && input.replaceAll !== true) {
        return yield* Effect.fail(
          new Tool.Error({
            message: `Found ${replacements} matches for oldString, but expected exactly one. Add more surrounding context to make oldString unique, or set replaceAll to true to replace every occurrence.`,
          }),
        )
      }

      const replaced = (input.replaceAll === true ? matches : matches.slice(0, 1))
        .toReversed()
        .reduce((content, match) => `${content.slice(0, match.start)}${newString}${content.slice(match.end)}`, source)
      const content = `${hasUtf8Bom(body) ? "\uFEFF" : ""}${replaced}`
      const encoded = new TextEncoder().encode(content)
      yield* directory
        .write(path, {
          content: Stream.succeed(encoded),
          contentType: file.contentType ?? "text/plain; charset=utf-8",
          contentLength: encoded.length,
        })
        .pipe(Effect.mapError((error) => failure(input.path, error)))
      const result = { replacements }
      const summary = `Edited Project File: @${path} (${replacements} replacement${replacements === 1 ? "" : "s"})${isEntrypoint(path) ? ` ${activationNote}` : ""}`
      return { output: result, content: [{ type: "text" as const, text: summary }] }
    }),
}

const normalizeForMatch = (value: string) =>
  value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")

const findOccurrences = (content: string, search: string) => {
  const result = Array<Match>()
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    result.push({ start: offset, end: offset + search.length })
    offset += search.length
  }
  return result
}

const findLineOccurrences = (content: string, search: string) => {
  const trailingNewline = search.endsWith("\n")
  const expected = search.split("\n")
  if (trailingNewline) expected.pop()
  const lines = [...content.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0] !== "")
    .map((match) => {
      const newline = match[0].endsWith("\n")
      const text = newline ? match[0].slice(0, -1) : match[0]
      return {
        start: match.index,
        end: match.index + match[0].length,
        text,
        contentEnd: match.index + text.length - (text.endsWith("\r") ? 1 : 0),
        newline,
      }
    })
  const candidates = lines.flatMap((line, index) => {
    const actual = lines.slice(index, index + expected.length)
    if (actual.length !== expected.length) return []
    if (
      !actual.every((item, lineIndex) => {
        const expectedLine = expected[lineIndex]
        return (
          expectedLine !== undefined &&
          normalizeForMatch(item.text.trimEnd()) === normalizeForMatch(expectedLine.trimEnd())
        )
      })
    )
      return []
    const last = actual.at(-1)
    if (!last) return []
    if (trailingNewline && !last.newline) return []
    return [{ start: line.start, end: trailingNewline ? last.end : last.contentEnd }]
  })
  return candidates.reduce<Match[]>((result, candidate) => {
    if (result.some((match) => match.end > candidate.start && match.start < candidate.end)) return result
    result.push(candidate)
    return result
  }, [])
}

const hasUtf8Bom = (body: Uint8Array) => body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf

const failure = (
  path: string,
  error: ProjectDirectory.InvalidPathError | ProjectDirectory.NotFoundError | ProjectDirectory.OperationError,
) => {
  if (error._tag === "ProjectDirectory.InvalidPathError")
    return new Tool.Error({ message: `Invalid Project File path: ${path}` })
  if (error._tag === "ProjectDirectory.NotFoundError")
    return new Tool.Error({ message: `Project File not found: ${path}` })
  return new Tool.Error({ message: `Unable to edit Project File: ${path}` })
}

export const EditPlugin = define({
  id: "core.tool.edit",
  effect: (context) =>
    bind(EditTool).pipe(
      Effect.flatMap((tool) => context.tool.transform((editor) => editor.add(tool))),
      Effect.asVoid,
    ),
})
