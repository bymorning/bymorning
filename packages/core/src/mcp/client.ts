export * as McpClient from "./client.js"

import { Client, SdkHttpError, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client"
import type { Provider } from "./oauth.js"
import type { CallToolResult } from "@modelcontextprotocol/client"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import type { Session } from "@bymorning/schema/session"
import type { Tool } from "@bymorning/schema/tool"
import { Deferred, Effect, Schema, Scope, Semaphore } from "effect"
import { request } from "./http.js"
import { McpElicit } from "./elicit.js"

const defaultCatalogTimeout = 30_000
const defaultStartupTimeout = 30_000
const defaultExecutionTimeout = 12 * 60 * 60 * 1_000
type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image" | "audio"; readonly mimeType: string; readonly data: string }
  | {
      readonly type: "resource"
      readonly uri: string
      readonly mimeType?: string
      readonly text?: string
      readonly blob?: string
    }

export interface Connection {
  readonly instructions: string | undefined
  readonly closed: Effect.Effect<never, RequestError | NeedsAuthError>
  readonly onToolsChanged: (callback: () => void) => void
  // @effect-diagnostics-next-line lazyEffect:off
  readonly ping: () => Effect.Effect<void, RequestError | NeedsAuthError>
  // @effect-diagnostics-next-line lazyEffect:off
  readonly tools: () => Effect.Effect<
    ReadonlyArray<{
      readonly name: string
      readonly description?: string
      readonly inputSchema: unknown
      readonly outputSchema?: unknown
    }>,
    RequestError | NeedsAuthError
  >
  readonly call: (
    name: string,
    input: Record<string, unknown>,
    sessionID?: Session.ID,
    elicit?: Tool.Context["elicit"],
  ) => Effect.Effect<
    {
      readonly isError: boolean
      readonly structured: unknown
      readonly content: ReadonlyArray<ContentPart>
    },
    RequestError | NeedsAuthError
  >
}

export class RequestError extends Schema.TaggedError<RequestError>()("Mcp.RequestError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class NeedsAuthError extends Schema.TaggedError<NeedsAuthError>()("Mcp.NeedsAuthError", {
  server: Schema.String,
}) {}

/** Connect one outbound Streamable HTTP MCP client for the lifetime of the calling Scope. */
export const connect = Effect.fn("McpClient.connect")(function* (
  server: string,
  config: ConfigMCP.Remote,
  authProvider?: Provider,
) {
  const url = yield* Effect.try({
    try: () => new URL(config.url),
    catch: toError,
  })
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return yield* new RequestError({ message: `Unsupported MCP URL protocol: ${url.protocol}`, cause: config.url })
  }
  const headers = yield* Effect.try({
    try: () => (config.headers === undefined ? undefined : new Headers(config.headers)),
    catch: toError,
  })
  // Request raw remote tools when we supply Code Mode ourselves. Keep the
  // configured URL untouched: OAuth identity is based on that exact value.
  const addedCodemode = config.codemode !== false && !url.searchParams.has("codemode")
  if (addedCodemode) url.searchParams.set("codemode", "false")
  const closed = yield* Deferred.make<never, RequestError | NeedsAuthError>()
  const unavailableElicitation = (() =>
    Effect.die(new Error("MCP elicitation is unavailable for this call"))) as Tool.Context["elicit"]
  // The SDK dispatches legacy server requests from its transport callback, outside
  // the Promise continuation that initiated callTool. Keep one request active so
  // that callback has one unambiguous Tool context. This is intentionally a
  // per-connection lease, not a global Session lock.
  const calls = Semaphore.makeUnsafe(1)
  let activeElicitation = unavailableElicitation
  const open = (endpoint: URL) =>
    Effect.gen(function* () {
      const transport = new StreamableHTTPClientTransport(endpoint, {
        fetch: request,
        // A tool could already have run when a response receives a 401, so do
        // not let the transport retry it through the full OAuth provider. The
        // connection provider refreshes an imminently expiring credential
        // before this transport is opened.
        authProvider:
          authProvider === undefined
            ? undefined
            : { token: async () => (await authProvider.tokens())?.access_token },
        requestInit: headers === undefined ? undefined : { headers },
      })
      if (authProvider !== undefined) {
        const send = transport.send.bind(transport)
        // Keep the presented OAuth generation local to this SDK send, including
        // its awaited authentication callbacks. Parallel sends remain concurrent.
        transport.send = (...args) => authProvider.request(() => send(...args))
      }
      const client = new Client(
        { name: "bymorning", version: "unknown" },
        {
          capabilities: { elicitation: { form: {}, url: {} } },
        },
      )
      client.setRequestHandler("elicitation/create", async (request) => {
        return (await Effect.runPromise(
          activeElicitation(McpElicit.input(request.params)).pipe(
            Effect.map(McpElicit.result),
            Effect.map((result) =>
              result.action === "accept" ? { ...result, content: Object.fromEntries(Object.entries(result.content).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) } : result,
            ),
          ),
        )) as any
      })
      yield* Effect.tryPromise({
        try: (signal) =>
          client.connect(transport, { signal, timeout: config.timeout?.startup ?? defaultStartupTimeout }),
        catch: (cause) => toClientError(server, cause),
      }).pipe(
        Effect.onError(() => Effect.tryPromise({ try: () => transport.close(), catch: toError }).pipe(Effect.ignore)),
      )
      return { client, transport }
    })
  const { client, transport } = yield* open(url).pipe(
    Effect.catchTag("Mcp.RequestError", (error) => {
      if (!(error.cause instanceof SdkHttpError)) return Effect.fail(error)
      if (addedCodemode && error.cause.status === 404)
        // Compatibility with endpoints that reject unknown query parameters.
        return open(new URL(config.url))
      return Effect.fail(error)
    }),
  )
  client.onclose = () => {
    Deferred.doneUnsafe(closed, Effect.fail(new RequestError({ message: "MCP connection closed", cause: undefined })))
  }
  // The SDK reports an unexpectedly broken SSE stream through onerror, not
  // onclose. Retire this connection so its catalog cannot remain falsely live.
  client.onerror = (cause) => {
    Deferred.doneUnsafe(closed, Effect.fail(toClientError(server, cause)))
  }
  const scope = yield* Scope.Scope
  yield* Scope.addFinalizer(
    scope,
    Effect.tryPromise({ try: () => transport.terminateSession(), catch: toError }).pipe(
      Effect.timeout("1 second"),
      Effect.ignore,
      Effect.ensuring(Effect.tryPromise({ try: () => client.close(), catch: toError }).pipe(Effect.ignore)),
    ),
  )

  return {
    instructions: client.getInstructions()?.trim() || undefined,
    closed: Deferred.await(closed),
    onToolsChanged: (callback) => {
      if (!client.getServerCapabilities()?.tools?.listChanged) return
      client.setNotificationHandler("notifications/tools/list_changed", async () => callback())
    },
    ping: () =>
      Effect.tryPromise({
        try: (signal) => client.ping({ signal, timeout: config.timeout?.catalog ?? defaultCatalogTimeout }),
        catch: (cause) => toClientError(server, cause),
      }),
    tools: () =>
      Effect.tryPromise({
        try: (signal) =>
          paginate((cursor) =>
            client.listTools(
              // v2 aggregates and caches an omitted cursor. Keep the existing
              // unbounded, explicit pagination contract instead.
              { cursor: cursor ?? "" },
              {
                signal,
                timeout: config.timeout?.catalog ?? defaultCatalogTimeout,
              },
            ),
          ),
        catch: (cause) => toClientError(server, cause),
      }).pipe(
        Effect.map((tools) =>
          tools.map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            inputSchema: tool.inputSchema,
            ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
          })),
        ),
      ),
    call: (name, input, sessionID, elicit) =>
      calls.withPermit(
        Effect.sync(() => {
          activeElicitation = elicit ?? unavailableElicitation
        }).pipe(
          Effect.andThen(
            Effect.tryPromise({
              try: (signal) =>
                client.callTool(
                  { name, arguments: input, ...(sessionID === undefined ? {} : { _meta: { sessionID } }) },
                  { signal, timeout: config.timeout?.execution ?? defaultExecutionTimeout },
                ),
              catch: (cause) => toClientError(server, cause),
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              activeElicitation = unavailableElicitation
            }),
          ),
        ),
      ).pipe(
        Effect.map((result) => {
          const parsed = result as CallToolResult
          return {
            isError: parsed.isError === true,
            structured: parsed.structuredContent,
            content: parsed.content.flatMap((part): Array<ContentPart> => {
              if (part.type === "text") return [{ type: "text" as const, text: part.text }]
              if (part.type === "image" || part.type === "audio")
                return [{ type: part.type, mimeType: part.mimeType, data: part.data }]
              if (part.type === "resource_link") return [{ type: "text", text: part.uri }]
              if (part.type === "resource") {
                const resource = part.resource as { uri: string; mimeType?: string; text?: string; blob?: string }
                return [
                  {
                    type: "resource" as const,
                    uri: resource.uri,
                    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
                    ...(resource.text === undefined ? {} : { text: resource.text }),
                    ...(resource.blob === undefined ? {} : { blob: resource.blob }),
                  },
                ]
              }
              return []
            }),
          }
        }),
        Effect.tapError((error) =>
          error instanceof NeedsAuthError ? Deferred.fail(closed, error).pipe(Effect.ignore) : Effect.void,
        ),
        Effect.tapError((error) => Effect.logWarning("failed to call remote MCP tool", { server, tool: name, error })),
      ),
  } satisfies Connection
})

const toError = (cause: unknown) =>
  new RequestError({ message: cause instanceof Error ? cause.message : String(cause), cause })

const toClientError = (server: string, cause: unknown) => {
  return isUnauthorized(cause) ? new NeedsAuthError({ server }) : toError(cause)
}

const isUnauthorized = (cause: unknown): boolean => hasStatus(cause, 401)

/** Whether a client failure carries an HTTP 403 response status. */
export const isForbidden = (cause: unknown): boolean => hasStatus(cause, 403)

const hasStatus = (cause: unknown, status: number): boolean => {
  if (status === 401 && cause instanceof UnauthorizedError) return true
  if (cause instanceof SdkHttpError && cause.status === status) return true
  // The SDK's pagination path can preserve the transport failure as a plain
  // cause when listTools crosses its promise boundary.  Classify only the
  // protocol's numeric HTTP status, never an error message.
  if (!isRecord(cause)) return false
  if (cause.code === status || cause.status === status) return true
  if (isRecord(cause.response) && cause.response.status === status) return true
  if (isRecord(cause.data) && cause.data.status === status) return true
  return "cause" in cause && hasStatus(cause.cause, status)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

async function paginate(list: (cursor: string | undefined) => ReturnType<Client["listTools"]>) {
  const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  while (true) {
    const result = await list(cursor)
    tools.push(...result.tools)
    if (result.nextCursor === undefined) return tools
    if (seen.has(result.nextCursor)) throw new Error(`MCP tools/list returned duplicate cursor: ${result.nextCursor}`)
    seen.add(result.nextCursor)
    cursor = result.nextCursor
  }
}
