import {
  Server,
  WebStandardStreamableHTTPServerTransport,
  type CallToolResult,
  type CallToolRequest,
} from "@modelcontextprotocol/server"
import { Effect } from "effect"
import { createServer, type ServerResponse } from "node:http"
import { Readable } from "node:stream"

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: object
  readonly outputSchema?: object
}

/** A real Streamable HTTP MCP server, deliberately small enough for transport tests. */
export const server = (
  tool: ToolDefinition,
  options: {
    readonly list?: () => Promise<void>
    readonly result?: CallToolResult
    readonly elicit?: (server: Server, request: CallToolRequest) => Promise<CallToolResult>
    readonly reject?: (url: URL, headers: Readonly<Record<string, string>>) => number | undefined
    readonly hangDelete?: boolean
  } = {},
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      let definition = tool
      let closes = 0
      let calls = 0
      let connections = 0
      const requests: Array<{
        readonly method: string
        readonly url: string
        readonly headers: Readonly<Record<string, string>>
      }> = []
      const invocations: Array<CallToolRequest["params"]> = []
      const streams: ServerResponse[] = []
      const streamWaiters = new Map<number, () => void>()
      const deleteStarted = Promise.withResolvers<void>()
      const deleteClosed = Promise.withResolvers<void>()
      const deleteRelease = Promise.withResolvers<void>()
      const sessions = new Map<
        string,
        { readonly server: Server; readonly transport: WebStandardStreamableHTTPServerTransport }
      >()
      const createSession = async () => {
        connections++
        const mcp = new Server(
          { name: "transport-fixture", version: "1.0.0" },
          { capabilities: { tools: { listChanged: true } } },
        )
        mcp.setRequestHandler("tools/list", async () => {
          await options.list?.()
          return { tools: [definition] as never }
        })
        mcp.setRequestHandler("tools/call", (request) => {
          calls++
          invocations.push(request.params)
          if (options.elicit) return options.elicit(mcp, request)
          return Promise.resolve(
            options.result ?? {
              structuredContent: { answer: 42 },
              content: [
                { type: "text", text: "answer" },
                { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
                { type: "resource", resource: { uri: "file:///answer.txt", mimeType: "text/plain", text: "answer" } },
              ],
            },
          )
        })
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
        })
        await mcp.connect(transport)
        return { server: mcp, transport }
      }
      const http = createServer(async (incoming, outgoing) => {
        const url = new URL(incoming.url ?? "/", "http://127.0.0.1")
        const received = Object.fromEntries(
          Object.entries(incoming.headers).flatMap(([name, value]) =>
            typeof value === "string" ? [[name, value]] : Array.isArray(value) ? [[name, value.join(", ")]] : [],
          ),
        )
        requests.push({ method: incoming.method ?? "GET", url: incoming.url ?? "/", headers: received })
        const rejected = options.reject?.(url, received)
        if (rejected !== undefined) return outgoing.writeHead(rejected).end()
        const chunks: Buffer[] = []
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
          else if (value !== undefined) headers.set(name, value)
        }
        const request = new Request(`http://127.0.0.1${incoming.url}`, {
          method: incoming.method,
          headers,
          ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
        })
        const sessionID = request.headers.get("mcp-session-id")
        const session = sessionID === null ? await createSession() : sessions.get(sessionID)
        if (session === undefined) return outgoing.writeHead(404).end()
        if (incoming.method === "DELETE" && options.hangDelete) {
          outgoing.once("close", () => deleteClosed.resolve())
          deleteStarted.resolve()
          await deleteRelease.promise
          if (outgoing.destroyed) return
        }
        const response = await session.transport.handleRequest(request)
        const initialized = response.headers.get("mcp-session-id")
        if (initialized !== null) sessions.set(initialized, session)
        if (incoming.method === "DELETE" && sessionID !== null) {
          closes++
          sessions.delete(sessionID)
        }
        outgoing.statusCode = response.status
        response.headers.forEach((value, name) => outgoing.setHeader(name, value))
        if (incoming.method === "GET" && response.headers.get("content-type")?.startsWith("text/event-stream")) {
          const index = streams.push(outgoing) - 1
          streamWaiters.get(index)?.()
          streamWaiters.delete(index)
        }
        if (response.body === null) outgoing.end()
        else Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(outgoing)
      })
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
      const address = http.address()
      if (address === null || typeof address === "string") throw new Error("fixture did not listen")
      return {
        url: `http://127.0.0.1:${address.port}/mcp`,
        get calls() {
          return calls
        },
        get closes() {
          return closes
        },
        get connections() {
          return connections
        },
        requests,
        invocations,
        deleteStarted: deleteStarted.promise,
        deleteClosed: deleteClosed.promise,
        releaseDelete: () => deleteRelease.resolve(),
        waitForSSE: (index: number) =>
          streams[index] === undefined
            ? new Promise<void>((resolve) => streamWaiters.set(index, resolve))
            : Promise.resolve(),
        destroySSE: (index: number) => streams[index]?.destroy(),
        update: async (next: ToolDefinition) => {
          definition = next
          await Promise.all([...sessions.values()].map(({ server }) => server.sendToolListChanged()))
        },
        close: async () => {
          deleteRelease.resolve()
          for (const stream of streams) stream.destroy()
          await Promise.all([...sessions.values()].map(({ server }) => server.close().catch(() => undefined)))
          await new Promise<void>((resolve, reject) =>
            http.close((error) => (error === undefined ? resolve() : reject(error))),
          )
        },
      }
    }),
    (fixture) => Effect.promise(fixture.close),
  )
