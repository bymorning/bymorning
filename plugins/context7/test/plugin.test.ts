import { expect, it } from "@effect/vitest"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import type { Editor as MCPEditor } from "@bymorning/plugin/effect/mcp"
import type { ConfigMCP } from "@bymorning/schema/config/mcp"
import { Event } from "@bymorning/schema/event"
import { Event as IntegrationEvent } from "@bymorning/schema/integration"
import { Deferred, Effect, Exit, Fiber, PubSub, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import plugin from "../src/index.js"

type PluginEvent = Stream.Success<ReturnType<PluginContext["event"]["subscribe"]>>

const fixture = Effect.gen(function* () {
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
  let integrationName: string | undefined
  const methods: unknown[] = []

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
      return { dispose: Effect.void }
    })
  const context = {
    integration: {
      transform: (callback: (editor: {
        update(id: string, update: (integration: { name: string }) => void): void
        method: { update(input: unknown): void }
      }) => void) =>
        Effect.gen(function* () {
          callback({
            update: (_id, update) => {
              const integration = { name: "context7" }
              update(integration)
              integrationName = integration.name
            },
            method: { update: (input) => methods.push(input) },
          })
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              integrationName = undefined
              methods.length = 0
            }),
          )
          return { dispose: Effect.void }
        }),
      connection: {
        active: () =>
          Effect.gen(function* () {
            reads++
            expect(subscriptions).toBe(1)
            const result = connected ? { type: "env" as const, name: "CONTEXT7_API_KEY" } : undefined
            yield* beforeRead
            return result
          }),
        resolve: () => Effect.succeed({ type: "key" as const, key: "fixture-only" }),
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
  } as unknown as PluginContext
  const setup = plugin.effect(context).pipe(Scope.provide(scope))
  const change = (integrationID = "context7") =>
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
    integration: () => ({ name: integrationName, methods: [...methods] }),
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

it.effect("reconciles credentials through Integration events and cleans up", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    yield* test.setup
    expect(test.servers.get("context7")).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      oauth: false,
    })
    expect(test.integration()).toEqual({
      name: "Context7",
      methods: [
        { integrationID: "context7", method: { type: "key", label: "API key" } },
        { integrationID: "context7", method: { type: "env", names: ["CONTEXT7_API_KEY"] } },
      ],
    })
    expect(test.counts()).toEqual({ subscriptions: 1, registrations: 1, reads: 1 })

    const override = yield* Scope.fork(yield* Scope.Scope)
    yield* test
      .override((editor) => editor.update("context7", (server) => (server.url = "http://override.invalid/mcp")))
      .pipe(Scope.provide(override))
    test.connect()
    yield* test.change("another-integration")
    yield* test.change()
    yield* Deferred.await(test.reloading)
    yield* TestClock.adjust("500 millis")
    yield* Deferred.await(test.refreshed)
    expect(test.servers.get("context7")?.url).toBe("http://override.invalid/mcp")
    expect(test.servers.get("context7")?.headers).toHaveProperty("Authorization")
    expect(test.counts()).toEqual({ subscriptions: 1, registrations: 1, reads: 2 })

    yield* Scope.close(test.scope, Exit.void)
    expect(test.counts().subscriptions).toBe(0)
    expect(test.servers.has("context7")).toBe(false)
    expect(test.integration()).toEqual({ name: undefined, methods: [] })
    yield* test.change()
    expect(test.counts()).toEqual({ subscriptions: 0, registrations: 1, reads: 2 })
  }).pipe(Effect.scoped),
)

it.effect("queues connection changes during its initial credential read", () =>
  Effect.gen(function* () {
    const test = yield* fixture
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
    expect(test.servers.get("context7")?.headers).toHaveProperty("Authorization")
    expect(test.counts()).toEqual({ subscriptions: 1, registrations: 1, reads: 2 })
  }).pipe(Effect.scoped),
)
