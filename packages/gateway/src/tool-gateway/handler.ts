import { Tool } from "@bymorning/core/tool"
import type { Form } from "@bymorning/schema/form"
import {
  CLIENT_CAPABILITIES_META_KEY,
  INVALID_PARAMS,
  Server,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
} from "@modelcontextprotocol/server"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { randomBytes } from "node:crypto"
import { CurrentActor } from "../contract.js"
import { Member } from "./member.js"
import { Runtime } from "./runtime.js"

const requestStateKey = randomBytes(32)

export const handle = Effect.fn("ToolGateway.handle")(function* (request: HttpServerRequest.HttpServerRequest) {
  const actor = yield* CurrentActor
  if (actor.type !== "user")
    return HttpServerResponse.jsonUnsafe(
      { jsonrpc: "2.0", id: null, error: { code: -32003, message: "Forbidden" } },
      { status: 403 },
    )
  const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
  // The acquisition Scope spans the whole request: activation, snapshot, SDK
  // dispatch, elicitation, and Tool execution all live inside it.
  return yield* Effect.gen(function* () {
    const runtime = yield* Runtime.Service
    const mcp = yield* runtime.acquire(actor)
    const snapshot = yield* mcp.snapshot
    // SDK callbacks run outside this Effect program. Capture the current context
    // explicitly at that boundary rather than relying on the global runner.
    const effectContext = yield* Effect.context<never>()
    const wrappedOutputs = new Set<string>()
    const elicitation = new URL(webRequest.url).searchParams.get("elicitation")
    const override = elicitation === "model" || elicitation === "browser" ? elicitation : undefined
    const state = createRequestStateCodec<{
      readonly id: string
      readonly tool: string
      readonly round: number
      readonly input: string
      readonly mode: string
    }>({
      key: requestStateKey,
      ttlSeconds: 10 * 60,
      // Both the native retry and our ordinary mcp_resume Tool are bound to
      // this authenticated member. The signed payload itself binds the
      // original tool, arguments, selected presentation, and round.
      bind: () => `${actor.properties.workspaceID}\0${actor.properties.accountID}\0${actor.properties.userID}`,
    })
    const definitions = snapshot.definitions.map((definition) =>
      wireDefinition(definition, wrappedOutputs),
    ) as Tool.Snapshot["definitions"]
    const resumeAvailable = !definitions.some((definition) => definition.name === "mcp_resume")
    const exposedDefinitions = resumeAvailable ? [...definitions, resumeDefinition] : definitions
    const server = new Server(
      { name: "bymorning", version: "0.0.0" },
      { capabilities: { tools: {} }, requestState: { verify: state.verify } },
    )
    server.setRequestHandler("tools/list", () => ({
      // MCP requires an object-root input schema. Effect emits `{}` for an
      // empty Struct, which is semantically an object but is not accepted by
      // the protocol validator unless the root type is explicit. Do not
      // coerce scalar/array schemas: those need an explicit wire-contract
      // decision rather than silently changing Tool input semantics.
      tools: [...exposedDefinitions] as never,
    }))
    server.setRequestHandler("tools/call", async (call, context) => {
      if (resumeAvailable && call.params.name === "mcp_resume") {
        const continuation = (call.params.arguments as Record<string, unknown> | undefined)?.continuation
        if (typeof continuation !== "string")
          throw Object.assign(new Error("continuation is required"), { code: INVALID_PARAMS })
        const response = responseArgument((call.params.arguments as Record<string, unknown> | undefined)?.response)
        try {
          const requestState = await state.verify(continuation, context)
          const outcome = await Effect.runPromiseWith(effectContext)(
            mcp.resume({
              id: requestState.id,
              round: requestState.round,
              mode: requestState.mode as Member.Pending["mode"],
              ...(response === undefined ? {} : { response }),
            }),
          )
          const original = definitions.find((definition) => definition.name === requestState.tool)
          return (
            outcome.status === "pending"
              ? server.projectCallToolResult(
                  await Effect.runPromiseWith(effectContext)(
                    pendingResult(outcome, state, context, requestState.tool, requestState.input, webRequest.url),
                  ),
                  original?.outputSchema as never,
                )
              : server.projectCallToolResult(
                  renderResult(outcome.result, false) as never,
                  original?.outputSchema as never,
                )
          ) as never
        } catch (error) {
          return errorResult(error) as never
        }
      }
      const definition = definitions.find((entry) => entry.name === call.params.name)
      if (definition === undefined) throw Object.assign(new Error("Unknown tool"), { code: INVALID_PARAMS })
      const requestState = context.mcpReq.requestState<{
        readonly id: string
        readonly tool: string
        readonly round: number
        readonly input: string
        readonly mode: string
      }>()
      const response = responseFrom(context.mcpReq.inputResponses)
      if (
        requestState !== undefined &&
        (requestState.tool !== call.params.name || requestState.input !== canonicalJSON(call.params.arguments ?? {}))
      )
        throw Object.assign(new Error("Request state does not match this Tool"), { code: INVALID_PARAMS })
      return Effect.runPromiseWith(effectContext)(
        (requestState === undefined
          ? mcp.call({
              tool: call.params.name,
              input: call.params.arguments ?? {},
              ...(override === undefined ? { capabilities: capabilities(context) } : { mode: override }),
            })
          : mcp.resume({
              id: requestState.id,
              round: requestState.round,
              mode: requestState.mode as Member.Pending["mode"],
              ...(response === undefined ? {} : { response }),
            })
        ).pipe(
          Effect.flatMap((outcome): Effect.Effect<any, Tool.Error | Member.RequestError | Member.NotFoundError> => {
            if (outcome.status === "pending") {
              if (outcome.mode === "form" || outcome.mode === "url") {
                const key = "input"
                const request = outcome.request
                return Effect.promise(() =>
                  state.mint(
                    {
                      id: outcome.id,
                      tool: call.params.name,
                      round: outcome.round,
                      input: canonicalJSON(call.params.arguments ?? {}),
                      mode: outcome.mode,
                    },
                    context,
                  ),
                ).pipe(
                  Effect.map((token) =>
                    inputRequired({
                      requestState: token,
                      inputRequests: {
                        [key]:
                          outcome.mode === "url" ||
                          outcome.mode === "browser" ||
                          (outcome.mode === "model" && request.mode === "url")
                            ? inputRequired.elicitUrl({
                                message: request.message,
                                url: outcome.mode === "browser" ? outcome.url! : (request as any).url,
                              })
                            : inputRequired.elicit({
                                message: request.message,
                                requestedSchema: formSchema(request) as never,
                              }),
                      },
                    }),
                  ),
                )
              }
              return pendingResult(
                outcome,
                state,
                context,
                call.params.name,
                canonicalJSON(call.params.arguments ?? {}),
                webRequest.url,
              ).pipe(Effect.map((pending) => server.projectCallToolResult(pending, definition.outputSchema as never)))
            }
            return Effect.succeed(renderResult(outcome.result, wrappedOutputs.has(definition.name)))
          }),
          Effect.catch((error) =>
            Effect.succeed({
              content: [
                { type: "text" as const, text: error instanceof Error ? error.message : "Tool execution failed" },
              ],
              isError: true,
            }),
          ),
          // Never leak a defect (or an arbitrary thrown value) through the SDK
          // callback. Typed tool failures are rendered above; defects are a
          // failed tool call, not a transport failure.
          Effect.catchDefect(() =>
            Effect.succeed({ content: [{ type: "text" as const, text: "Tool execution failed" }], isError: true }),
          ),
        ),
      ) as never
    })
    const handler = createMcpHandler(() => server, { legacy: "stateless" })
    const response = yield* Effect.promise(() => handler.fetch(webRequest))
    return HttpServerResponse.fromWeb(response)
  }).pipe(
    Effect.catchTag("ToolGateway.UnavailableError", () =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { jsonrpc: "2.0", id: null, error: { code: -32003, message: "Service unavailable" } },
          { status: 503 },
        ),
      ),
    ),
    Effect.scoped,
  )
})

const responseFrom = (responses: Record<string, unknown> | undefined): Tool.ElicitResult | undefined => {
  const response = responses?.input
  if (!isRecord(response) || typeof response.action !== "string") return undefined
  if (response.action === "accept" && isRecord(response.content))
    return { action: "accept", answer: response.content as Tool.ElicitResult extends infer _ ? any : never }
  if (response.action === "decline") return { action: "decline" }
  if (response.action === "cancel") return { action: "cancel" }
}

const responseArgument = (response: unknown): Tool.ElicitResult | undefined => {
  if (!isRecord(response) || typeof response.action !== "string") return undefined
  if (response.action === "accept" && isRecord(response.answer))
    return { action: "accept", answer: response.answer as any }
  if (response.action === "decline") return { action: "decline" }
  if (response.action === "cancel") return { action: "cancel" }
}

const pendingResult = (
  outcome: Member.Pending,
  state: ReturnType<typeof createRequestStateCodec<any>>,
  context: any,
  tool: string,
  input: string,
  origin: string,
) =>
  Effect.promise(() =>
    state.mint({ id: outcome.id, tool, round: outcome.round, input, mode: outcome.mode }, context),
  ).pipe(
    Effect.map((continuation) => {
      const url = outcome.url === undefined ? undefined : new URL(outcome.url, origin).toString()
      const pending = {
        status: "pending" as const,
        mode: outcome.mode,
        ...(outcome.mode === "browser" ? { url } : { request: outcome.request }),
        continuation,
      }
      return {
        content: [
          {
            type: "text" as const,
            text: outcome.mode === "browser" ? `Continue in your browser: ${url}` : outcome.request.message,
          },
        ],
        structuredContent: pending,
      }
    }),
  )

const errorResult = (error: unknown) => ({
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Tool execution failed" }],
  isError: true,
})

const resumeDefinition = {
  name: "mcp_resume",
  description: "Resume a pending ByMorning Tool elicitation.",
  inputSchema: {
    type: "object",
    properties: {
      continuation: { type: "string" },
      response: {
        type: "object",
        properties: { action: { enum: ["accept", "decline", "cancel"] }, answer: { type: "object" } },
        required: ["action"],
      },
    },
    required: ["continuation"],
  },
}

const renderResult = (result: Tool.NormalizedResult, wrapped: boolean) => ({
  content: result.content.map((item) =>
    item.type === "text" ? item : { type: "resource" as const, resource: { uri: item.uri, mimeType: item.mime } },
  ),
  ...(result.output === undefined ? {} : { structuredContent: outputContent(result.output, wrapped) }),
  ...(result.metadata === undefined ? {} : { _meta: result.metadata }),
})

/** Stable JSON identity for the original JSON-RPC arguments across retry encoders. */
const canonicalJSON = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

/** The SDK lifts current modern-envelope capabilities into `envelope`; legacy
 * stateless calls have none and therefore always select the browser Form. */
const capabilities = (context: { readonly mcpReq: { readonly envelope?: unknown } }): Member.Capabilities => {
  const envelope = context.mcpReq.envelope
  if (!isRecord(envelope)) return {}
  const client = envelope[CLIENT_CAPABILITIES_META_KEY]
  if (!isRecord(client) || !isRecord(client.elicitation)) return {}
  return { form: isRecord(client.elicitation.form), url: isRecord(client.elicitation.url) }
}

const formSchema = (request: Tool.ElicitInput) =>
  request.mode === "form"
    ? {
        type: "object" as const,
        properties: Object.fromEntries(request.fields.map((field) => [field.key, fieldSchema(field)])),
        required: request.fields
          .filter((field) => field.type !== "external" && field.required)
          .map((field) => field.key),
      }
    : { type: "object" as const, properties: {} }

const fieldSchema = (field: Form.Field): Record<string, unknown> => {
  if (field.type === "external") return {}
  if (field.type === "boolean")
    return { type: "boolean", ...(field.default === undefined ? {} : { default: field.default }) }
  if (field.type === "number" || field.type === "integer")
    return {
      type: field.type,
      ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
      ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
      ...(field.default === undefined ? {} : { default: field.default }),
    }
  if (field.type === "multiselect")
    return {
      type: "array",
      items: { type: "string", ...(field.options ? { enum: field.options.map((option) => option.value) } : {}) },
      ...(field.minItems === undefined ? {} : { minItems: field.minItems }),
      ...(field.maxItems === undefined ? {} : { maxItems: field.maxItems }),
    }
  return {
    type: "string",
    ...(field.options ? { enum: field.options.map((option) => option.value) } : {}),
    ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
    ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
    ...(field.pattern === undefined ? {} : { pattern: field.pattern }),
    ...(field.format === undefined ? {} : { format: field.format }),
  }
}

const objectRoot = (schema: unknown) =>
  isRecord(schema) && !("type" in schema) ? { type: "object" as const, ...schema } : schema

const wireDefinition = (definition: Tool.Snapshot["definitions"][number], wrappedOutputs: Set<string>) => ({
  ...definition,
  inputSchema: objectRoot(definition.inputSchema),
  ...(definition.outputSchema === undefined
    ? {}
    : isObjectSchema(definition.outputSchema)
      ? { outputSchema: pendingOutputSchema(definition.outputSchema) }
      : (wrappedOutputs.add(definition.name),
        { outputSchema: pendingOutputSchema(wrappedOutputSchema(definition.outputSchema)) })),
})

const isObjectSchema = (schema: unknown): schema is Record<string, unknown> =>
  isRecord(schema) && schema.type === "object"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const wrappedOutputSchema = (schema: unknown) => ({
  type: "object" as const,
  properties: { output: schema },
  required: ["output"],
})

// An invocation can stop at an elicitation before it produces the Tool's
// declared output. Advertise that alternative rather than serializing pending
// state into the Tool's output shape (which clients correctly reject).
const pendingOutputSchema = (result: Record<string, unknown>) => ({
  // Keep an object root: the 2025 codec otherwise wraps every structured
  // result in `{ result }`, hiding the advertised pending contract.
  type: "object" as const,
  anyOf: [
    result,
    {
      type: "object" as const,
      properties: {
        status: { const: "pending" },
        mode: { enum: ["browser", "model"] },
        url: { type: "string" },
        request: { type: "object" },
        continuation: { type: "string" },
      },
      required: ["status", "mode", "continuation"],
    },
  ],
})

const outputContent = (output: unknown, wrapped: boolean) => (wrapped ? { output } : output)
