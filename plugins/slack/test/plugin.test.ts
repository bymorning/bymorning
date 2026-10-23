import { describe, expect, it } from "@effect/vitest"
import { Integration } from "@bymorning/plugin/effect"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import type { Editor as MCPEditor } from "@bymorning/plugin/effect/mcp"
import type {
  IntegrationEditor,
  IntegrationMethodRegistration,
  IntegrationOAuthCallbackResponse,
} from "@bymorning/plugin/effect/integration"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { Event } from "@bymorning/schema/event"
import { Event as IntegrationEvent } from "@bymorning/schema/integration"
import { Deferred, Effect, Exit, Fiber, Option, PubSub, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { register } from "../src/plugin.js"
import { slack } from "../src/slack.js"

type PluginEvent = Stream.Success<ReturnType<PluginContext["event"]["subscribe"]>>

const dispose = Effect.void

function oauthHttp(respond: (request: { readonly url: string; readonly body: string }) => Response) {
  const requests: Array<{ readonly url: string; readonly body: string }> = []
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = HttpClientRequest.toUrl(request).pipe(Option.getOrThrow)
      const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
      const recorded = { url: url.href, body }
      requests.push(recorded)
      return HttpClientResponse.fromWeb(request, respond(recorded))
    }),
  )
  return { http, requests }
}

const fixture = (
  http: HttpClient.HttpClient = HttpClient.make(() => Effect.die("OAuth HTTP is unused")),
  callback: Effect.Effect<IntegrationOAuthCallbackResponse> = Effect.never,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Scope.Scope)
    const events = yield* PubSub.unbounded<PluginEvent>()
    const refreshed = yield* Deferred.make<void>()
    const reloading = yield* Deferred.make<void>()
    const servers = new Map<string, ConfigMCP.Remote>()
    const transforms: Array<(editor: MCPEditor) => void> = []
    let subscriptions = 0
    let registrations = 0
    let reads = 0
    let connected = false
    let beforeRead = Effect.void
    let integration: NonNullable<ReturnType<IntegrationEditor["get"]>> | undefined
    let method: IntegrationMethodRegistration | undefined

    const editor: MCPEditor = {
      list: () => [...servers] as ReturnType<MCPEditor["list"]>,
      get: (name) => servers.get(name),
      set: (name, server) => servers.set(name, server),
      update: (name, update) => {
        const server = servers.get(name)
        if (server !== undefined) update(server)
      },
      remove: (name) => {
        servers.delete(name)
      },
    }
    const replay = Effect.sync(() => {
      servers.clear()
      for (const transform of transforms) transform(editor)
    })
    const transform = (callback: (editor: MCPEditor) => void) =>
      Effect.gen(function* () {
        transforms.push(callback)
        yield* replay
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => transforms.splice(transforms.indexOf(callback), 1)).pipe(Effect.andThen(replay)),
        )
        return { dispose }
      })
    const integrationEditor = {
      list: () => (integration === undefined ? [] : [integration]),
      get: (id) => (integration?.id === id ? integration : undefined),
      update: (id, update) => {
        integration = { id, name: id }
        update(integration)
      },
      remove: () => {
        integration = undefined
        method = undefined
      },
      method: {
        list: () => [],
        update: (value) => {
          method = value
        },
        remove: () => {
          method = undefined
        },
      },
    } satisfies IntegrationEditor
    const context = {
      integration: {
        transform: (callback: (editor: IntegrationEditor) => void) =>
          Effect.gen(function* () {
            callback(integrationEditor)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                integration = undefined
                method = undefined
              }),
            )
            return { dispose }
          }),
        connection: {
          active: () =>
            Effect.gen(function* () {
              reads++
              expect(subscriptions).toBe(1)
              const result = connected ? { type: "credential" as const, id: "conn_slack", label: "Slack" } : undefined
              yield* beforeRead
              return result
            }),
          resolve: () =>
            Effect.succeed({
              type: "oauth" as const,
              methodID: Integration.MethodID.make(slack.methodID),
              access: "fixture-only",
              refresh: "",
              expires: 0,
            }),
        },
        oauth: {
          callback: {
            register: () =>
              Effect.succeed({
                state: "host-state",
                callbackURI: "https://app.example/auth/integration/callback",
                expiresAt: 123,
                wait: callback,
              }),
          },
        },
      },
      event: {
        subscribe: () =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(events)
              subscriptions++
              yield* Effect.addFinalizer(() => Effect.sync(() => subscriptions--))
              return Stream.fromSubscription(subscription)
            }),
          ),
      },
      mcp: {
        transform: (callback: (editor: MCPEditor) => void) =>
          Effect.gen(function* () {
            registrations++
            return yield* transform(callback)
          }),
        reload: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(reloading, undefined)
            yield* replay
            yield* Deferred.succeed(refreshed, undefined)
          }),
      },
    } as Parameters<typeof register>[0]
    const setup = register(context, http).pipe(Scope.provide(scope))
    const change = (integrationID: string = slack.integrationID) =>
      PubSub.publish(events, {
        id: Event.ID.make(crypto.randomUUID()),
        type: IntegrationEvent.ConnectionUpdated.type,
        created: Date.now(),
        data: { integrationID },
      } as unknown as PluginEvent)
    return {
      setup,
      change,
      servers,
      scope,
      reloading,
      refreshed,
      method: () => method,
      integration: () => integration,
      override: transform,
      connect: () => {
        connected = true
      },
      beforeRead: (effect: Effect.Effect<void>) => {
        beforeRead = effect
      },
      counts: () => ({ subscriptions, registrations, reads }),
    }
  })

describe("Slack package plugin", () => {
  it.effect("registers the member OAuth Integration and remote MCP server", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.setup
      expect(test.integration()).toEqual({
        id: slack.integrationID,
        name: "Slack",
        connectionPolicy: "member-only",
      })
      expect(test.method()?.method).toMatchObject({
        id: slack.methodID,
        type: "oauth",
        label: "Slack OAuth web app",
        client: [
          { key: "client_id", title: "OAuth client ID", required: true },
          { key: "client_secret", title: "OAuth client secret", required: true, secret: true },
        ],
      })
      expect(test.servers.get(slack.mcpName)).toEqual({
        type: "remote",
        url: slack.url,
        oauth: false,
      })
      expect(test.counts()).toEqual({ subscriptions: 1, registrations: 1, reads: 1 })
    }).pipe(Effect.scoped),
  )

  it.effect("uses current OAuth client configuration without retaining its secrets", () =>
    Effect.gen(function* () {
      let tokenRequests = 0
      const { http, requests } = oauthHttp(() => {
        tokenRequests++
        if (tokenRequests === 3) return new Response("sensitive-provider-body", { status: 500 })
        return Response.json(
          tokenRequests === 1
            ? {
                ok: true,
                authed_user: { id: "U123", access_token: "access-1" },
                refresh_token: "refresh-1",
                expires_in: 3600,
                team: { id: "T123", name: "Acme" },
              }
            : { ok: true, access_token: "access-2", expires_in: 3600 },
        )
      })
      const test = yield* fixture(http, Effect.succeed({ code: "authorization-code" }))
      yield* test.setup
      const method = test.method()
      if (method === undefined || !("authorize" in method) || method.refresh === undefined) {
        return yield* Effect.die("OAuth method missing")
      }

      const authorization = yield* method.authorize(
        {},
        { client_id: "current-client", client_secret: "current-secret" },
      )
      if (authorization.mode !== "auto") return yield* Effect.die("Automatic callback missing")
      const url = new URL(authorization.url)
      const credential = yield* authorization.callback
      const refreshed = yield* method.refresh(
        {
          ...credential,
          metadata: {
            user: "U123",
            team: "Acme",
            clientID: "legacy-client",
            clientSecret: "legacy-secret",
            unrelated: "remove-me",
          },
        },
        { client_id: "replacement-client", client_secret: "replacement-secret" },
      )

      expect(url.origin + url.pathname).toBe(slack.authorizationURL)
      expect(url.searchParams.get("state")).toBe("host-state")
      expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/auth/integration/callback")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("scope")?.split(",")).toEqual([...slack.authorizationScopes])
      expect(authorization.url).not.toContain("current-secret")
      expect(credential.access).toBe("access-1")
      expect(credential.metadata).toEqual({ user: "U123", team: "Acme" })
      expect(method.label?.(credential)).toBe("Acme")
      expect(refreshed).toMatchObject({ access: "access-2", refresh: "refresh-1" })
      expect(refreshed.metadata).toEqual({ user: "U123", team: "Acme" })
      expect(requests).toHaveLength(2)
      expect(requests[0]?.url).toBe(slack.tokenURL)
      expect(requests[0]?.body).toContain("client_secret=current-secret")
      expect(requests[1]?.body).toContain("client_secret=replacement-secret")
      expect(
        JSON.stringify({ authorization, credential: credential.metadata, refreshed: refreshed.metadata }),
      ).not.toMatch(/current-secret|replacement-secret|access-1|access-2|refresh-1/)
      const missing = yield* method.authorize({}, {}).pipe(Effect.flip)
      expect(JSON.stringify(missing)).not.toMatch(/client_id|client_secret/)
      const failed = yield* method
        .refresh(refreshed, { client_id: "replacement-client", client_secret: "replacement-secret" })
        .pipe(Effect.flip)
      expect(JSON.stringify(failed)).not.toMatch(
        /client_secret|current-secret|replacement-secret|access-1|access-2|refresh-1|sensitive-provider-body/,
      )
    }).pipe(Effect.scoped),
  )

  it.effect("reconciles credentials through Integration events and cleans up", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.setup
      expect(test.servers.get(slack.mcpName)?.headers).toBeUndefined()

      const override = yield* Scope.fork(yield* Scope.Scope)
      yield* test
        .override((editor) => editor.update(slack.mcpName, (server) => (server.url = "http://override.invalid/mcp")))
        .pipe(Scope.provide(override))
      test.connect()
      yield* test.change("another-integration")
      yield* test.change()
      yield* Deferred.await(test.reloading)
      yield* TestClock.adjust("500 millis")
      yield* Deferred.await(test.refreshed)
      expect(test.servers.get(slack.mcpName)?.url).toBe("http://override.invalid/mcp")
      expect(test.servers.get(slack.mcpName)?.headers).toHaveProperty("Authorization")
      expect(test.counts()).toEqual({ subscriptions: 1, registrations: 1, reads: 2 })

      yield* Scope.close(test.scope, Exit.void)
      expect(test.counts().subscriptions).toBe(0)
      expect(test.servers.has(slack.mcpName)).toBe(false)
      expect(test.integration()).toEqual(undefined)
      yield* test.change()
      expect(test.counts()).toEqual({ subscriptions: 0, registrations: 1, reads: 2 })
    }).pipe(Effect.scoped),
  )

  it.effect("queues connection changes during its initial credential read", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const reading = yield* Deferred.make<void>()
      const resume = yield* Deferred.make<void>()
      test.beforeRead(Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(resume))))
      const setup = yield* test.setup.pipe(Effect.forkScoped)
      yield* Deferred.await(reading)
      test.connect()
      yield* test.change()
      yield* Deferred.succeed(resume, undefined)
      yield* Fiber.join(setup)
      yield* Deferred.await(test.reloading)
      yield* TestClock.adjust("500 millis")
      yield* Deferred.await(test.refreshed)
      expect(test.servers.get(slack.mcpName)?.headers).toHaveProperty("Authorization")
      expect(test.counts()).toEqual({ subscriptions: 1, registrations: 1, reads: 2 })
    }).pipe(Effect.scoped),
  )
})
