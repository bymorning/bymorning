import { describe, expect, it } from "@effect/vitest"
import type { OpenAPI } from "@bymorning/plugin"
import { fromPromise } from "@bymorning/plugin/promise/adapter"
import type { Context as PromiseContext } from "@bymorning/plugin/promise/plugin"
import { Credential } from "@bymorning/schema/credential"
import { Event } from "@bymorning/schema/event"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Stream, Tracer } from "effect"
import { TestClock } from "effect/testing"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { inspect } from "node:util"
import { Bus } from "../src/bus.js"
import type { Integration } from "../src/integration.js"
import { Plugin } from "../src/plugin.js"
import { PluginHost } from "../src/plugin/host.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Storage } from "../src/storage.js"
import { Tool } from "../src/tool.js"

const secret = "openapi-private-marker"
const username = "openapi-private-user"
const connection = { type: "credential", id: Credential.ID.make("00000000-0000-4000-8000-000000000006"), label: "test" } as const
const forbidden = () => Effect.die("Unexpected dependency call")

// Unused host capabilities fail on invocation. The exercised host, activation,
// State batching, Tool registry, Storage and Promise adapter are real.
const unused = new Proxy(forbidden, { get: () => unused })
const unrelated = unused as unknown as PluginHost.HostServices
const bus = Bus.Service.of({
  publish: <D extends Event.Definition>(definition: D, data: Event.Data<D>) => Effect.succeed({
    id: Event.ID.make(crypto.randomUUID()), created: Date.now(), type: definition.type, data,
  } as Event.Payload<D>),
  subscribe: () => Effect.succeed(Stream.empty),
})
const storageLayer = Storage.layer({ configure: (editor) => {
  const provider = Storage.memory()
  editor.add(provider)
  editor.default.set(provider.id)
} })

const server = (handler: (request: IncomingMessage, response: ServerResponse) => void) => Effect.acquireRelease(
  Effect.promise(() => new Promise<ReturnType<typeof createServer>>((resolve) => {
    const value = createServer(handler).listen(0, "127.0.0.1", () => resolve(value))
  })),
  (value) => Effect.promise(() => new Promise<void>((resolve, reject) => {
    value.closeAllConnections()
    value.close((error) => error ? reject(error) : resolve())
  })),
).pipe(Effect.map((value) => {
  const address = value.address()
  if (address === null || typeof address === "string") throw new Error("Server did not bind")
  return `http://127.0.0.1:${address.port}`
}))

function options(origin: string, carrier: "header" | "query" | "basic" | "bearer" = "header", path = "/ping"): OpenAPI.Options {
  return {
    namespace: "safe", permissionPrefix: "safe", expectedOrigin: origin, baseURL: origin,
    authentication: { type: "integration", integrationID: "existing", schemes: {
      api: carrier === "basic" ? { type: "basic", username: "login" } : { type: carrier === "bearer" ? "bearer" : "apiKey" },
    } },
    spec: {
      openapi: "3.0.0", components: { securitySchemes: {
        api: carrier === "basic" || carrier === "bearer"
          ? { type: "http", scheme: carrier }
          : { type: "apiKey", in: carrier, name: "X-Private-Credential" },
      } },
      paths: { [path]: { get: { operationId: "ping", security: [{ api: [] }], responses: {
        "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
      } } } },
    },
  }
}

const fixture = Effect.gen(function* () {
  const tool = yield* Tool.make
  const storage = yield* Storage.Service
  const hooks = yield* PluginHooks.Service
  const http = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
  const reads = { active: 0, resolve: 0 }
  let key = secret
  const integration: Integration.Interface = { ...unrelated.integration, connection: {
    active: () => Effect.sync(() => { reads.active++; return connection }),
    resolve: () => Effect.sync(() => { reads.resolve++; return { type: "key" as const, key, configuration: { login: username } } }),
    key: forbidden, awsSigV4: forbidden, values: forbidden, activate: forbidden, update: forbidden, remove: forbidden,
  } }
  const services: PluginHost.HostServices = {
    app: { name: "ByMorning", version: "test", channel: "test" },
    agent: unrelated.agent, aisdk: unrelated.aisdk, catalog: unrelated.catalog, command: unrelated.command,
    instruction: unrelated.instruction, mcp: unrelated.mcp, plugin: unrelated.plugin,
    reference: unrelated.reference, runtime: unrelated.runtime, skill: unrelated.skill, websearch: unrelated.websearch,
    workspaceID: Workspace.ID.make("wrk_openapi_host"), storage, tool, integration, http, bus, shellHooks: hooks,
  }
  const plugins = Context.get(yield* Layer.build(Plugin.layer(services).pipe(Layer.provide(Layer.succeed(Bus.Service, bus)))), Plugin.Service)
  const entries = () => Effect.gen(function* () {
    let result: ReturnType<Tool.Editor["list"]> = []
    const observation = yield* tool.transform((editor) => { result = editor.list() })
    yield* observation.dispose
    return result
  })
  const invoke = () => Effect.gen(function* () {
    const operation = (yield* entries()).find((entry) => entry.name === "ping")
    if (operation === undefined) return yield* Effect.die("Missing operation")
    return yield* operation.execute({}, {
      caller: { type: "gateway", userID: User.ID.make("usr_openapi_host") }, id: Tool.CallID.make("host-call"),
      permission: () => Effect.void, elicit: () => Effect.die("unused"), progress: () => Effect.void,
    })
  })
  const activate = (setup: (context: PromiseContext) => Promise<void>) => plugins.activate([{
    ...fromPromise({ id: "openapi.host", setup }), revision: crypto.randomUUID(),
    source: { type: "package", package: "test-openapi" },
  }])
  return { tool, entries, invoke, activate, plugins, reads, rotate: (value: string) => { key = value },
    host: PluginHost.make(services, "openapi.host") }
})
const provide = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | PluginHooks.Service | Storage.Service>) =>
  effect.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(storageLayer, PluginHooks.layer)))

function observe(base: Tracer.Tracer) {
  const recorded: string[] = []
  const spans: Tracer.Span[] = []
  const tracer = Tracer.make({ span(input) {
    recorded.push(inspect({ name: input.name, kind: input.kind, links: input.links }, { depth: 10 }))
    const span = base.span(input)
    spans.push(span)
    const attribute = span.attribute.bind(span)
    const event = span.event.bind(span)
    const end = span.end.bind(span)
    // Observe each write, not only the eventual attribute map: overwriting a
    // leaked attribute later must not make the regression pass.
    span.attribute = (key, value) => {
      recorded.push(inspect({ key, value }, { depth: 10 }))
      attribute(key, value)
    }
    span.event = (name, time, attributes) => {
      recorded.push(inspect({ name, attributes }, { depth: 10 }))
      event(name, time, attributes)
    }
    span.end = (time, exit) => {
      if (Exit.isFailure(exit)) recorded.push(Cause.pretty(exit.cause), inspect(exit.cause, { depth: 10 }))
      end(time, exit)
    }
    return span
  } })
  return { tracer, recorded, spans }
}

describe("OpenAPI production host", () => {
  it.effect("rejects same-origin and cross-origin redirects through Promise activation before forwarding credentials", () => provide(Effect.gen(function* () {
    const test = yield* fixture
    let escaped = 0
    const destination = yield* server((_request, response) => { escaped++; response.end("{}"); })
    let direct = 0
    const origin = yield* server((request, response) => {
      if (request.url === "/destination") { escaped++; response.end("{}"); return }
      direct++
      response.writeHead(302, { location: request.url === "/same" ? "/destination" : `${destination}/destination` })
      response.end()
    })
    for (const path of ["/same", "/cross"]) {
      yield* test.activate(async (context) => { await context.tool.openapi(options(origin, "header", path)) })
      const result = yield* test.invoke().pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      expect(escaped).toBe(0)
    }
    expect(direct).toBe(2)
  })))

  for (const carrier of ["query", "header", "basic", "bearer"] as const) {
    it.effect(`keeps ${carrier} credentials out of transport spans, events and failures`, () => provide(Effect.gen(function* () {
      const test = yield* fixture
      const observed = observe(yield* Tracer.Tracer)
      let requests = 0
      const validated: boolean[] = []
      const origin = yield* server((request, response) => {
        const value = carrier === "query" ? new URL(request.url ?? "/", "http://localhost").searchParams.get("X-Private-Credential")
          : request.headers[carrier === "header" ? "x-private-credential" : "authorization"]
        validated.push(value === (carrier === "basic" ? `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`
          : carrier === "bearer" ? `Bearer ${secret}` : secret))
        requests++
        response.writeHead(requests === 1 ? 200 : 500, { "content-type": "application/json", "x-private-response": secret })
        response.end(requests === 1 ? "{}" : JSON.stringify({ message: secret }))
      })
      yield* test.activate(async (context) => { await context.tool.openapi(options(origin, carrier)) })
      yield* Effect.gen(function* () {
        yield* test.invoke()
        const failure = yield* test.invoke().pipe(Effect.flip)
        expect(failure.message).toBe("safe request failed")
        yield* Effect.currentSpan.pipe(Effect.tap((span) => Effect.sync(() => span.event("safe-event", 0n, { useful: "retained" }))),
          Effect.withSpan("unrelated-observation", { attributes: { useful: "retained" } }))
      }).pipe(Effect.provideService(Tracer.Tracer, observed.tracer))
      expect(requests).toBe(2)
      expect(validated).toEqual([true, true])
      const recorded = observed.recorded.join("\n")
      expect(recorded.includes(secret)).toBe(false)
      expect(recorded.includes(username)).toBe(false)
      expect(recorded.includes(Buffer.from(`${username}:${secret}`).toString("base64"))).toBe(false)
      expect(recorded).toContain("Tool.OpenAPI.request")
      expect(recorded).toContain("unrelated-observation")
      expect(recorded).toContain("safe-event")
      expect(recorded).toContain("retained")
    })))
  }

  it.effect("resolves and transmits rotated credentials on every invocation, never during setup", () => provide(Effect.gen(function* () {
    const test = yield* fixture
    const validated: boolean[] = []
    const origin = yield* server((request, response) => {
      validated.push(request.headers["x-private-credential"] === (validated.length === 0 ? secret : `${secret}-rotated`))
      response.setHeader("content-type", "application/json"); response.end("{}")
    })
    yield* test.activate(async (context) => { await context.tool.openapi(options(origin)) })
    expect(test.reads).toEqual({ active: 0, resolve: 0 })
    yield* test.invoke()
    test.rotate(`${secret}-rotated`)
    yield* test.invoke()
    expect(test.reads).toEqual({ active: 2, resolve: 2 })
    expect(validated).toEqual([true, true])
  })))

  for (const stage of ["headers", "body"] as const) {
    it.effect(`aborts the actual fetch signal and socket at 30 seconds while waiting for ${stage}`, () => provide(Effect.gen(function* () {
      const test = yield* fixture
      const received = yield* Deferred.make<void>()
      const headers = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<boolean>()
      const origin = yield* server((request, response) => {
        response.once("close", () => Deferred.doneUnsafe(closed, Effect.succeed(request.socket.destroyed && !response.writableEnded)))
        Deferred.doneUnsafe(received, Effect.void)
        if (stage === "body") {
          response.writeHead(200, { "content-type": "application/json" })
          response.write("{")
        }
      })
      let signal: AbortSignal | null | undefined
      const transport: typeof globalThis.fetch = async (input, init) => {
        signal = init?.signal
        const response = await globalThis.fetch(input, init)
        Deferred.doneUnsafe(headers, Effect.void)
        return response
      }
      // Use the actual Promise bridge and host constructor; the injected fetch
      // only observes signals/headers and forwards unchanged to the real socket.
      yield* fromPromise({ id: "pending", async setup(context) {
        await context.tool.openapi(options(origin))
      } }).effect(test.host).pipe(Effect.provideService(FetchHttpClient.Fetch, transport))
      const fiber = yield* test.invoke().pipe(Effect.forkChild)
      yield* Deferred.await(stage === "headers" ? received : headers)
      expect(signal).toBeDefined()
      yield* TestClock.adjust("29 seconds")
      expect(signal?.aborted).toBe(false)
      expect(yield* Deferred.isDone(closed)).toBe(false)
      yield* TestClock.adjust("1 second")
      const failure = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(failure.message).toBe("safe request failed")
      expect(signal?.aborted).toBe(true)
      expect(yield* Deferred.await(closed)).toBe(true)
    })))
  }

  it.effect("closes an unread oversized response through the invocation resource scope", () => provide(Effect.gen(function* () {
    const test = yield* fixture
    const closed = yield* Deferred.make<boolean>()
    const origin = yield* server((request, response) => {
      response.once("close", () => Deferred.doneUnsafe(closed, Effect.succeed(request.socket.destroyed && !response.writableEnded)))
      response.writeHead(200, { "content-type": "application/json", "content-length": String(50 * 1024 * 1024 + 1) })
      response.flushHeaders()
    })
    let signal: AbortSignal | null | undefined
    const transport: typeof globalThis.fetch = (input, init) => {
      signal = init?.signal
      return globalThis.fetch(input, init)
    }
    yield* fromPromise({ id: "oversized", async setup(context) {
      await context.tool.openapi(options(origin))
    } }).effect(test.host).pipe(Effect.provideService(FetchHttpClient.Fetch, transport))
    const failure = yield* test.invoke().pipe(Effect.flip)
    expect(failure.message).toBe("safe request failed")
    expect(signal?.aborted).toBe(true)
    expect(yield* Deferred.await(closed)).toBe(true)
  })))

  it.effect("preserves interruption and closes an in-flight socket on caller cancellation", () => provide(Effect.gen(function* () {
    const test = yield* fixture
    const received = yield* Deferred.make<void>()
    const closed = yield* Deferred.make<void>()
    const origin = yield* server((_request, response) => {
      response.once("close", () => Deferred.doneUnsafe(closed, Effect.void))
      Deferred.doneUnsafe(received, Effect.void)
    })
    yield* test.activate(async (context) => { await context.tool.openapi(options(origin)) })
    const fiber = yield* test.invoke().pipe(Effect.forkChild)
    yield* Deferred.await(received)
    yield* Fiber.interrupt(fiber)
    const result = yield* Fiber.await(fiber)
    expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true)
    yield* Deferred.await(closed)
  })))

  it.effect("pins transport policy against invocation RequestInit and keeps ordinary HTTP tracing enabled", () => provide(Effect.gen(function* () {
    const test = yield* fixture
    let escaped = 0
    let injected = false
    const destination = yield* server((_request, response) => { escaped++; response.end("{}"); })
    const origin = yield* server((request, response) => {
      injected ||= request.headers["x-unrelated-secret"] !== undefined
      response.writeHead(302, { location: destination }); response.end()
    })
    yield* test.activate(async (context) => { await context.tool.openapi(options(origin)) })
    const result = yield* test.invoke().pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "follow", headers: { "x-unrelated-secret": secret } }),
      Effect.exit,
    )
    expect(Exit.isFailure(result)).toBe(true)
    expect(escaped).toBe(0)
    expect(injected).toBe(false)
    const observed: Tracer.Span[] = []
    const base = yield* Tracer.Tracer
    const tracer = Tracer.make({ span(input) { const span = base.span(input); observed.push(span); return span } })
    const normal = yield* server((_request, response) => { response.end("ok") })
    yield* HttpClient.HttpClient.use((http) => http.get(normal).pipe(Effect.flatMap((response) => response.text))).pipe(
      Effect.provide(FetchHttpClient.layer), Effect.provideService(Tracer.Tracer, tracer),
    )
    expect(observed.some((span) => span.attributes.get("url.full") === `${normal}/`)).toBe(true)
  })))

  it.effect("propagates typed Promise setup rejection and rolls back earlier registrations", () => provide(Effect.gen(function* () {
    const test = yield* fixture
    let rejected = false
    yield* test.activate(async (context) => {
      await context.tool.openapi(options("https://api.example"))
      try {
        await context.tool.openapi({ ...options("https://api.example"), expectedOrigin: "invalid" })
      } catch (error) {
        expect(error).toMatchObject({ _tag: "Error", message: "Invalid OpenAPI expected origin" })
        rejected = true
        throw error
      }
    })
    expect(rejected).toBe(true)
    expect(yield* test.entries()).toEqual([])
    expect((yield* test.plugins.list())[0]).toMatchObject({ status: "failed" })
  })))

  it.effect("disposes Promise registrations idempotently and removes contributions on activation closure", () => provide(Effect.gen(function* () {
    const test = yield* fixture
    yield* test.activate(async (context) => {
      const registration = await context.tool.openapi(options("https://api.example"))
      await registration.dispose()
      await registration.dispose()
    })
    expect(yield* test.entries()).toEqual([])
    yield* test.activate(async (context) => { await context.tool.openapi(options("https://api.example")) })
    expect(yield* test.entries()).toHaveLength(1)
    yield* test.plugins.activate([])
    expect(yield* test.entries()).toEqual([])
    expect((yield* test.tool.snapshot()).codeModeCatalog?.tools ?? []).toEqual([])
  })))
})
