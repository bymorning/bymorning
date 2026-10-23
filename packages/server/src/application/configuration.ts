/** Installation documents use the normal Config / Plugin activation path. */
import { Config } from "@bymorning/schema/config"
import { AbsolutePath } from "@bymorning/schema/schema"
import { Effect, Schema } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { readFile } from "node:fs/promises"
import path from "node:path"

const Input = Schema.Struct({
  plugins: Config.Info.fields.plugins,
  code_interpreter: Config.Info.fields.code_interpreter,
})

export class ConfigError extends Schema.TaggedError<ConfigError>()("Application.ConfigError", {
  message: Schema.String,
}) {}

/** Read an installation document's text; the failure names the path, never the content. */
export const read = (file: string) =>
  Effect.tryPromise({
    try: () => readFile(file, "utf8"),
    catch: () => new ConfigError({ message: `Unable to read installation configuration: ${file}` }),
  })

/** Environment references are resolved only in installation documents; options contain no credentials. */
export const load = (file: string, environment: Readonly<Record<string, string | undefined>>) =>
  Effect.gen(function* () {
    const text = yield* read(file)
    return yield* decode(text, file, environment)
  })

/**
 * Names the document references through `{ "env": NAME }`, in document order,
 * so a host can resolve them from its own configuration source before
 * substitution. Malformed JSONC yields no names; `decode` reports it.
 */
export const references = (text: string): ReadonlyArray<string> => {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true }) as unknown
  if (errors.length) return []
  const names: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || typeof node !== "object") return
    if ("env" in node && typeof node.env === "string" && Object.keys(node).length === 1) {
      if (!names.includes(node.env)) names.push(node.env)
      return
    }
    Object.values(node).forEach(walk)
  }
  walk(value)
  return names
}

export const decode = (text: string, file: string, environment: Readonly<Record<string, string | undefined>>) =>
  Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () => {
        const errors: ParseError[] = []
        const value = parse(text, errors, { allowTrailingComma: true }) as unknown
        if (errors.length) throw new Error("Invalid JSONC")
        return substitute(value, environment)
      },
      // The reference is a variable name, never a value; naming it tells the
      // deployer which setting the document needs.
      catch: (cause) =>
        new ConfigError({
          message:
            cause instanceof MissingReference
              ? `Invalid installation configuration: ${file} references ${cause.name}, which is not set`
              : `Invalid installation configuration: ${file}`,
        }),
    })
    const decoded = yield* Schema.decodeUnknownEffect(Input)(input).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Config.Info)),
      Effect.mapError(() => new ConfigError({ message: `Invalid plugin configuration: ${file}` })),
    )
    return Config.Document.make({ type: "document", path: AbsolutePath.make(path.resolve(file)), info: decoded })
  })

class MissingReference extends Error {
  constructor(readonly name: string) {
    super(`Missing environment reference: ${name}`)
  }
}

function substitute(value: unknown, environment: Readonly<Record<string, string | undefined>>): unknown {
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, environment))
  if (value === null || typeof value !== "object") return value
  if ("env" in value && typeof value.env === "string" && Object.keys(value).length === 1) {
    const resolved = environment[value.env]
    if (resolved === undefined) throw new MissingReference(value.env)
    return resolved
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry, environment)]))
}
