export * as Translation from "./input.js"

import type { LLMGateway } from "@bymorning/schema/llm-gateway"
import type { RequestInput } from "@opencode-ai/ai/llm"
import { Message, type ContentPart, type ToolDefinition } from "@opencode-ai/ai/schema/messages"
import { Effect, Schema } from "effect"
import { InputError } from "../failure.js"

const optional = Schema.optionalKey
const object = Schema.Record(Schema.String, Schema.Json)
const text = Schema.Struct({ type: Schema.Literals(["text", "input_text", "output_text"]), text: Schema.String })
const image = Schema.Struct({
  type: Schema.Literal("image_url"),
  image_url: Schema.Struct({ url: Schema.String, detail: optional(Schema.Literal("auto")) }),
})
const inputImage = Schema.Struct({
  type: Schema.Literal("input_image"),
  image_url: Schema.String,
  detail: optional(Schema.Literal("auto")),
})
const content = Schema.Union([Schema.String, Schema.Array(Schema.Union([text, image, inputImage]))])
const fn = Schema.Struct({
  name: Schema.NonEmptyString,
  description: optional(Schema.String),
  parameters: optional(object),
  strict: optional(Schema.Literal(false)),
})
const tool = Schema.Struct({ type: Schema.Literal("function"), function: fn })
const call = Schema.Struct({
  id: Schema.NonEmptyString,
  type: Schema.Literal("function"),
  function: Schema.Struct({ name: Schema.NonEmptyString, arguments: Schema.String }),
})
const choice = Schema.Union([
  Schema.Literals(["auto", "none", "required"]),
  Schema.Struct({ type: Schema.Literal("function"), function: Schema.Struct({ name: Schema.NonEmptyString }) }),
])
const common = {
  model: Schema.NonEmptyString,
  stream: optional(Schema.Boolean),
  temperature: optional(Schema.Finite),
  top_p: optional(Schema.Finite),
}
const chat = Schema.Struct({
  ...common,
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["system", "developer", "user", "assistant", "tool"]),
      content: optional(Schema.NullOr(content)),
      tool_calls: optional(Schema.Array(call)),
      tool_call_id: optional(Schema.NonEmptyString),
    }),
  ),
  tools: optional(Schema.Array(tool)),
  tool_choice: optional(choice),
  max_tokens: optional(Schema.Int.check(Schema.isGreaterThan(0))),
  max_completion_tokens: optional(Schema.Int.check(Schema.isGreaterThan(0))),
  stop: optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  n: optional(Schema.Literal(1)),
  stream_options: optional(Schema.Struct({ include_usage: optional(Schema.Boolean) })),
})
const responseItem = Schema.Union([
  Schema.Struct({
    type: optional(Schema.Literal("message")),
    role: Schema.Literals(["system", "developer", "user", "assistant"]),
    content,
    id: optional(Schema.String),
    status: optional(Schema.Literal("completed")),
  }),
  Schema.Struct({
    type: Schema.Literal("function_call"),
    call_id: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    arguments: Schema.String,
    id: optional(Schema.String),
    status: optional(Schema.Literal("completed")),
  }),
  Schema.Struct({
    type: Schema.Literal("function_call_output"),
    call_id: Schema.NonEmptyString,
    output: Schema.String,
  }),
])
const responses = Schema.Struct({
  ...common,
  input: Schema.Union([Schema.String, Schema.Array(responseItem)]),
  instructions: optional(Schema.String),
  tools: optional(Schema.Array(Schema.Struct({ type: Schema.Literal("function"), ...fn.fields }))),
  tool_choice: optional(
    Schema.Union([
      Schema.Literals(["auto", "none", "required"]),
      Schema.Struct({ type: Schema.Literal("function"), name: Schema.NonEmptyString }),
    ]),
  ),
  max_output_tokens: optional(Schema.Int.check(Schema.isGreaterThan(0))),
  store: optional(Schema.Literal(false)),
})
const anthropicBlock = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("image"),
    source: Schema.Struct({ type: Schema.Literal("base64"), media_type: Schema.String, data: Schema.String }),
  }),
  Schema.Struct({
    type: Schema.Literal("tool_use"),
    id: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    input: object,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    tool_use_id: Schema.NonEmptyString,
    content: Schema.Union([
      Schema.String,
      Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
    ]),
    is_error: optional(Schema.Boolean),
  }),
])
const anthropic = Schema.Struct({
  ...common,
  max_tokens: Schema.Int.check(Schema.isGreaterThan(0)),
  system: optional(
    Schema.Union([Schema.String, Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }))]),
  ),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant"]),
      content: Schema.Union([Schema.String, Schema.Array(anthropicBlock)]),
    }),
  ),
  tools: optional(
    Schema.Array(
      Schema.Struct({ name: Schema.NonEmptyString, description: optional(Schema.String), input_schema: object }),
    ),
  ),
  tool_choice: optional(
    Schema.Union([
      Schema.Struct({ type: Schema.Literals(["auto", "any", "none"]) }),
      Schema.Struct({ type: Schema.Literal("tool"), name: Schema.NonEmptyString }),
    ]),
  ),
  stop_sequences: optional(Schema.Array(Schema.String)),
  top_k: optional(Schema.Int),
})
const googlePart = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ inlineData: Schema.Struct({ mimeType: Schema.String, data: Schema.String }) }),
  Schema.Struct({
    functionCall: Schema.Struct({ id: optional(Schema.String), name: Schema.NonEmptyString, args: object }),
  }),
  Schema.Struct({
    functionResponse: Schema.Struct({ id: optional(Schema.String), name: Schema.NonEmptyString, response: object }),
  }),
])
const google = Schema.Struct({
  contents: Schema.Array(
    Schema.Struct({ role: optional(Schema.Literals(["user", "model"])), parts: Schema.Array(googlePart) }),
  ),
  systemInstruction: optional(
    Schema.Struct({ role: optional(Schema.String), parts: Schema.Array(Schema.Struct({ text: Schema.String })) }),
  ),
  tools: optional(
    Schema.Array(
      Schema.Struct({
        functionDeclarations: Schema.Array(
          Schema.Struct({
            name: Schema.NonEmptyString,
            description: optional(Schema.String),
            parameters: optional(object),
          }),
        ),
      }),
    ),
  ),
  toolConfig: optional(
    Schema.Struct({
      functionCallingConfig: Schema.Struct({
        mode: optional(Schema.Literals(["AUTO", "NONE", "ANY"])),
        allowedFunctionNames: optional(Schema.Array(Schema.String)),
      }),
    }),
  ),
  generationConfig: optional(
    Schema.Struct({
      maxOutputTokens: optional(Schema.Int.check(Schema.isGreaterThan(0))),
      temperature: optional(Schema.Finite),
      topP: optional(Schema.Finite),
      topK: optional(Schema.Int),
      stopSequences: optional(Schema.Array(Schema.String)),
      candidateCount: optional(Schema.Literal(1)),
    }),
  ),
})

/** Canonical request data; model and auth are selected by the gateway. */
export type Input = Omit<RequestInput, "model">

const decode = <A>(schema: Schema.Codec<A, unknown>, value: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError(() => new InputError({ reason: "Malformed or unsupported request field for translation" })),
  )
const args = (value: string) => decode(Schema.fromJsonString(object), value)
const parts = (value: typeof content.Type): ContentPart[] =>
  typeof value === "string"
    ? value
      ? [{ type: "text", text: value }]
      : []
    : value.map((part): ContentPart => {
        if (part.type === "image_url" || part.type === "input_image") {
          const url = part.type === "image_url" ? part.image_url.url : part.image_url
          const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
          return { type: "media", mediaType: match?.[1] ?? "image/jpeg", data: url }
        }
        return { type: "text", text: part.text }
      })
const definition = (value: typeof fn.Type): ToolDefinition.Input => ({
  name: value.name,
  description: value.description ?? "",
  inputSchema: value.parameters ?? { type: "object", properties: {} },
})

/** Lower Google Schema's enum-valued types and nullability to JSON Schema. */
const googleSchema = (value: typeof object.Type): typeof object.Type => {
  const result = { ...value }
  const nested = (schema: Schema.Json) => (Schema.is(object)(schema) ? googleSchema(schema) : schema)
  if (typeof value.type === "string") {
    const types = {
      OBJECT: "object",
      ARRAY: "array",
      STRING: "string",
      NUMBER: "number",
      INTEGER: "integer",
      BOOLEAN: "boolean",
      NULL: "null",
    } as Readonly<Record<string, string>>
    result.type = types[value.type] ?? value.type
  }
  for (const key of ["properties", "$defs", "definitions"]) {
    const entries = value[key]
    if (Schema.is(object)(entries))
      result[key] = Object.fromEntries(Object.entries(entries).map(([name, schema]) => [name, nested(schema)]))
  }
  for (const key of ["items", "additionalProperties", "not"]) {
    const schema = value[key]
    if (schema !== undefined) result[key] = nested(schema)
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    const schemas = value[key]
    if (Array.isArray(schemas)) result[key] = schemas.map(nested)
  }
  if (typeof result.nullable === "boolean") delete result.nullable
  return value.nullable === true ? { anyOf: [result, { type: "null" }] } : result
}

/** Parse one supported caller request without silently discarding unknown features. */
export const parse = Effect.fn("LLMGateway.Translation.parse")(function* (
  request: LLMGateway.Request,
): Effect.fn.Return<Input, InputError> {
  const messages: Message[] = []
  const calls = new Map<string, string>()
  const initial: string[] = []
  const append = (role: "system" | "developer" | "user" | "assistant", value: typeof content.Type) => {
    const items = parts(value)
    if (role === "system" || role === "developer") {
      if (items.some((part) => part.type !== "text")) return new InputError({ reason: "System content must be text" })
      const text = items.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
      if (messages.length === 0) initial.push(text)
      else messages.push(Message.system(text))
      return
    }
    messages.push(role === "user" ? Message.user(items) : Message.assistant(items))
  }
  const result = (id: string, value: unknown, error = false) => {
    const name = calls.get(id)
    if (!name) return new InputError({ reason: "Tool result has no preceding tool call" })
    calls.delete(id)
    messages.push(Message.tool({ id, name, result: { type: error ? "error" : "text", value } }))
  }
  if (request.protocol === "openai-chat") {
    const body = yield* decode(chat, request.body)
    if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined)
      return yield* new InputError({ reason: "Use only one token limit" })
    for (const item of body.messages) {
      if (item.role === "tool") {
        if (item.tool_calls) return yield* new InputError({ reason: "Only assistants may call tools" })
        if (!item.tool_call_id || typeof item.content !== "string")
          return yield* new InputError({ reason: "Tool result requires an ID and text content" })
        const error = result(item.tool_call_id, item.content)
        if (error) return yield* error
        continue
      }
      if (item.tool_call_id) return yield* new InputError({ reason: "Only tool results may reference a tool call" })
      if (item.tool_calls && item.role !== "assistant")
        return yield* new InputError({ reason: "Only assistants may call tools" })
      const error = append(item.role, item.content ?? "")
      if (error) return yield* error
      if (item.tool_calls?.length) {
        const content = parts(item.content ?? "")
        for (const call of item.tool_calls) {
          calls.set(call.id, call.function.name)
          content.push({
            type: "tool-call",
            id: call.id,
            name: call.function.name,
            input: yield* args(call.function.arguments),
          })
        }
        messages[messages.length - 1] = Message.assistant(content)
      }
    }
    return {
      messages,
      system: initial.join("\n"),
      cache: "none",
      tools: body.tool_choice === "none" ? [] : body.tools?.map((tool) => definition(tool.function)),
      toolChoice:
        typeof body.tool_choice === "object"
          ? { type: "tool", name: body.tool_choice.function.name }
          : body.tool_choice,
      generation: {
        maxTokens: body.max_completion_tokens ?? body.max_tokens,
        temperature: body.temperature,
        topP: body.top_p,
        stop: typeof body.stop === "string" ? [body.stop] : body.stop,
      },
    }
  }
  if (request.protocol === "openai-responses") {
    const body = yield* decode(responses, request.body)
    if (body.instructions) initial.push(body.instructions)
    if (typeof body.input === "string") messages.push(Message.user(body.input))
    else
      for (const item of body.input) {
        if (item.type === "function_call") {
          calls.set(item.call_id, item.name)
          messages.push(
            Message.assistant([
              { type: "tool-call", id: item.call_id, name: item.name, input: yield* args(item.arguments) },
            ]),
          )
        } else if (item.type === "function_call_output") {
          const error = result(item.call_id, item.output)
          if (error) return yield* error
        } else {
          const error = append(item.role, item.content)
          if (error) return yield* error
        }
      }
    return {
      messages,
      system: initial.join("\n"),
      cache: "none",
      tools: body.tool_choice === "none" ? [] : body.tools?.map(definition),
      toolChoice:
        typeof body.tool_choice === "object" ? { type: "tool", name: body.tool_choice.name } : body.tool_choice,
      generation: { maxTokens: body.max_output_tokens, temperature: body.temperature, topP: body.top_p },
    }
  }
  if (request.protocol === "anthropic-messages") {
    const body = yield* decode(anthropic, request.body)
    for (const item of body.messages) {
      if (typeof item.content === "string") {
        messages.push(item.role === "user" ? Message.user(item.content) : Message.assistant(item.content))
        continue
      }
      let pending: ContentPart[] = []
      const flush = () => {
        if (pending.length) messages.push(item.role === "user" ? Message.user(pending) : Message.assistant(pending))
        pending = []
      }
      for (const block of item.content) {
        if (block.type === "text") pending.push({ type: "text", text: block.text })
        if (block.type === "image")
          pending.push({
            type: "media",
            mediaType: block.source.media_type,
            data: `data:${block.source.media_type};base64,${block.source.data}`,
          })
        if (block.type === "tool_use") {
          if (item.role !== "assistant") return yield* new InputError({ reason: "Only assistants may call tools" })
          calls.set(block.id, block.name)
          pending.push({ type: "tool-call", id: block.id, name: block.name, input: block.input })
        }
        if (block.type === "tool_result") {
          if (item.role !== "user") return yield* new InputError({ reason: "Tool results require user role" })
          flush()
          const error = result(
            block.tool_use_id,
            typeof block.content === "string" ? block.content : block.content.map((part) => part.text).join("\n"),
            block.is_error,
          )
          if (error) return yield* error
        }
      }
      flush()
    }
    return {
      messages,
      cache: "none",
      system: typeof body.system === "string" ? body.system : body.system?.map((part) => part.text).join("\n"),
      tools:
        body.tool_choice?.type === "none"
          ? []
          : body.tools?.map((tool) => ({
              name: tool.name,
              description: tool.description ?? "",
              inputSchema: tool.input_schema,
            })),
      toolChoice:
        body.tool_choice?.type === "tool"
          ? { type: "tool", name: body.tool_choice.name }
          : body.tool_choice?.type === "any"
            ? "required"
            : body.tool_choice?.type,
      generation: {
        maxTokens: body.max_tokens,
        temperature: body.temperature,
        topP: body.top_p,
        topK: body.top_k,
        stop: body.stop_sequences,
      },
    }
  }
  const body = yield* decode(google, request.body)
  let serial = 0
  const pendingCalls: { id: string; name: string }[] = []
  for (const item of body.contents) {
    let pending: ContentPart[] = []
    const flush = () => {
      if (pending.length) messages.push(item.role === "model" ? Message.assistant(pending) : Message.user(pending))
      pending = []
    }
    for (const part of item.parts) {
      if ("text" in part) pending.push({ type: "text", text: part.text })
      if ("inlineData" in part)
        pending.push({
          type: "media",
          mediaType: part.inlineData.mimeType,
          data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        })
      if ("functionCall" in part) {
        if (item.role !== "model") return yield* new InputError({ reason: "Function calls require model role" })
        const call = part.functionCall
        const id = call.id ?? `call_${serial++}`
        calls.set(id, call.name)
        pendingCalls.push({ id, name: call.name })
        pending.push({ type: "tool-call", id, name: call.name, input: call.args })
      }
      if ("functionResponse" in part) {
        if (item.role === "model") return yield* new InputError({ reason: "Function results require user role" })
        flush()
        const response = part.functionResponse
        const index = pendingCalls.findIndex((call) =>
          response.id ? call.id === response.id : call.name === response.name,
        )
        const call = pendingCalls[index]
        if (!call || call.name !== response.name)
          return yield* new InputError({ reason: "Function result has no matching preceding call" })
        if (!response.id && pendingCalls.filter((call) => call.name === response.name).length > 1)
          return yield* new InputError({ reason: "Parallel calls to the same function require result IDs" })
        pendingCalls.splice(index, 1)
        messages.push(
          Message.tool({ id: call.id, name: call.name, result: { type: "json", value: response.response } }),
        )
      }
    }
    flush()
  }
  const config = body.toolConfig?.functionCallingConfig
  if (config?.allowedFunctionNames && (config.mode !== "ANY" || config.allowedFunctionNames.length !== 1))
    return yield* new InputError({ reason: "Only one forced function is representable" })
  return {
    messages,
    cache: "none",
    system: body.systemInstruction?.parts.map((part) => part.text).join("\n"),
    tools:
      config?.mode === "NONE"
        ? []
        : body.tools?.flatMap((tool) =>
            tool.functionDeclarations.map((tool) => ({
              ...definition(tool),
              inputSchema:
                tool.parameters === undefined ? { type: "object", properties: {} } : googleSchema(tool.parameters),
            })),
          ),
    toolChoice: config?.allowedFunctionNames?.[0]
      ? { type: "tool", name: config.allowedFunctionNames[0] }
      : config?.mode === "ANY"
        ? "required"
        : config?.mode === "NONE"
          ? "none"
          : "auto",
    generation: {
      maxTokens: body.generationConfig?.maxOutputTokens,
      temperature: body.generationConfig?.temperature,
      topP: body.generationConfig?.topP,
      topK: body.generationConfig?.topK,
      stop: body.generationConfig?.stopSequences,
    },
  }
})
