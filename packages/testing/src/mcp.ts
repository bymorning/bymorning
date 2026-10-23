/** Real inbound MCP client authorized through Application's public OAuth grant flow. */
export * as TestMCP from "./mcp.js"

import { Client, type ClientCapabilities, type VersionNegotiationOptions, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import type { Workspace } from "@bymorning/schema/workspace"
import { OAuthAuthorization } from "@bymorning/schema/oauth-authorization"
import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import type { TestApp } from "./application.js"

/** The SDK must already be authenticated as the approving Workspace member. */
export interface ConnectOptions {
  /** Opt in to the current MCP wire era and advertise its client capabilities. */
  readonly capabilities?: ClientCapabilities
  readonly versionNegotiation?: VersionNegotiationOptions
  /** Deliberately exercise a distinct gateway presentation opt-in. */
  readonly elicitation?: "browser" | "model"
  /** @deprecated Use `elicitation: "model"`. */
  readonly model?: boolean
  /** Register modern request handlers before the initialization exchange. */
  readonly configure?: (client: Client) => void
}

export const connect = Effect.fn("TestMCP.connect")(function* (
  app: Pick<TestApp.Interface, "origin" | "client">,
  workspaceID: Workspace.ID,
  options: ConnectOptions = {},
) {
  const token = yield* Effect.tryPromise(async () => {
    const redirect = "http://127.0.0.1/callback"
    const registration = await fetch(new URL("/oauth/register", app.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirect], client_name: "Application fixture" }),
    })
    assert.equal(registration.status, 201)
    // @effect-diagnostics-next-line schemaSyncInEffect:off
    const { client_id } = Schema.decodeUnknownSync(Schema.Struct({ client_id: Schema.String }))(
      await registration.json(),
    )
    const verifier = randomBytes(32).toString("base64url")
    const authorize = new URL("/oauth/authorize", app.origin)
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: redirect,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString()
    const authorization = await fetch(authorize, { redirect: "manual" })
    assert.equal(authorization.status, 302)
    const location = authorization.headers.get("location")
    assert.ok(location)
    const requestID = new URL(location).searchParams.get("request")
    assert.ok(requestID)
    const approval = await app.client["api.oauth"].approve({
      requestID: OAuthAuthorization.ID.make(requestID),
      workspaceID,
    })
    const code = new URL(approval.url).searchParams.get("code")
    assert.ok(code)
    const exchange = await fetch(new URL("/oauth/token", app.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id,
        redirect_uri: redirect,
      }),
    })
    assert.equal(exchange.status, 200)
    // @effect-diagnostics-next-line schemaSyncInEffect:off
    return Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }))(await exchange.json()).access_token
  })
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const client = new Client(
        { name: "application-fixture", version: "1" },
        {
          ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
          ...(options.versionNegotiation === undefined ? {} : { versionNegotiation: options.versionNegotiation }),
        },
      )
      options.configure?.(client)
      return client
    }),
    (client) => Effect.promise(() => client.close()),
  )
  yield* Effect.tryPromise(() =>
    client.connect(
      new StreamableHTTPClientTransport(new URL(
        options.elicitation === undefined && !options.model ? "/mcp" : `/mcp?elicitation=${options.elicitation ?? "model"}`,
        app.origin,
      ), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    ),
  )
  return client
})
