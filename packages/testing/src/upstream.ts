/** A scoped OAuth-protected upstream MCP server for Application integration scenarios. */
export * as TestUpstream from "./upstream.js"

import { Server, createMcpHandler, inputRequired } from "@modelcontextprotocol/server"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { TestHTTP } from "./http.js"

export interface Tool {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
  readonly result?: unknown
  /** Request an MCP form or URL elicitation before returning this Tool result. */
  readonly elicitation?:
    | { readonly mode: "form"; readonly message?: string; readonly requestedSchema?: Record<string, unknown> }
    | { readonly mode: "url"; readonly message?: string; readonly url: string }
  /** Pause after recording this invocation, until `release` is called. */
  readonly gate?: string
}

export interface Options {
  readonly tools?: ReadonlyArray<Tool>
}

export interface Invocation {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

/**
 * Starts a real HTTP MCP resource server. It deliberately accepts only the
 * refreshed token (`access-2`), making OAuth discovery, DCR, PKCE, callback,
 * token exchange, and refresh observable parts of a scenario.
 *
 */
export const make = (options: Options = {}) =>
  Effect.gen(function* () {
    const tools = options.tools ?? [{ name: "fixture", inputSchema: { type: "object", properties: {} } }]
    const catalog = new Map(tools.map((tool) => [tool.name, tool]))
    assert.equal(catalog.size, tools.length, "Upstream MCP Tool names must be unique")

    let challenge = ""
    let registrations = 0
    let pkceVerified = false
    let rejectRefresh = false
    let postInvocation: "none" | "unauthorized" | "ambiguous" = "none"
    let initializations = 0
    let terminations = 0
    const failures: unknown[] = []
    const codes = new Map<string, { readonly redirect: string; readonly clientID: string }>()
    const invocations: Invocation[] = []
    const elicitations: Array<{ readonly tool: string; readonly result: unknown }> = []
    const gates = new Map<string, { promise: Promise<void>; release: () => void }>()
    const gate = (name: string) => {
      const known = gates.get(name)
      if (known) return known
      let release!: () => void
      const promise = new Promise<void>((resolve) => { release = resolve })
      const next = { promise, release }
      gates.set(name, next)
      return next
    }
    const server = () => {
      const server = new Server({ name: "upstream-mcp-fixture", version: "1" }, { capabilities: { tools: {} } })
      server.setRequestHandler("tools/list", () => ({
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema: inputSchema ?? { type: "object", properties: {} },
        })),
      }) as never)
      server.setRequestHandler("tools/call", async (call: any, context: any) => {
        const tool = catalog.get(call.params.name)
        if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown Tool: ${call.params.name}` }] }
        const elicitationKey = `${tool.name}-elicitation`
        if (tool.elicitation?.mode === "form") {
          const result = context.mcpReq.inputResponses?.[elicitationKey]
          if (!result) return inputRequired({
            requestState: randomUUID(),
            inputRequests: { [elicitationKey]: inputRequired.elicit({
              message: tool.elicitation.message ?? `Input required by ${tool.name}`,
              requestedSchema: (tool.elicitation.requestedSchema ?? { type: "object", properties: {} }) as never,
            }) },
          })
          elicitations.push({ tool: tool.name, result })
        }
        if (tool.elicitation?.mode === "url") {
          const result = context.mcpReq.inputResponses?.[elicitationKey]
          if (!result) return inputRequired({
            requestState: randomUUID(),
            inputRequests: { [elicitationKey]: inputRequired.elicitUrl({
              message: tool.elicitation.message ?? `Continue ${tool.name}`,
              url: tool.elicitation.url,
            }) },
          })
          elicitations.push({ tool: tool.name, result })
        }
        invocations.push({ name: tool.name, arguments: call.params.arguments ?? {} })
        if (tool.gate) await gate(tool.gate).promise
        return { content: [{ type: "text", text: JSON.stringify(tool.result ?? `${tool.name} result`) }] }
      })
      return server
    }
    const handler = createMcpHandler(server, { legacy: "stateless", onerror: (error) => failures.push(error) })

    const http = yield* TestHTTP.make((incoming, outgoing) => {
      void (async () => {
        const origin = http.origin.origin
        const body = Buffer.concat(await Array.fromAsync(incoming).then((chunks) => chunks.map((chunk) => Buffer.from(chunk))))
        const url = new URL(incoming.url ?? "/", origin)
        const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => {
          outgoing.writeHead(status, { "content-type": "application/json", ...headers })
          outgoing.end(JSON.stringify(value))
        }
        const challengeResponse = () => json(
          { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Authentication required" } },
          401,
          { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` },
        )
        if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
          json({ resource: `${origin}/mcp`, authorization_servers: [origin] })
          return
        }
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
          })
          return
        }
        if (url.pathname === "/register") {
          registrations++
          const metadata = JSON.parse(body.toString("utf8")) as { redirect_uris?: unknown }
          if (!Array.isArray(metadata.redirect_uris) || typeof metadata.redirect_uris[0] !== "string") {
            json({ error: "invalid_client_metadata" }, 400)
            return
          }
          json({ client_id: "fixture-client", ...metadata }, 201)
          return
        }
        if (url.pathname === "/authorize") {
          assert.equal(url.searchParams.get("response_type"), "code")
          const redirect = url.searchParams.get("redirect_uri")
          const clientID = url.searchParams.get("client_id")
          assert.ok(redirect)
          assert.ok(clientID)
          challenge = url.searchParams.get("code_challenge") ?? ""
          const code = randomBytes(24).toString("base64url")
          codes.set(code, { redirect, clientID })
          const callback = new URL(redirect)
          callback.search = new URLSearchParams({ code, state: url.searchParams.get("state") ?? "" }).toString()
          outgoing.writeHead(302, { location: callback.href }).end()
          return
        }
        if (url.pathname === "/token") {
          const form = new URLSearchParams(body.toString("utf8"))
          if (form.get("grant_type") === "refresh_token") {
            if (rejectRefresh) {
              json({ error: "invalid_grant" }, 400)
              return
            }
            assert.equal(form.get("refresh_token"), "refresh-1")
            json({ access_token: "access-2", refresh_token: "refresh-2", token_type: "Bearer", expires_in: 3600 })
            return
          }
          assert.equal(form.get("grant_type"), "authorization_code")
          const code = form.get("code") ?? ""
          const issued = codes.get(code)
          assert.ok(issued, "Authorization code must have been issued by this fixture")
          codes.delete(code)
          assert.equal(form.get("redirect_uri"), issued.redirect)
          assert.equal(form.get("client_id"), issued.clientID)
          pkceVerified = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === challenge
          if (!pkceVerified) {
            json({ error: "invalid_grant" }, 400)
            return
          }
          json({ access_token: "access-1", refresh_token: "refresh-1", token_type: "Bearer", expires_in: 1 })
          return
        }
        if (url.pathname !== "/mcp") {
          outgoing.writeHead(404).end()
          return
        }
        if (incoming.headers.authorization !== "Bearer access-2") {
          challengeResponse()
          return
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
          else if (value !== undefined) headers.set(name, value)
        }
        const request = new Request(`${origin}${incoming.url}`, {
          method: incoming.method,
          headers,
          ...(body.length === 0 ? {} : { body }),
        })
        const message = body.length === 0 ? undefined : JSON.parse(body.toString("utf8")) as { method?: string }
        if (message?.method === "initialize") initializations++
        if (incoming.method === "DELETE") terminations++
        const response = await handler.fetch(request, { parsedBody: message })
        if (message?.method === "tools/call" && postInvocation !== "none") {
          postInvocation = "none"
          challengeResponse()
          return
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      })().catch((error) => {
        failures.push(error)
        if (!outgoing.headersSent) outgoing.writeHead(500)
        outgoing.end("Upstream MCP fixture protocol assertion failed")
      })
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => assert.equal(failures.length, 0, "Upstream MCP protocol assertions failed")))
    yield* Effect.addFinalizer(() => Effect.promise(() => handler.close()))
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      for (const pending of gates.values()) pending.release()
    }))
    return {
      url: new URL("/mcp", http.origin),
      origin: http.origin,
      invocations: (): ReadonlyArray<Invocation> => [...invocations],
      elicitations: () => [...elicitations],
      requests: http.requests,
      waitGate: (name: string) => Effect.promise(() => gate(name).promise),
      release: (name: string) => Effect.sync(() => gate(name).release()),
      /** The next completed Tool invocation receives a 401 after it ran. */
      unauthorized: () => { postInvocation = "unauthorized" },
      /** Like `unauthorized`, explicitly marking the Tool result as ambiguous to the caller. */
      ambiguous: () => { postInvocation = "ambiguous" },
      set rejectRefresh(value: boolean) { rejectRefresh = value },
      get registrations() { return registrations },
      get pkceVerified() { return pkceVerified },
      get initializations() { return initializations },
      get terminations() { return terminations },
    }
  })
