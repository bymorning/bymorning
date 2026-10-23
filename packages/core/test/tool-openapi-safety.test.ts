import { describe, expect, it } from "@effect/vitest"
import * as OpenAPI from "@bymorning/plugin/effect/openapi"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { register } from "../src/tool/openapi.js"
import type { Tool } from "@bymorning/schema/tool"
import { Error as ToolError } from "@bymorning/schema/tool"
import type { Editor } from "../src/tool.js"

const originSpec = (path: string, operationId: string) => ({
  openapi: "3.0.0",
  info: { title: "safety", version: "1" },
  paths: {
    [path]: {
      get: {
        operationId,
        responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
  },
})

const makeServer = (handler: (request: IncomingMessage, response: ServerResponse) => void) =>
  Effect.acquireRelease(
    Effect.promise(() => new Promise<Server>((resolve) => {
      const server = createServer(handler).listen(0, "127.0.0.1", () => resolve(server))
    })),
    (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  )

const editor = (tools: Tool.Registration[]): Editor => ({
  add: (tool) => tools.push(tool), list: () => [], get: () => undefined,
  namespace: () => undefined, update: () => undefined, remove: () => undefined,
})

const context = (permission: (input: { readonly action: string }) => Effect.Effect<void, unknown> = () => Effect.void) => ({
  permission,
}) as never

const registerOne = (tools: Tool.Registration[], expectedOrigin: string, baseURL: string, http?: HttpClient.HttpClient, path = "/ping") =>
  Effect.gen(function* () {
    const transport = http ?? (yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer)))
    return yield* register({
    tool: { transform: (f) => Effect.sync(() => f(editor(tools))).pipe(Effect.as({ dispose: Effect.void })) },
    integration: { connection: { active: () => Effect.succeed(undefined), resolve: () => Effect.succeed(undefined) } } as never,
    http: transport,
    options: {
      namespace: "safe", permissionPrefix: "safe", expectedOrigin, baseURL,
      authentication: { type: "none" }, spec: originSpec(path, "ping") as never,
    },
    })
  }).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }))

describe("Tool.OpenAPI network safety", () => {
  it.effect("rejects an explicit base URL origin mismatch before registration or requests", () =>
    Effect.scoped(Effect.gen(function* () {
      let requests = 0
      const listening = yield* makeServer((_request, response) => { requests++; response.end("unexpected") })
      const address = listening.address()
      if (!address || typeof address === "string") return yield* Effect.die("server did not bind")
      const origin = `http://127.0.0.1:${address.port}`
      const tools: Tool.Registration[] = []
      const failure = yield* registerOne(tools, "https://api.example", origin).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(OpenAPI.Error)
      expect(tools).toEqual([])
      expect(requests).toBe(0)
    })),
  )

  it.effect("rejects same-origin and cross-origin redirects before destination requests", () =>
    Effect.scoped(Effect.gen(function* () {
      let same = 0
      let cross = 0
      const destination = yield* makeServer((_request, response) => { cross++; response.end("leaked") })
      const destinationAddress = destination.address()
      if (!destinationAddress || typeof destinationAddress === "string") return yield* Effect.die("server did not bind")
      const destinationOrigin = `http://127.0.0.1:${destinationAddress.port}`
      const source = yield* makeServer((request, response) => {
        if (request.url === "/same") { same++; response.writeHead(302, { location: "/destination" }); response.end(); return }
        response.writeHead(302, { location: `${destinationOrigin}/destination` }); response.end()
      })
      const sourceAddress = source.address()
      if (!sourceAddress || typeof sourceAddress === "string") return yield* Effect.die("server did not bind")
      const sourceOrigin = `http://127.0.0.1:${sourceAddress.port}`
      for (const path of ["/same", "/cross"]) {
        const tools: Tool.Registration[] = []
        yield* registerOne(tools, sourceOrigin, sourceOrigin, undefined, path)
        const failure = yield* tools[0]!.execute!({}, context()).pipe(Effect.flip)
        expect(failure.message).toBe("safe request failed")
      }
      expect(same).toBe(1)
      expect(cross).toBe(0)
    })),
  )

  it.effect("checks permission before making a request and redacts credentials and response bodies", () =>
    Effect.scoped(Effect.gen(function* () {
      let requests = 0
      const listening = yield* makeServer((_request, response) => {
        requests++
        response.writeHead(500, { "content-type": "text/plain" })
        response.end("server-secret-body")
      })
      const address = listening.address()
      if (!address || typeof address === "string") return yield* Effect.die("server did not bind")
      const origin = `http://127.0.0.1:${address.port}`
      const tools: Tool.Registration[] = []
      yield* registerOne(tools, origin, origin)
      const denied = yield* tools[0]!.execute!({}, context(() => Effect.fail(new ToolError({ message: "token-secret permission denied" })))).pipe(Effect.flip)
      expect(denied.message).toBe("safe request failed")
      expect(JSON.stringify(denied)).not.toContain("token-secret")
      expect(requests).toBe(0)
      const failed = yield* tools[0]!.execute!({}, context()).pipe(Effect.flip)
      expect(failed.message).toBe("safe request failed")
      expect(JSON.stringify(failed)).not.toMatch(/server-secret-body|Authorization|token|bearer/i)
    })),
  )

  it.effect("maps the configured timeout to a sanitized Tool error", () =>
    Effect.scoped(Effect.gen(function* () {
      const pending = HttpClient.make(() => Effect.never)
      const origin = "https://api.example"
      const tools: Tool.Registration[] = []
      yield* registerOne(tools, origin, origin, pending)
      const fiber = yield* tools[0]!.execute!({}, context()).pipe(Effect.forkChild)
      yield* TestClock.adjust("30 seconds")
      const timedOut = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(timedOut.message).toBe("safe request failed")
    })),
  )
})
