import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Effect } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import { TestUpstream } from "../src/upstream.js"

const oauth = (serverUrl: URL) => {
  const callback = "http://127.0.0.1/callback"
  return {
    async authorize() {
      const protectedResource = await fetch(new URL("/.well-known/oauth-protected-resource/mcp", serverUrl))
      const { authorization_servers } = await protectedResource.json() as { authorization_servers: string[] }
      const authorizationServer = new URL(authorization_servers[0]!)
      const metadata = await (await fetch(new URL("/.well-known/oauth-authorization-server", authorizationServer))).json() as {
        registration_endpoint: string
        authorization_endpoint: string
        token_endpoint: string
      }
      const registration = await fetch(metadata.registration_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: "none" }),
      })
      const { client_id } = await registration.json() as { client_id: string }
      const verifier = randomBytes(32).toString("base64url")
      const authorize = new URL(metadata.authorization_endpoint)
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id,
        redirect_uri: callback,
        state: "fixture-state",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      }).toString()
      const redirect = await fetch(authorize, { redirect: "manual" })
      const code = new URL(redirect.headers.get("location")!).searchParams.get("code")!
      const exchange = await fetch(metadata.token_endpoint, {
        method: "POST",
        body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id, redirect_uri: callback }),
      })
      return await exchange.json() as { access_token: string; refresh_token: string }
    },
  }
}

test("serves an OAuth-protected upstream catalog with form and URL elicitation", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const upstream = yield* TestUpstream.make({
      tools: [
        { name: "form", elicitation: { mode: "form", requestedSchema: { type: "object", properties: {} } } },
        { name: "url", elicitation: { mode: "url", url: "https://example.test/continue" } },
      ],
    })
    const token = yield* Effect.tryPromise(() => oauth(upstream.url).authorize())
    expect(token.access_token).toBe("access-1")
    expect(upstream.registrations).toBe(1)
    expect(upstream.pkceVerified).toBe(true)

    const refreshed = yield* Effect.tryPromise(() => fetch(new URL("/token", upstream.origin), {
      method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token }),
    }).then((response) => response.json() as Promise<{ access_token: string }>))
    expect(refreshed.access_token).toBe("access-2")
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new Client(
        { name: "upstream-fixture-test", version: "1" },
        {
          capabilities: { elicitation: { form: {}, url: {} } },
          versionNegotiation: { mode: { pin: "2026-07-28" } },
        },
      )),
      (client) => Effect.promise(() => client.close()),
    )
    const elicitations: Array<{ readonly mode: string }> = []
    client.setRequestHandler("elicitation/create", (request) => {
      elicitations.push({ mode: request.params.mode ?? "form" })
      return { action: "accept", content: { value: "fixture" } }
    })
    yield* Effect.tryPromise(() => client.connect(new StreamableHTTPClientTransport(upstream.url, {
      requestInit: { headers: { authorization: "Bearer access-2" } },
    })))
    const catalog = yield* Effect.tryPromise(() => client.listTools())
    expect(catalog.tools.map((tool) => tool.name)).toEqual(["form", "url"])

    yield* Effect.tryPromise(() => client.callTool({ name: "form", arguments: { approved: true } }))
    yield* Effect.tryPromise(() => client.callTool({ name: "url", arguments: {} }))
    yield* upstream.release("released")
    yield* upstream.waitGate("released")
    expect(elicitations).toEqual([{ mode: "form" }, { mode: "url" }])
    expect(upstream.elicitations()).toHaveLength(2)
  }).pipe(Effect.scoped), { signal })
})

test("makes a post-invocation 401 observable without replaying the Tool", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const upstream = yield* TestUpstream.make({ tools: [{ name: "once" }] })
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new Client(
        { name: "upstream-fixture-test", version: "1" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      )),
      (client) => Effect.promise(() => client.close()),
    )
    yield* Effect.tryPromise(() => client.connect(new StreamableHTTPClientTransport(upstream.url, {
      requestInit: { headers: { authorization: "Bearer access-2" } },
    })))
    upstream.ambiguous()
    yield* Effect.tryPromise(() => expect(client.callTool({ name: "once", arguments: {} })).rejects.toThrow())
    expect(upstream.invocations()).toEqual([{ name: "once", arguments: {} }])
  }).pipe(Effect.scoped), { signal })
})
