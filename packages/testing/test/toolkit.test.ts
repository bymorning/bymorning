import { Auth } from "@bymorning/schema/auth"
import type { ByMorningClient } from "@bymorning/client"
import { Effect, Fiber, Schema, Stream } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { TestMCP } from "../src/mcp.js"
import { TestOAuth } from "../src/oauth.js"
import { ToolAuth } from "../src/scenario/tool-auth.js"
import { TestUpstream } from "../src/upstream.js"

type CodeResult = {
  readonly isError?: boolean
  readonly content: unknown
  readonly structuredContent?: {
    readonly output?: unknown
    readonly error?: boolean
    readonly toolCalls?: ReadonlyArray<{ readonly tool: string; readonly status: string }>
  }
}

const execute = (mcp: Effect.Success<ReturnType<typeof TestMCP.connect>>, code: string) =>
  Effect.tryPromise(() =>
    mcp.callTool({ name: "execute", arguments: { description: "Run Code Mode", code } }) as Promise<CodeResult>,
  )

const events = (client: ByMorningClient, workspace: string) =>
  Stream.fromAsyncIterable(
    client.event.subscribe({ workspace: workspace as never }),
    (cause) => new TestApp.RequestError({ message: "Workspace Event stream failed", cause }),
  )

const MCPStatus = Schema.Struct({ name: Schema.String, status: Schema.String })
const MCPConnection = Schema.Struct({ status: Schema.Literal("connected"), server: Schema.String })
const MCPDisconnection = Schema.Struct({ status: Schema.Literal("disconnected"), server: Schema.String })
const IntegrationAuthorization = Schema.Struct({
  status: Schema.Literal("authorization"),
  integration: Schema.Struct({ id: Schema.String, connections: Schema.Array(Schema.Unknown) }),
  attempt: Schema.Struct({
    attemptID: Schema.String,
    url: Schema.String,
    instructions: Schema.String,
    time: Schema.Struct({ created: Schema.Finite, expires: Schema.Finite }),
  }),
})
const IntegrationConnected = Schema.Struct({
  status: Schema.Literal("connected"),
  integration: Schema.Struct({ id: Schema.String }),
  connection: Schema.Struct({
    type: Schema.String,
    id: Schema.optionalKey(Schema.String),
    label: Schema.optionalKey(Schema.String),
    scope: Schema.optionalKey(Schema.String),
  }),
})
const IntegrationStatus = Schema.Struct({
  integration: Schema.Struct({ id: Schema.String, connections: Schema.Array(Schema.Unknown) }),
  attempt: Schema.optionalKey(Schema.Struct({ status: Schema.String })),
})

const output = <A>(result: CodeResult, schema: Schema.Schema<any>): A => {
  expect(result.isError).not.toBe(true)
  expect(result.structuredContent?.error).not.toBe(true)
  expect(result.structuredContent?.toolCalls).toHaveLength(1)
  expect(result.structuredContent?.toolCalls?.[0]).toMatchObject({ status: "completed" })
  const text = Schema.decodeUnknownSync(Schema.String)(result.structuredContent?.output)
  return Schema.decodeUnknownSync(schema as any)(JSON.parse(text)) as A
}

const textOutput = (result: CodeResult) => {
  expect(result.isError).not.toBe(true)
  expect(result.structuredContent?.error).not.toBe(true)
  expect(result.structuredContent?.toolCalls).toHaveLength(1)
  expect(result.structuredContent?.toolCalls?.[0]).toMatchObject({ tool: "fixture.fixture", status: "completed" })
  return Schema.decodeUnknownSync(Schema.String)(result.structuredContent?.output)
}

const complete = (app: TestApp.Interface, issuer: Effect.Success<ReturnType<typeof TestOAuth.make>>, attempt: { readonly url: string }, member: string) =>
  Effect.tryPromise(async () => {
    issuer.bind(attempt.url, member)
    const authorization = await fetch(attempt.url, { redirect: "manual" })
    expect(authorization.status).toBe(302)
    const callback = authorization.headers.get("location")
    expect(callback).toBeTruthy()
    const response = await fetch(new URL(new URL(callback!).pathname + new URL(callback!).search, app.origin), { redirect: "manual" })
    expect(response.status).toBe(303)
  })

test("executes the Toolkit Integration OAuth lifecycle through a real inbound MCP Code Mode call", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const issuer = yield* TestOAuth.make()
    // Supplying the fixture's accepted credential through normal persisted MCP
    // configuration isolates these runtime-management assertions from the
    // separate upstream OAuth browser flow. The server stays enabled in
    // configuration: Outbound MCP Enablement is a Workspace decision a member's
    // live connect cannot bypass, so the lifecycle below toggles the runtime.
    const upstream = yield* TestUpstream.make()
    const app = yield* TestApp.make({ plugins: [ToolAuth.plugin(issuer.origin)] })
    const owner = yield* app.login()
    const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
    yield* Effect.tryPromise(() => app.client["api.config"].update({
      ...config,
      mcp: { servers: { fixture: { type: "remote", url: upstream.url.href, oauth: false, headers: { authorization: "Bearer access-2" } } } },
      permissions: [
        { action: "execute", resource: "*", effect: "allow" },
        { action: "mcp_connect", resource: "fixture", effect: "allow" },
        { action: "mcp_disconnect", resource: "fixture", effect: "allow" },
        { action: "mcp_status", resource: "fixture", effect: "allow" },
        { action: "integration_connect", resource: TestOAuth.integrationID, effect: "deny" },
      ],
    }))
    const ownerMCP = yield* TestMCP.connect(app, owner.properties.workspaceID)

    // The gateway exposes the normal Code Mode transport, not a second mocked
    // Toolkit transport. Toolkit operations are intentionally nested targets.
    const catalog = yield* Effect.tryPromise(() => ownerMCP.listTools() as Promise<{ tools: ReadonlyArray<{ name: string }> }>)
    expect(catalog.tools.map((tool) => tool.name)).toContain("execute")
    expect(catalog.tools.map((tool) => tool.name)).not.toContain("mcp_connect")

    const stopped = output<{ readonly status: "disconnected"; readonly server: string }>(yield* execute(
      ownerMCP,
      'return await tools.toolkit.mcp.disconnect({ server: "fixture" })',
    ), MCPDisconnection)
    expect(stopped).toEqual({ status: "disconnected", server: "fixture" })
    const disconnected = output<{ readonly status: string; readonly name: string }>(yield* execute(
      ownerMCP,
      'return await tools.toolkit.mcp.status({ server: "fixture" })',
    ), MCPStatus)
    expect(disconnected).toMatchObject({ name: "fixture", status: "disabled" })
    const connected = output<{ readonly status: "connected"; readonly server: string }>(yield* execute(
      ownerMCP,
      'return await tools.toolkit.mcp.connect({ server: "fixture" })',
    ), MCPConnection)
    expect(connected).toEqual({ status: "connected", server: "fixture" })
    expect(upstream.initializations).toBeGreaterThan(0)
    expect(JSON.parse(textOutput(yield* execute(ownerMCP, "return await tools.fixture.fixture({})")))).toBe("fixture result")
    expect(upstream.invocations()).toEqual([{ name: "fixture", arguments: {} }])
    const removed = output<{ readonly status: "disconnected"; readonly server: string }>(yield* execute(
      ownerMCP,
      'return await tools.toolkit.mcp.disconnect({ server: "fixture" })',
    ), MCPDisconnection)
    expect(removed).toEqual({ status: "disconnected", server: "fixture" })
    const retainedConfig = yield* Effect.tryPromise(() => app.client["api.config"].get())
    // A runtime disconnect never rewrites the persisted Workspace decision.
    expect(retainedConfig.mcp?.servers?.fixture).toMatchObject({ url: upstream.url.href })
    expect(retainedConfig.mcp?.servers?.fixture?.disabled).not.toBe(true)
    const disabledAgain = output<{ readonly status: string; readonly name: string }>(yield* execute(
      ownerMCP,
      'return await tools.toolkit.mcp.status({ server: "fixture" })',
    ), MCPStatus)
    expect(disabledAgain).toMatchObject({ name: "fixture", status: "disabled" })

    const denied = yield* execute(
      ownerMCP,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)} })`,
    )
    expect(denied.structuredContent?.error).toBe(true)
    expect(denied.structuredContent?.toolCalls).toMatchObject([{ tool: "toolkit.integration.connect", status: "error" }])
    expect(issuer.exchanges()).toEqual([])

    const permitted = yield* Effect.tryPromise(() => app.client["api.config"].get())
    yield* Effect.tryPromise(() => app.client["api.config"].update({
      ...permitted,
      permissions: [
        { action: "execute", resource: "*", effect: "allow" },
        { action: "integration_connect", resource: TestOAuth.integrationID, effect: "allow" },
        { action: "integration_status", resource: TestOAuth.integrationID, effect: "allow" },
      ],
    }))

    const started = output<{
      readonly status: "authorization"
      readonly integration: { readonly id: string; readonly connections: ReadonlyArray<unknown> }
      readonly attempt: { readonly attemptID: string; readonly url: string; readonly instructions: string; readonly time: { readonly expires: number } }
    }>(yield* execute(
      ownerMCP,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)}, label: "owner" })`,
    ), IntegrationAuthorization)
    expect(started).toMatchObject({ status: "authorization", integration: { id: TestOAuth.integrationID, connections: [] } })
    expect(started.attempt.url).toMatch(/^http:\/\//)
    expect(started.attempt.instructions).toContain("Authorize")
    expect(started.attempt.time.expires).toBeGreaterThan(Date.now())
    expect(JSON.stringify(started)).not.toMatch(/access|refresh|secret/i)
    expect(issuer.exchanges()).toEqual([])

    const connectionEvent = yield* events(app.client, owner.properties.workspaceID).pipe(
      Stream.filter(
        (event) => event.type === "integration.connection.updated" && event.data.integrationID === TestOAuth.integrationID,
      ),
      Stream.take(1),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* complete(app, issuer, started.attempt, "owner")
    yield* Fiber.join(connectionEvent)
    const settled = output<{
      readonly integration: { readonly id: string; readonly connections: ReadonlyArray<{ readonly scope?: string; readonly label?: string }> }
      readonly attempt: { readonly status: string }
    }>(yield* execute(
      ownerMCP,
      `return await tools.toolkit.integration.status({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, attemptID: ${JSON.stringify(started.attempt.attemptID)} })`,
    ), IntegrationStatus)
    expect(settled.attempt.status).toBe("complete")
    expect(settled.integration.connections).toEqual([expect.objectContaining({ scope: "member", label: "owner" })])
    expect(JSON.stringify(settled)).not.toMatch(/access|refresh|secret/i)

    const retained = output<{
      readonly status: "connected"
      readonly integration: { readonly id: string }
      readonly connection: { readonly id: string; readonly scope?: string; readonly label?: string }
    }>(yield* execute(
      ownerMCP,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)} })`,
    ), IntegrationConnected)
    expect(retained).toMatchObject({ status: "connected", integration: { id: TestOAuth.integrationID }, connection: { scope: "member", label: "owner" } })

    // An explicit scope must not silently reuse the default-member connection.
    const workspaceResult = yield* execute(
      ownerMCP,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)}, scope: "workspace", label: "workspace" })`,
    )
    const workspaceAttempt = output<typeof started>(workspaceResult, IntegrationAuthorization)
    expect(workspaceAttempt.status).toBe("authorization")
    expect(workspaceAttempt.attempt.attemptID).not.toBe(started.attempt.attemptID)

    // Expiry alone permits the provider's normal refresh path. It must refresh
    // the selected member Credential, not accidentally select another scope.
    yield* ToolAuth.expire(app, owner, retained.connection.id as never)
    expect(yield* ToolAuth.expiry(app, owner, retained.connection.id as never)).toBe(1)
    const expiredResult = yield* execute(
      ownerMCP,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)}, label: "renewed-owner" })`,
    )
    const refreshed = output<typeof retained>(expiredResult, IntegrationConnected)
    expect(refreshed.connection.id).toBe(retained.connection.id)
    expect(yield* ToolAuth.expiry(app, owner, refreshed.connection.id as never)).toBeGreaterThan(Date.now())
    expect(issuer.exchanges()).toEqual([
      { member: "owner", generation: 1, grant: "authorization_code" },
      { member: "owner", generation: 2, grant: "refresh_token" },
    ])

    // A second real member sees no owner Credential and receives a distinct
    // default-member authorization attempt.
    yield* Effect.tryPromise(() => app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" }))
    const memberClient = app.clientFor()
    const member = yield* app.login(memberClient, { subject: Auth.Sub.make("test-member"), email: Auth.Email.make("member@bymorning.ai") })
    const memberMCP = yield* TestMCP.connect({ origin: app.origin, client: memberClient }, member.properties.workspaceID)
    const memberStarted = output<typeof started>(yield* execute(
      memberMCP,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)}, label: "member" })`,
    ), IntegrationAuthorization)
    expect(memberStarted.integration.connections).toEqual([])
    const memberConnection = yield* events(memberClient, member.properties.workspaceID).pipe(
      Stream.filter(
        (event) => event.type === "integration.connection.updated" && event.data.integrationID === TestOAuth.integrationID,
      ),
      Stream.take(1),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* complete(app, issuer, memberStarted.attempt, "member")
    yield* Fiber.join(memberConnection)
    const memberStatus = output<{ readonly integration: { readonly connections: ReadonlyArray<{ readonly scope?: string; readonly label?: string }> } }>(yield* execute(
      memberMCP,
      `return await tools.toolkit.integration.status({ integrationID: ${JSON.stringify(TestOAuth.integrationID)} })`,
    ), IntegrationStatus)
    expect(memberStatus.integration.connections).toEqual([expect.objectContaining({ scope: "member", label: "member" })])
    expect(issuer.exchanges()).toEqual([
      { member: "owner", generation: 1, grant: "authorization_code" },
      { member: "owner", generation: 2, grant: "refresh_token" },
      { member: "member", generation: 1, grant: "authorization_code" },
    ])
  }).pipe(Effect.scoped), { signal })
}, 90_000)

test("starts a new default-member authorization for an expired OAuth method without refresh", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const issuer = yield* TestOAuth.make()
    const app = yield* TestApp.make({ plugins: [ToolAuth.plugin(issuer.origin, { noRefresh: true })] })
    const owner = yield* app.login()
    const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
    yield* Effect.tryPromise(() => app.client["api.config"].update({
      ...config,
      permissions: [
        { action: "execute", resource: "*", effect: "allow" },
        { action: "integration_connect", resource: TestOAuth.integrationID, effect: "allow" },
        { action: "integration_status", resource: TestOAuth.integrationID, effect: "allow" },
      ],
    }))
    const mcp = yield* TestMCP.connect(app, owner.properties.workspaceID)
    const started = output<{
      readonly status: "authorization"
      readonly integration: { readonly connections: ReadonlyArray<unknown> }
      readonly attempt: { readonly attemptID: string; readonly url: string }
    }>(yield* execute(
      mcp,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)}, label: "unrefreshable" })`,
    ), IntegrationAuthorization)
    const connectionEvent = yield* events(app.client, owner.properties.workspaceID).pipe(
      Stream.filter((event) => event.type === "integration.connection.updated" && event.data.integrationID === TestOAuth.integrationID),
      Stream.take(1),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* complete(app, issuer, started.attempt, "owner")
    yield* Fiber.join(connectionEvent)
    const connected = output<{
      readonly status: "connected"
      readonly connection: { readonly id: string; readonly scope?: string }
    }>(yield* execute(
      mcp,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)} })`,
    ), IntegrationConnected)
    expect(connected.connection.scope).toBe("member")
    yield* ToolAuth.expire(app, owner, connected.connection.id as never)
    const renewed = output<typeof started>(yield* execute(
      mcp,
      `return await tools.toolkit.integration.connect({ integrationID: ${JSON.stringify(TestOAuth.integrationID)}, methodID: ${JSON.stringify(TestOAuth.methodID)}, label: "renewed-unrefreshable" })`,
    ), IntegrationAuthorization)
    expect(renewed.attempt.attemptID).not.toBe(started.attempt.attemptID)
    expect(issuer.exchanges()).toEqual([{ member: "owner", generation: 1, grant: "authorization_code" }])
  }).pipe(Effect.scoped), { signal })
})
