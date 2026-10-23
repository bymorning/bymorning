/** Two real members, outbound Integration OAuth and independent inbound MCP grants. */
export * as ToolAuth from "./tool-auth.js"

import type { ByMorningClient } from "@bymorning/client"
import { Bus } from "@bymorning/core/bus"
import { Credential } from "@bymorning/core/credential"
import { Auth } from "@bymorning/schema/auth"
import { AccountActor, type UserActor } from "@bymorning/schema/actor"
import { Integration } from "@bymorning/schema/integration"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { TestApp } from "../application.js"
import { TestMCP } from "../mcp.js"
import { TestOAuth } from "../oauth.js"

export const plugin = (endpoint: URL, options: { readonly noRefresh?: boolean } = {}) => ({
  package: fileURLToPath(new URL("../oauth.ts", import.meta.url)),
  options: { endpoint: endpoint.href, ...options },
})

const account = (actor: UserActor) => new AccountActor({ type: "account", properties: { accountID: actor.properties.accountID } })

const authorize = Effect.fn("ToolAuth.authorize")(function* (
  app: TestApp.Interface, issuer: Effect.Success<ReturnType<typeof TestOAuth.make>>,
  client: ByMorningClient, actor: UserActor, label: string,
) {
  const bus = yield* app.workspace({ account: account(actor) }, Bus.Service)
  const updates = yield* bus.subscribe([Integration.Event.ConnectionUpdated])
  const attempt = yield* Effect.tryPromise(() => client.integration.oauth.connect({
    integrationID: TestOAuth.integrationID, methodID: TestOAuth.methodID, scope: "member", label,
  })).pipe(Effect.mapError((cause) => new TestApp.RequestError({ message: `${label} Integration OAuth start failed`, cause })))
  issuer.bind(attempt.url, label)
  yield* Effect.tryPromise(async () => {
    const authorization = await fetch(attempt.url, { redirect: "manual" })
    assert.equal(authorization.status, 302)
    const location = authorization.headers.get("location")
    assert.ok(location)
    const callback = new URL(location)
    // The configured web origin owns the callback URI; this browserless test reaches
    // the same actual API handler directly, as the local web proxy does.
    const complete = await fetch(new URL(callback.pathname + callback.search, app.origin), { redirect: "manual" })
    assert.equal(complete.status, 303)
    assert.equal(new URL(complete.headers.get("location")!).pathname, "/auth/integration/callback/complete")
  })
  yield* updates.pipe(Stream.filter((event) => event.data.integrationID === TestOAuth.integrationID), Stream.take(1), Stream.runDrain)
  const status = yield* Effect.tryPromise(() => client.integration.oauth.status({
    integrationID: TestOAuth.integrationID, attemptID: attempt.attemptID,
  }))
  assert.equal(status.status, "complete")
  const info = yield* Effect.tryPromise(() => client.integration.get({ integrationID: TestOAuth.integrationID }))
  assert.ok(info)
  assert.equal(info.connectionPolicy, "member-only")
  assert.equal(info.connections.length, 1)
  const connection = info.connections[0]
  assert.ok(connection?.type === "credential")
  assert.equal(connection.scope, "member")
  assert.equal(connection.label, label)
  return connection
})

export const make = Effect.fn("ToolAuth.make")(function* (
  app: TestApp.Interface, issuer: Effect.Success<ReturnType<typeof TestOAuth.make>>,
) {
  const owner = yield* app.login()
  yield* Effect.tryPromise(() => app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" }))
  const client = app.clientFor()
  const member = yield* app.login(client, {
    subject: Auth.Sub.make("test-member"), email: Auth.Email.make("member@bymorning.ai"),
  })
  assert.notEqual(owner.properties.accountID, member.properties.accountID)
  assert.notEqual(owner.properties.userID, member.properties.userID)
  assert.equal(owner.properties.workspaceID, member.properties.workspaceID)
  const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
  yield* Effect.tryPromise(() => app.client["api.config"].update({ ...config, permissions: [
    { action: "execute", resource: "*", effect: "allow" },
    { action: "fixture.member", resource: "*", effect: "allow" },
  ] }))
  const ownerConnection = yield* authorize(app, issuer, app.client, owner, "owner")
  const memberConnection = yield* authorize(app, issuer, client, member, "member")
  assert.notEqual(ownerConnection.id, memberConnection.id)
  const ownerInfo = yield* Effect.tryPromise(() => app.client.integration.get({ integrationID: TestOAuth.integrationID }))
  assert.deepEqual(ownerInfo?.connections.map((connection) => "id" in connection ? connection.id : undefined), [ownerConnection.id])
  const ownerMCP = yield* TestMCP.connect(app, owner.properties.workspaceID)
  const memberMCP = yield* TestMCP.connect({ origin: app.origin, client }, member.properties.workspaceID)
  return { owner, member, client, ownerConnection, memberConnection, ownerMCP, memberMCP }
})

export const call = Effect.fn("ToolAuth.call")(function* (
  mcp: Effect.Success<ReturnType<typeof TestMCP.connect>>, mode: "direct" | "code",
) {
  return yield* Effect.tryPromise(async () => await mcp.callTool(mode === "direct"
    ? { name: "member_http", arguments: {} }
    : { name: "execute", arguments: { description: "Call member code", code: "return await tools.member_code({})" } }) as {
      isError?: boolean; content: unknown;
      structuredContent?: { error?: boolean; toolCalls?: Array<{ tool: string; status: string }> };
    })
})

/** Expire only a real exchanged value through the public persistence authority.
 * No token is fabricated and no clock/sleep or SQL mutation is needed. */
export const expire = Effect.fn("ToolAuth.expire")(function* (
  app: TestApp.Interface, actor: UserActor, id: Credential.ID,
) {
  yield* app.process(Credential.Service.use((credentials) => Effect.gen(function* () {
    const current = yield* credentials.get(id)
    assert.ok(current?.value.type === "oauth")
    yield* credentials.update(id, { value: { ...current.value, expires: 1 } })
  })).pipe(Effect.provide(Credential.layer({ workspaceID: actor.properties.workspaceID, userID: actor.properties.userID }))))
})

/** Read the selected OAuth expiry through Credential's public authority. */
export const expiry = Effect.fn("ToolAuth.expiry")(function* (
  app: TestApp.Interface, actor: UserActor, id: Credential.ID,
) {
  return yield* app.process(Credential.Service.use((credentials) => Effect.gen(function* () {
    const current = yield* credentials.get(id)
    assert.ok(current?.value.type === "oauth")
    return current.value.expires
  })).pipe(Effect.provide(Credential.layer({ workspaceID: actor.properties.workspaceID, userID: actor.properties.userID }))))
})

/** Seed a legacy shared Connection with already-authorized material through the
 * public Credential service. A member-only Integration must never select it. */
export const shared = Effect.fn("ToolAuth.shared")(function* (
  app: TestApp.Interface, actor: UserActor, id: Credential.ID,
) {
  yield* app.process(Credential.Service.use((credentials) => Effect.gen(function* () {
    const current = yield* credentials.get(id)
    assert.ok(current?.value.type === "oauth")
    yield* credentials.create({ integrationID: TestOAuth.integrationID, scope: "workspace", label: "Legacy shared", value: current.value })
  })).pipe(Effect.provide(Credential.layer({ workspaceID: actor.properties.workspaceID, userID: actor.properties.userID }))))
})
