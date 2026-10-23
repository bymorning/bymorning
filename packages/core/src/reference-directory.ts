/** Exposes safe logical paths into configured references. */
export * as ReferenceDirectory from "./reference-directory.js"

import { Effect, Option, Schema } from "effect"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { Reference } from "./reference.js"

export class InvalidPathError extends Schema.TaggedError<InvalidPathError>()("ReferenceDirectory.InvalidPathError", {
  path: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("ReferenceDirectory.NotFoundError", {
  path: Schema.String,
}) {}

export const parse = (input: string): Option.Option<{ name: string; path: string }> => {
  if (!input.startsWith("reference:") || input.includes("\0") || input.includes("\\")) return Option.none()
  const logical = input.slice("reference:".length)
  const separator = logical.indexOf("/")
  const name = separator === -1 ? logical : logical.slice(0, separator)
  const relative = separator === -1 ? "" : logical.slice(separator + 1)
  if (name.length === 0 || name === "." || name === ".." || path.isAbsolute(relative)) return Option.none()
  if (relative.split("/").includes("..")) return Option.none()
  return Option.some({ name, path: relative })
}

export const resolve = Effect.fn("ReferenceDirectory.resolve")(function* (
  references: Reference.Interface,
  input: string,
) {
  const logical = parse(input)
  if (Option.isNone(logical)) return yield* new InvalidPathError({ path: input })
  const reference = (yield* references.list()).find((candidate) => candidate.name === logical.value.name)
  if (reference === undefined) return yield* new NotFoundError({ path: input })
  const resolved = path.resolve(reference.path, logical.value.path)
  const paths = yield* Effect.tryPromise(() => Promise.all([realpath(reference.path), realpath(resolved)])).pipe(
    Effect.mapError(() => new NotFoundError({ path: input })),
  )
  const relative = path.relative(paths[0], paths[1])
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return yield* new InvalidPathError({ path: input })
  return { name: logical.value.name, root: paths[0], absolute: paths[1] }
})
