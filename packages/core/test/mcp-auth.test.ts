import { describe, expect, it } from "@effect/vitest"
import { offlineAccount } from "./fixtures/offline-account.js"
import { Integration as IntegrationSchema } from "@bymorning/schema/integration"
import { Account } from "@bymorning/schema/account"
import { Workspace } from "@bymorning/schema/workspace"
import { Event as McpEvent } from "@bymorning/schema/outbound-mcp"
import { Cause, Context, Deferred, Effect, Exit, Fiber, FiberSet, Layer, Logger, Scope, Stream } from "effect"
import { NodeCrypto } from "@effect/platform-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import * as Bus from "../src/bus.js"
import * as Credential from "../src/credential.js"
import * as Integration from "../src/integration.js"
import { IntegrationOAuthCallback } from "../src/integration-oauth-callback.js"
import * as Mcp from "../src/mcp.js"
import * as McpOAuth from "../src/mcp/oauth.js"
import * as AppProcess from "../src/util/process.js"
import { server } from "./mcp/auth.js"
import { auth } from "@modelcontextprotocol/client"
import { request } from "../src/mcp/http.js"

const client: Credential.Client = {
  configured: () => Effect.succeed([]), resolve: () => Effect.succeed({}), put: () => Effect.void, remove: () => Effect.succeed(false),
}

const credentialLayer = Layer.effect(Credential.Service, Effect.gen(function* () {
  const values = new Map<Credential.ID, Credential.Info>()
  const visible = () => [...values.values()]
  return Credential.Service.of({
    client,
    all: () => Effect.sync(visible),
    list: (integrationID, scope) => Effect.sync(() => visible().filter((value) => value.integrationID === integrationID && (scope === undefined || value.scope === scope))),
    get: (id, scope) => Effect.sync(() => { const value = values.get(id); return value !== undefined && (scope === undefined || value.scope === scope) ? value : undefined }),
    create: (input) => Effect.sync(() => {
      const value = new Credential.Info({ id: Credential.ID.create(), integrationID: input.integrationID, label: input.label ?? "default", scope: input.scope ?? "workspace", active: true, value: input.value })
      values.set(value.id, value); return value
    }),
    activate: () => Effect.void, update: () => Effect.void,
    updateOAuth: (id, expected, value) => Effect.sync(() => {
      const current = values.get(id)
      if (current?.value.type !== "oauth" || current.value.access !== expected.access || current.value.refresh !== expected.refresh) return false
      values.set(id, new Credential.Info({ ...current, value })); return true
    }),
    removeOAuth: (id, expected) => Effect.sync(() => {
      const current = values.get(id)
      if (current?.value.type !== "oauth" || current.value.access !== expected.access || current.value.refresh !== expected.refresh) return false
      values.delete(id); return true
    }),
    refreshOAuth: () => Effect.die("unused"), remove: (id) => Effect.sync(() => { values.delete(id) }),
    discard: () => Effect.void,
    connected: () => Effect.succeed([]),
  })
}))

const busLayer = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)

const layer = Integration.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(credentialLayer, busLayer, LayerNode.compile(AppProcess.node))),
)
const owner = { accountID: Account.ID.make("acc_mcp_auth"), workspaceID: Workspace.ID.make("wrk_mcp_auth"), pluginID: "test" }

describe("Mcp OAuth", () => {
  it.effect("reconnects automatically after a real Integration OAuth callback and revokes on the connection event", () =>
    Effect.gen(function* () {
      const fixture = yield* server({ requireToken: "authorized", authorize: true })
      const unrelated = yield* server()
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const bus = yield* Bus.Service
      const callbacks = yield* IntegrationOAuthCallback.Service
      const mcp = yield* Mcp.make({ account: offlineAccount(), integration, credential: credentials, oauthCallback: callbacks, owner, bus })
      yield* mcp.transform((editor) => {
        editor.set("personal", { type: "remote", url: fixture.url })
        editor.set("unrelated", { type: "remote", url: unrelated.url, oauth: false })
      })
      const unrelatedRequests = unrelated.authorizations.length
      const integrationID = IntegrationSchema.ID.make(Mcp.identity("personal", fixture.url))
      expect((yield* mcp.servers()).find((server) => server.name === "personal")?.status).toBe("needs_auth")
      expect(fixture.registrations).toBe(0)
      const changed = yield* (yield* bus.subscribe(McpEvent.ToolsChanged)).pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }))
      const attempt = yield* integration.oauth.connect({ integrationID, methodID: IntegrationSchema.MethodID.make("oauth") })
      const state = new URL(attempt.url).searchParams.get("state") ?? ""
      expect(yield* callbacks.deliver({ state, code: "code" })).toBe(true)
      yield* Fiber.join(changed)
      expect((yield* mcp.servers()).find((server) => server.name === "personal")?.status).toBe("connected")
      expect(fixture.registrations).toBe(1)
      expect(yield* mcp.callTool({ server: "personal", name: "authenticated" })).toMatchObject({ content: [{ type: "text", text: "ok" }] })
      expect(unrelated.authorizations.length).toBe(unrelatedRequests)

      const credential = (yield* credentials.list(integrationID, "member"))[0]
      expect(credential).toBeDefined()
      const revoked = yield* (yield* bus.subscribe(McpEvent.ToolsChanged)).pipe(Stream.runHead, Effect.forkChild({ startImmediately: true }))
      yield* integration.connection.remove(credential.id)
      yield* Fiber.join(revoked)
      expect((yield* mcp.servers()).find((server) => server.name === "personal")?.status).toBe("needs_auth")
      expect(unrelated.authorizations.length).toBe(unrelatedRequests)
    }).pipe(Effect.provide(Layer.mergeAll(layer, IntegrationOAuthCallback.layer(new URL("https://app.example"))))),
  )

  for (const operation of ["save", "invalid_grant"] as const) {
    it.effect(`preserves a winning rotation when a same-provider parallel header read interleaves with stale ${operation}`, () =>
      Effect.gen(function* () {
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const fixture = yield* server({ token: async (form) => {
          if (form.get("refresh_token") === "old-refresh") {
            started.resolve()
            await release.promise
            return operation === "save"
              ? { status: 200, body: { access_token: "stale", refresh_token: "stale-refresh", token_type: "Bearer" } }
              : { status: 400, body: { error: "invalid_grant", error_description: "unsafe-token-detail" } }
          }
          expect(form.get("refresh_token")).toBe("winner-refresh")
          return { status: 200, body: { access_token: "winner", refresh_token: "winner-refresh", token_type: "Bearer" } }
        } })
        const id = Credential.ID.create()
        const integrationID = IntegrationSchema.ID.make("mcp-race")
        const initial = Credential.OAuth.make({ type: "oauth", methodID: IntegrationSchema.MethodID.make("oauth"), access: "old", refresh: "old-refresh", expires: 0 })
        const winner = Credential.OAuth.make({ ...initial, access: "winner", refresh: "winner-refresh" })
        let current: Credential.OAuth | undefined = initial
        const compared: string[] = []
        const credentials = Credential.Service.of({
          ...yield* Credential.Service,
          get: () => Effect.sync(() => current === undefined ? undefined : new Credential.Info({ id, integrationID, scope: "member", label: "race", value: current })),
          updateOAuth: (_id, expected, value) => Effect.sync(() => {
            compared.push(`save:${expected.access}`)
            if (current?.access !== expected.access || current.refresh !== expected.refresh) return false
            current = value
            return true
          }),
          removeOAuth: (_id, expected) => Effect.sync(() => {
            compared.push(`remove:${expected.access}`)
            if (current?.access !== expected.access || current.refresh !== expected.refresh) return false
            current = undefined
            return true
          }),
        })
        const provider = McpOAuth.makeProvider({ type: "remote", url: fixture.url }, "https://invalid", "race", initial, {}, { id, credentials }, yield* FiberSet.makeRuntimePromise())
        // The same boundary used for each SDK transport.send invocation.
        const stale = provider.request(() => auth(provider, { serverUrl: fixture.url, fetchFn: request }))
        yield* Effect.promise(() => started.promise)
        compared.length = 0
        current = winner
        expect(yield* Effect.promise(() => provider.request(async () => (await provider.tokens())?.access_token))).toBe("winner")
        release.resolve()
        yield* Effect.promise(() => stale)
        expect(compared).toEqual(operation === "save" ? ["save:old"] : ["remove:old", "save:winner"])
        expect(current).toMatchObject({ access: winner.access, refresh: winner.refresh })
      }).pipe(Effect.provide(credentialLayer)),
    )
  }

  it.effect("does not replay a mutating tool call after its HTTP 401", () =>
    Effect.gen(function* () {
      // The fixture records the call before returning 401, modelling a peer
      // whose operation completed but whose response was lost at its auth edge.
      const fixture = yield* server({
        reject: 1,
        rejectMethod: "never",
        rejectAfterCall: true,
      })
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = IntegrationSchema.ID.make(Mcp.identity("mutating", fixture.url))
      yield* credentials.create({
        integrationID,
        scope: "member",
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: IntegrationSchema.MethodID.make("oauth"),
          access: "initial",
          refresh: "initial-refresh",
          expires: 0,
        }),
      })
      const mcp = yield* Mcp.make({ account: offlineAccount(),
        integration,
        credential: credentials,
        oauthCallback: yield* IntegrationOAuthCallback.Service,
        owner,
        bus: yield* Bus.Service,
      })
      yield* mcp.transform((editor) => editor.set("mutating", { type: "remote", url: fixture.url }))
      const result = yield* mcp.callTool({ server: "mutating", name: "authenticated" }).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("Mcp.NeedsAuthError")
      expect(fixture.calls).toBe(1)
    }).pipe(Effect.provide(Layer.mergeAll(layer, IntegrationOAuthCallback.layer(new URL("https://app.example"))))),
  )

  it.effect("isolates two member graphs and never falls back to a workspace OAuth credential", () =>
    Effect.gen(function* () {
      const fixture = yield* server({ requireToken: "member-secret" })
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = IntegrationSchema.ID.make(Mcp.identity("personal", fixture.url))
      const value = Credential.OAuth.make({ type: "oauth", methodID: IntegrationSchema.MethodID.make("oauth"), access: "member-secret", refresh: "refresh", expires: 0 })
      yield* credentials.create({ integrationID, scope: "member", value })
      const callback = yield* IntegrationOAuthCallback.Service
      const first = yield* Mcp.make({ account: offlineAccount(), integration, credential: credentials, oauthCallback: callback, owner, bus: yield* Bus.Service })
      yield* first.transform((editor) => editor.set("personal", { type: "remote", url: fixture.url }))
      expect((yield* first.servers())[0]?.status).toBe("connected")
      // Drain the first graph's post-connect discovery so its own member token
      // cannot land in the recorder after it is cleared below.
      yield* first.tools()

      const other = yield* Layer.build(Layer.fresh(layer))
      const secondCredentials = Context.get(other, Credential.Service)
      // The same valid token exists only as shared setup in this member graph.
      yield* secondCredentials.create({ integrationID, scope: "workspace", value })
      fixture.requests.length = 0
      const second = yield* Mcp.make({ account: offlineAccount(),
        integration: Context.get(other, Integration.Service), credential: secondCredentials,
        oauthCallback: callback, owner: { ...owner, accountID: Account.ID.make("acc_other") }, bus: Context.get(other, Bus.Service),
      })
      yield* second.transform((editor) => editor.set("personal", { type: "remote", url: fixture.url }))
      expect((yield* second.servers())[0]?.status).toBe("needs_auth")
      expect(yield* second.tools()).toEqual([])
      // The first graph keeps its own authenticated stream open; only JSON-RPC
      // calls made after the reset belong to the second graph, and none may
      // carry the workspace-scoped token.
      expect(fixture.requests.filter((entry) => entry.method !== undefined).every((entry) => entry.authorization === "")).toBe(true)
      expect((yield* first.servers())[0]?.status).toBe("connected")
    }).pipe(Effect.provide(Layer.mergeAll(layer, IntegrationOAuthCallback.layer(new URL("https://app.example"))))),
  )

  it.effect("uses only the current member OAuth credential and preserves name and URL identity", () =>
    Effect.gen(function* () {
      const fixture = yield* server()
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const id = Mcp.identity("personal", fixture.url)
      yield* credentials.create({ integrationID: IntegrationSchema.ID.make(id), scope: "member", value: Credential.OAuth.make({ type: "oauth", methodID: IntegrationSchema.MethodID.make("oauth"), access: "member-secret", refresh: "refresh", expires: 0 }) })
      const mcp = yield* Mcp.make({ account: offlineAccount(), integration, credential: credentials, oauthCallback: yield* IntegrationOAuthCallback.Service, owner, bus: yield* Bus.Service })
      yield* mcp.transform((editor) => editor.set("personal", { type: "remote", url: fixture.url }))
      expect((yield* mcp.tools()).map((tool) => tool.name)).toEqual(["authenticated"])
      expect(fixture.authorizations).toContain("Bearer member-secret")
      expect(Mcp.identity("personal", fixture.url)).not.toBe(Mcp.identity("renamed", fixture.url))
      expect(Mcp.identity("personal", fixture.url)).not.toBe(Mcp.identity("personal", `${fixture.url}?changed`))
    }).pipe(Effect.provide(Layer.mergeAll(layer, IntegrationOAuthCallback.layer(new URL("https://app.example"))))),
  )

  it.effect("adopts a winning refresh and rejects a replaced OAuth credential without exposing either secret", () =>
    Effect.gen(function* () {
      const id = Credential.ID.create()
      const initial = Credential.OAuth.make({ type: "oauth", methodID: IntegrationSchema.MethodID.make("oauth"), access: "initial-secret", refresh: "refresh-secret", expires: 0 })
      let current: Credential.Value = initial
      const credentials = Credential.Service.of({
        ...yield* Credential.Service,
        get: () => Effect.succeed(new Credential.Info({ id, integrationID: IntegrationSchema.ID.make("mcp-test"), label: "test", scope: "member", value: current })),
        updateOAuth: (_id, expected, value) => Effect.sync(() => {
          if (current.type !== "oauth" || current.access !== expected.access || current.refresh !== expected.refresh) return false
          current = value; return true
        }),
      })
      const first = McpOAuth.makeProvider({ type: "remote", url: "https://example.test/mcp" }, "https://invalid", "first", initial, {}, { id, credentials })
      const second = McpOAuth.makeProvider({ type: "remote", url: "https://example.test/mcp" }, "https://invalid", "second", initial, {}, { id, credentials })
      yield* Effect.promise(() => Promise.all([first.saveTokens({ access_token: "first-secret", token_type: "Bearer" }), second.saveTokens({ access_token: "second-secret", token_type: "Bearer" })]))
      expect((yield* Effect.promise(() => Promise.resolve(first.tokens())))?.access_token).toBe((current as Credential.OAuth).access)
      current = Credential.Key.make({ type: "key", key: "replacement-secret" })
      const error = yield* Effect.promise(() => Promise.resolve(first.saveTokens({ access_token: "stale-secret", token_type: "Bearer" })).then(() => undefined, (cause) => cause))
      expect(error).toBeInstanceOf(Error)
      expect(JSON.stringify(error)).not.toContain("secret")
      expect((yield* Effect.promise(() => Promise.resolve(first.tokens())))?.access_token).toBeUndefined()
    }).pipe(Effect.provide(credentialLayer)),
  )

  it.effect("marks a 401 connection as needing authentication without replaying or invalidating its member token", () =>
    Effect.gen(function* () {
      const fixture = yield* server({ reject: 1 })
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = IntegrationSchema.ID.make(Mcp.identity("protected", fixture.url))
      const credential = yield* credentials.create({
        integrationID,
        scope: "member",
        value: Credential.OAuth.make({ type: "oauth", methodID: IntegrationSchema.MethodID.make("oauth"), access: "member-secret", refresh: "refresh", expires: 0 }),
      })
      const mcp = yield* Mcp.make({ account: offlineAccount(), integration, credential: credentials, oauthCallback: yield* IntegrationOAuthCallback.Service, owner, bus: yield* Bus.Service })
      yield* mcp.transform((editor) => editor.set("protected", { type: "remote", url: fixture.url }))
      expect(yield* mcp.servers()).toMatchObject([{ name: "protected", status: "needs_auth", integrationID }])
      expect(yield* credentials.get(credential.id, "member")).toBeDefined()
      fixture.requests.length = 0
      yield* mcp.connect("protected")
      expect(yield* mcp.servers()).toMatchObject([{ name: "protected", status: "connected", integrationID }])
      expect(fixture.authorizations).toContain("Bearer member-secret")
    }).pipe(Effect.provide(Layer.mergeAll(layer, IntegrationOAuthCallback.layer(new URL("https://app.example"))))),
  )

  it.effect("interrupts a pending SDK token save when its provider scope is retired", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const retired = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const parent = yield* Scope.Scope
      const providerScope = yield* Scope.fork(parent)
      yield* Scope.addFinalizer(providerScope, Deferred.succeed(retired, undefined))
      const id = Credential.ID.create()
      const initial = Credential.OAuth.make({ type: "oauth", methodID: IntegrationSchema.MethodID.make("oauth"), access: "old", refresh: "refresh", expires: 0 })
      let writes = 0
      const credentials = Credential.Service.of({
        ...yield* Credential.Service,
        updateOAuth: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.sync(() => ++writes > 0)),
          ),
      })
      const runtime = yield* FiberSet.makeRuntimePromise().pipe(Scope.provide(providerScope))
      const provider = McpOAuth.makeProvider({ type: "remote", url: "https://example.test/mcp" }, "https://invalid", "retired", initial, {}, { id, credentials }, runtime)
      const saving = provider.saveTokens({ access_token: "new", token_type: "Bearer" })
      yield* Deferred.await(started)
      yield* Scope.close(providerScope, Exit.void).pipe(Effect.forkChild)
      yield* Deferred.await(retired)
      yield* Deferred.succeed(release, undefined)
      const result = yield* Effect.promise(() => Promise.resolve(saving).then(() => "saved", () => "interrupted"))
      expect(result).toBe("interrupted")
      expect(writes).toBe(0)
    }).pipe(Effect.ensuring(Effect.void), Effect.provide(credentialLayer)),
  )

  const summaryMessages: string[] = []
  it.effect("keeps credential material out of remote-MCP failure summaries", () =>
    Effect.gen(function* () {
      const secret = "mcp-error-secret"
      summaryMessages.length = 0
      const fixture = yield* server({ reject: 2, rejectStatus: 500, rejectMessage: secret })
      const integration = yield* Integration.Service
      const credentials = yield* Credential.Service
      const mcp = yield* Mcp.make({ account: offlineAccount(), integration, credential: credentials, oauthCallback: yield* IntegrationOAuthCallback.Service, owner, bus: yield* Bus.Service })
      yield* mcp.transform((editor) => editor.set("summary", { type: "remote", url: fixture.url }))
      expect(yield* mcp.servers()).toMatchObject([{ name: "summary", status: "failed" }])
      expect(summaryMessages.join(" ")).toContain("failed to configure remote MCP server")
      expect(summaryMessages.join(" ")).not.toContain(secret)
      const probe = yield* mcp.test("summary").pipe(Effect.exit)
      expect(Exit.isFailure(probe)).toBe(true)
      if (Exit.isFailure(probe)) expect(Cause.pretty(probe.cause)).not.toContain(secret)
    }).pipe(
      Effect.provide(Layer.mergeAll(layer, IntegrationOAuthCallback.layer(new URL("https://app.example")), Logger.layer([Logger.make(({ message }) => summaryMessages.push(String(message)))]))),
    ),
  )
})
