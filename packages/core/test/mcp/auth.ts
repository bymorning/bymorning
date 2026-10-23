import { Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { Effect } from "effect"
import { createServer } from "node:http"

/** A real Streamable HTTP MCP peer; authentication failures happen at HTTP, not in an SDK double. */
export const server = (options: { readonly reject?: number; readonly rejectMessage?: string; readonly rejectStatus?: number; readonly requireToken?: string; readonly rejectMethod?: string; readonly rejectAfterCall?: boolean; readonly refresh?: boolean; readonly authorize?: boolean; readonly token?: (form: URLSearchParams) => Promise<{ readonly status: number; readonly body: unknown }> } = {}) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      let rejects = options.reject ?? 0
      let calls = 0
      let registrations = 0
      const authorizations: string[] = []
      /** Every request with the JSON-RPC method it carried; stream GETs and DELETEs have none. */
      const requests: Array<{ readonly method: string | undefined; readonly authorization: string }> = []
      const sessions = new Map<string, { readonly server: Server; readonly transport: WebStandardStreamableHTTPServerTransport }>()
      const http = createServer(async (incoming, outgoing) => {
        const chunks: Buffer[] = []
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks)
        const origin = `http://${incoming.headers.host}`
        const json = (status: number, value: unknown) => {
          outgoing.writeHead(status, { "content-type": "application/json" })
          outgoing.end(JSON.stringify(value))
        }
        // A real OAuth discovery/registration/refresh exchange. A bare 401 does
        // not invalidate a token: the authorization server must reject its grant.
        if (incoming.url?.startsWith("/.well-known/oauth-protected-resource"))
          return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin] })
        if (incoming.url === "/.well-known/oauth-authorization-server")
          return json(200, {
            issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`, response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
          })
        if (incoming.url === "/register") {
          registrations++
          return json(201, { client_id: "fixture-client", redirect_uris: ["https://invalid.local"] })
        }
        if (incoming.url === "/token" && options.token !== undefined) {
          const result = await options.token(new URLSearchParams(body.toString()))
          return json(result.status, result.body)
        }
        if (incoming.url === "/token" && options.authorize && new URLSearchParams(body.toString()).get("grant_type") === "authorization_code")
          return json(200, { access_token: options.requireToken ?? "authorized", refresh_token: "authorized-refresh", token_type: "Bearer" })
        if (incoming.url === "/token") return options.refresh
          ? json(200, { access_token: "rotated", refresh_token: "rotated-refresh", token_type: "Bearer" })
          : json(400, { error: "invalid_grant" })
        if (incoming.url !== "/mcp") return json(404, { error: "not_found" })
        const payload = body.length === 0 ? undefined : JSON.parse(body.toString())
        authorizations.push(incoming.headers.authorization ?? "")
        requests.push({ method: payload?.method, authorization: incoming.headers.authorization ?? "" })
        if (payload?.method === "tools/call") calls++
        if ((payload?.method === (options.rejectMethod ?? "tools/list") && rejects-- > 0) ||
          (payload?.method === "tools/call" && options.rejectAfterCall === true && rejects-- > 0) ||
          (options.requireToken !== undefined && incoming.headers.authorization !== `Bearer ${options.requireToken}`)) {
          outgoing.writeHead(options.rejectStatus ?? 401, { "www-authenticate": "Bearer" })
          outgoing.end(options.rejectMessage ?? "Authentication required")
          return
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
          else if (value !== undefined) headers.set(name, value)
        }
        const request = new Request(`http://127.0.0.1${incoming.url}`, {
          method: incoming.method,
          headers,
          ...(body.length === 0 ? {} : { body }),
        })
        let session = sessions.get(headers.get("mcp-session-id") ?? "")
        if (session === undefined) {
          const mcp = new Server({ name: "mcp-auth-fixture", version: "1" }, { capabilities: { tools: {} } })
          mcp.setRequestHandler("tools/list", () =>
            Promise.resolve({ tools: [{ name: "authenticated", inputSchema: { type: "object", properties: {} } }] }),
          )
          mcp.setRequestHandler("tools/call", () => Promise.resolve({ content: [{ type: "text", text: "ok" }] }))
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            enableJsonResponse: true,
          })
          await mcp.connect(transport)
          session = { server: mcp, transport }
        }
        const response = await session.transport.handleRequest(request)
        const id = response.headers.get("mcp-session-id")
        if (id !== null) sessions.set(id, session)
        outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      })
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
      const address = http.address()
      if (address === null || typeof address === "string") throw new Error("MCP auth fixture did not listen")
      return {
        url: `http://127.0.0.1:${address.port}/mcp`,
        authorizations,
        requests,
        get calls() { return calls },
        get registrations() { return registrations },
        close: async () => {
          await Promise.all([...sessions.values()].map(({ server }) => server.close()))
          await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()))
        },
      }
    }),
    (fixture) => Effect.promise(fixture.close),
  )
