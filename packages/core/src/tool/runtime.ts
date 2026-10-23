export * as Runtime from "./runtime.js"

import { Tool } from "@bymorning/schema/tool"
import type { Plugin } from "@bymorning/schema/plugin"
import type { Workspace } from "@bymorning/schema/workspace"
import { ToolDefinition } from "@opencode-ai/ai/schema/messages"
import type { StandardSchemaV1, StandardJSONSchemaV1 } from "@standard-schema/spec"
import { Effect, JsonSchema, Option, Schema, SchemaRepresentation, Stream } from "effect"
import { randomUUID } from "node:crypto"
import { CodeInterpreter } from "../code-interpreter.js"
import { ProjectStorage } from "../project-storage.js"
import { Storage } from "../storage.js"

export const normalizedName = (tool: Pick<Tool.Info, "name">) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
export const effectiveName = (tool: Pick<Tool.Info, "name" | "options">) =>
  tool.options?.namespace === undefined
    ? normalizedName(tool)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalizedName(tool)}`

const standard = (schema: Tool.ValueSchema): schema is StandardSchemaV1<any, any> & StandardJSONSchemaV1<any, any> =>
  typeof schema === "object" && schema !== null && "~standard" in schema

const json = (schema: Tool.ValueSchema, io: "input" | "output"): JsonSchema.JsonSchema => {
  if (standard(schema)) return schema["~standard"].jsonSchema[io]({ target: "editor-2020-12" })
  if (!Schema.isSchema(schema)) return schema as JsonSchema.JsonSchema
  const document = Schema.toJsonSchemaDocument(schema)
  const normalized = flattenAllOf(
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions },
  )
  const resolved = inlineReferences(normalized)
  if (!record(resolved) || hasReference(resolved)) return resolved as JsonSchema.JsonSchema
  const { $defs: _, ...rest } = resolved
  return (io === "input" ? objectRoot(rest) : rest) as JsonSchema.JsonSchema
}

/**
 * Providers require a tool's input schema to be `type: "object"`. Effect emits
 * `Schema.Struct({})` as `anyOf: [object, array]` with no top-level type, and a
 * struct's properties can arrive without one after flattening; pin both.
 */
const objectRoot = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (schema.type !== undefined) return schema
  const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : undefined
  const emptyStruct =
    alternatives !== undefined &&
    alternatives.length === 2 &&
    alternatives.every((entry) => record(entry) && (entry.type === "object" || entry.type === "array"))
  if (emptyStruct) {
    const { anyOf: _, ...rest } = schema
    return { ...rest, type: "object", properties: {}, additionalProperties: false }
  }
  if (record(schema.properties)) return { ...schema, type: "object" }
  return schema
}

// Pinned upstream provider normalization: preserve recursive references and
// conflicting sibling constraints, while inlining acyclic local definitions.
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const flattenAllOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(flattenAllOf)
  if (!record(value)) return value
  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flattenAllOf(item)]))
  if (!Array.isArray(schema.allOf) || !schema.allOf.every(record)) return schema
  const keys = new Set(Object.keys(schema).filter((key) => key !== "allOf"))
  if (
    !schema.allOf.every((item) =>
      Object.keys(item).every((key) => {
        if (keys.has(key)) return false
        keys.add(key)
        return true
      }),
    )
  )
    return schema
  const { allOf, ...rest } = schema
  return flattenAllOf({ ...Object.assign({}, ...allOf), ...rest })
}
const inlineReferences = (value: unknown, definitions?: Record<string, unknown>, seen = new Set<string>()): unknown => {
  if (Array.isArray(value)) return value.map((item) => inlineReferences(item, definitions, seen))
  if (!record(value)) return value
  const local = definitions ?? (record(value.$defs) ? value.$defs : undefined)
  if (typeof value.$ref === "string" && local) {
    const name = value.$ref
      .match(/^#\/\$defs\/([^/]+)$/)?.[1]
      ?.replaceAll("~1", "/")
      .replaceAll("~0", "~")
    if (name && !seen.has(name) && local[name]) {
      const { $ref: _, ...rest } = value
      const target = inlineReferences(local[name], local, new Set(seen).add(name))
      const siblings = inlineReferences(rest, local, seen)
      if (!record(target) || !record(siblings)) return target
      return Object.keys(target).every((key) => !(key in siblings))
        ? { ...target, ...siblings }
        : { allOf: [target, siblings] }
    }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inlineReferences(item, local, seen)]))
}
const hasReference = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasReference)
    : record(value) &&
      ((typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) || Object.values(value).some(hasReference))

export const definition = (tool: Tool.Info): ToolDefinition =>
  ToolDefinition.make({
    name: effectiveName(tool),
    description: tool.description,
    inputSchema: json(tool.input, "input"),
    ...(tool.output === undefined ? {} : { outputSchema: json(tool.output, "output") }),
  })

const codec = (schema: JsonSchema.JsonSchema) => {
  const document =
    (typeof schema.$schema === "string" && schema.$schema.includes("editor-07")) || "definitions" in schema
      ? JsonSchema.fromSchemaDraft07(schema)
      : JsonSchema.fromSchemaDraft2020_12(schema)
  return Schema.make<Schema.Codec<unknown>>(SchemaRepresentation.fromJsonSchemaDocument(document).ast)
}

const failure = (message: string, error: unknown) =>
  new Tool.Error({ message: `${message}: ${error instanceof Error ? error.message : String(error)}` })

const validate = (schema: Tool.ValueSchema, value: unknown, output: boolean): Effect.Effect<unknown, Tool.Error> => {
  const message = output ? "Tool returned an invalid value for its output schema" : "Invalid tool arguments"
  if (standard(schema))
    return Effect.try({
      try: () => schema["~standard"].validate(value),
      catch: (error) => failure(message, error),
    }).pipe(
      Effect.flatMap((result) =>
        result instanceof Promise
          ? Effect.tryPromise({ try: () => result, catch: (error) => failure(message, error) })
          : Effect.succeed(result),
      ),
      Effect.flatMap((result) =>
        result.issues === undefined
          ? Effect.succeed(result.value)
          : Effect.fail(
              new Tool.Error({ message: `${message}: ${result.issues.map((issue) => issue.message).join(", ")}` }),
            ),
      ),
    )
  return Effect.try({
    try: () => (Schema.isSchema(schema) ? schema : codec(schema as JsonSchema.JsonSchema)),
    catch: (error) => failure(message, error),
  }).pipe(
    Effect.flatMap((schema) =>
      (output
        ? Schema.encodeUnknownEffect(schema)(value)
        : Schema.decodeUnknownEffect(schema)(value, { errors: "all" })
      ).pipe(Effect.mapError((error) => failure(message, error))),
    ),
  )
}

export const decodeInput = (tool: Tool.Info, input: unknown) => validate(tool.input, input, false)

export const normalizeContent = (content: Tool.Result["content"], output?: unknown): ReadonlyArray<Tool.Content> => {
  if (typeof content === "string") return [{ type: "text", text: content }]
  if (content !== undefined && content.length > 0) return [...content]
  let text: string
  try {
    text = typeof output === "string" ? output : (JSON.stringify(output) ?? String(output))
  } catch {
    text = String(output)
  }
  return [{ type: "text", text }]
}

export const execute = (tool: Tool.Info, input: unknown, context: Tool.Context) =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(tool, input)
    const result = yield* Effect.suspend(() => tool.execute(decoded, context)).pipe(
      Effect.mapError((error: unknown) =>
        error instanceof Tool.Error
          ? error
          : new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
      ),
    )
    if (tool.output === undefined) {
      if ("output" in result) return yield* Effect.die(new Error("Tool result declared output without an output schema"))
      return {
        content: normalizeContent(result.content),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      }
    }
    if (!("output" in result)) return yield* new Tool.Error({ message: "Tool did not return its declared output" })
    const output = yield* validate(tool.output, result.output, true)
    const content = yield* Schema.decodeUnknownEffect(Schema.Array(Tool.Content))(
      normalizeContent(result.content, output),
    ).pipe(Effect.mapError((error) => failure("Invalid Tool content", error)))
    return { output, content, ...(result.metadata === undefined ? {} : { metadata: result.metadata }) }
  })

const Envelope = Schema.Struct({
  output: Schema.optionalKey(Schema.Unknown),
  content: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Tool.Content)])),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})

/** Capture infrastructure once at admission; only Project file contents remain invocation-time data. */
export const sandbox = (
  registration: Tool.SandboxRegistration,
  source: Plugin.Source,
  workspaceID: Workspace.ID | undefined,
  interpreter: CodeInterpreter.Interface | undefined,
  storage: Storage.Interface | undefined,
): Tool.Info => {
  const tool = {
    ...registration,
    implementation: { ...registration.implementation },
    options: registration.options && { ...registration.options },
  }
  return {
    name: tool.name,
    description: tool.description,
    input: tool.input,
    ...(tool.output === undefined ? {} : { output: tool.output }),
    ...(tool.options === undefined ? {} : { options: { ...tool.options } }),
    execute: (input, context) =>
      Effect.gen(function* () {
        const implementation = tool.implementation
        yield* context.permission({
          action: tool.options?.permission ?? effectiveName(tool),
          resources: ["*"],
          save: ["*"],
          metadata: {
            tool: effectiveName(tool),
            execution: "sandbox",
            implementation: implementation.type,
            ...(implementation.type === "project-file" && source.type === "project"
              ? { projectID: source.projectID, path: implementation.path }
              : {}),
          },
        })
        if (interpreter === undefined)
          return yield* new Tool.Error({ message: "Code Interpreter adapter was not supplied" })
        const loaded = yield* Effect.gen(function* () {
          if (implementation.type === "inline") return implementation
          if (source.type !== "project" || workspaceID === undefined || storage === undefined)
            return yield* new Tool.Error({ message: "Project sandbox storage is unavailable" })
          const language = implementation.language ?? CodeInterpreter.languageForPath(implementation.path)
          if (language === undefined)
            return yield* new Tool.Error({ message: `Unsupported sandbox source extension: ${implementation.path}` })
          const files = yield* ProjectStorage.make(workspaceID, source.projectID).pipe(
            Effect.provideService(Storage.Service, storage),
          )
          const file = yield* files
            .get(implementation.path.split("/"))
            .pipe(Effect.mapError((error) => failure("Unable to read sandbox source", error)))
          if (Option.isNone(file))
            return yield* new Tool.Error({ message: `Sandbox source not found: ${implementation.path}` })
          const bytes = yield* Stream.mkUint8Array(file.value.body).pipe(
            Effect.mapError((error) => failure("Unable to read sandbox source", error)),
          )
          const body = yield* Effect.try({
            try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            catch: (error) => failure("Sandbox source is not valid UTF-8", error),
          })
          return { language, body }
        })
        const marker = `__BYMORNING_TOOL_RESULT_${randomUUID()}__=`
        const code = yield* Effect.try({
          try: () => {
            const value = JSON.stringify(input)
            if (value === undefined) throw new Error("Input does not have a JSON representation")
            const encoded = JSON.stringify(value)
            if (loaded.language !== "python")
              return `const __bymorningInput = JSON.parse(${encoded});\nconst __bymorningHandler = async (input) => {\n${loaded.body}\n};\nconst __bymorningResult = await __bymorningHandler(__bymorningInput);\nconsole.log(${JSON.stringify(marker)} + JSON.stringify(__bymorningResult));`
            return `import json\n__bymorning_input = json.loads(${encoded})\ndef __bymorning_handler(input):\n    pass\n${loaded.body
              .split("\n")
              .map((line) => `    ${line}`)
              .join(
                "\n",
              )}\n__bymorning_result = __bymorning_handler(__bymorning_input)\nprint(${JSON.stringify(marker)} + json.dumps(__bymorning_result, separators=(",", ":")))`
          },
          catch: (error) => failure("Sandbox Tool input is not JSON serializable", error),
        })
        const result = yield* interpreter
          .execute({
            type: "code",
            sessionName: context.caller.type === "session" ? context.caller.sessionID : context.id,
            language: loaded.language,
            code,
          })
          .pipe(
            Effect.timeout("2 minutes"),
            Effect.mapError((error) => failure("Sandbox Tool execution failed", error)),
          )
        const start = result.stdout.lastIndexOf(marker)
        if (start === -1) return yield* new Tool.Error({ message: "Sandbox Tool did not emit a result envelope" })
        const end = result.stdout.indexOf("\n", start)
        const value = yield* Effect.try({
          try: () => JSON.parse(result.stdout.slice(start + marker.length, end === -1 ? undefined : end)),
          catch: (error) => failure("Sandbox Tool emitted invalid result JSON", error),
        })
        const envelope = yield* Schema.decodeUnknownEffect(Envelope)(value).pipe(
          Effect.mapError((error) => failure("Sandbox Tool returned an invalid result envelope", error)),
        )
        const stdout = `${result.stdout.slice(0, start)}${end === -1 ? "" : result.stdout.slice(end + 1)}`
        return {
          ...envelope,
          content: [
            ...(typeof envelope.content === "string"
              ? [{ type: "text" as const, text: envelope.content }]
              : (envelope.content ?? [])),
            ...[stdout, result.stderr]
              .filter((text) => text.length > 0)
              .map((text) => ({ type: "text" as const, text })),
          ],
        }
      }).pipe(Effect.scoped),
  }
}
