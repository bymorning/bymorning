import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { createServer, type Server } from "node:http"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http"
import { register } from "../src/tool/openapi.js"
import type { Tool } from "@bymorning/schema/tool"
import type { Editor } from "../src/tool.js"

const spec = (path: string, operationId: string, security?: string[]) => ({
  openapi: "3.0.0",
  info: { title: "test", version: "1" },
  servers: [{ url: "http://127.0.0.1" }],
  paths: { [path]: { get: { operationId, ...(security ? { security: [{ [security[0]]: [] }] } : {}), responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } } } } },
  components: security ? { securitySchemes: { api: { type: "apiKey", in: "header", name: "X-Key" } } } : undefined,
})

const server = Effect.acquireRelease(
  Effect.promise(() => new Promise<Server>((resolve) => {
    const value = createServer((request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ method: request.method, key: request.headers["x-key"] ?? null }))
    }).listen(0, "127.0.0.1", () => resolve(value))
  })),
  (value) => Effect.promise(() => new Promise<void>((resolve) => value.close(() => resolve()))),
)

const context = { permission: () => Effect.void } as never
const editor = (tools: Tool.Registration[]): Editor => ({
  add: (tool) => tools.push(tool), list: () => [], get: () => undefined,
  namespace: () => undefined, update: () => undefined, remove: () => undefined,
})

describe("Tool.OpenAPI", () => {
  it.effect("executes a generated operation against a scoped local HTTP service", () =>
    Effect.scoped(Effect.gen(function* () {
      const listening = yield* server
      const address = listening.address()
      if (!address || typeof address === "string") return yield* Effect.die("server did not bind")
      const origin = `http://127.0.0.1:${address.port}`
      const tools: Tool.Registration[] = []
      const result = yield* register({
        tool: { transform: (f) => Effect.sync(() => f(editor(tools))).pipe(Effect.as({ dispose: Effect.void })) },
        integration: { connection: { active: () => Effect.succeed(undefined), resolve: () => Effect.succeed(undefined) } } as never,
        http: yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer)),
        options: { namespace: "local", permissionPrefix: "local", expectedOrigin: origin, baseURL: origin, authentication: { type: "none" }, spec: spec("/ping", "ping") as never },
      })
      expect(result.operationNames).toEqual(["ping"])
      const response = yield* tools[0]!.execute!({}, context)
      expect(response).toEqual({ output: { method: "GET", key: null } })
    })),
  )

  it.effect("resolves current integration API-key credentials before the request", () =>
    Effect.gen(function* () {
      const tools: Tool.Registration[] = []
      let key = "first"
      let reads = 0
      const transmitted: boolean[] = []
      yield* register({
        tool: { transform: (f) => Effect.sync(() => f(editor(tools))).pipe(Effect.as({ dispose: Effect.void })) },
        integration: { connection: { active: () => Effect.sync(() => { reads++; return { id: "connection" } }), resolve: () => Effect.succeed({ type: "key", key }) } } as never,
        http: HttpClient.make((request) => Effect.sync(() => {
          transmitted.push(request.headers["x-key"] === (transmitted.length === 0 ? "first" : "replacement"))
          return HttpClientResponse.fromWeb(request, Response.json({ ok: true }))
        })),
        options: { namespace: "local", permissionPrefix: "local", expectedOrigin: "https://api.example", baseURL: "https://api.example", authentication: { type: "integration", integrationID: "integration", schemes: { api: { type: "apiKey" } } }, spec: spec("/ping", "ping", ["api"]) as never },
      })
      expect(tools).toHaveLength(1)
      expect(reads).toBe(0)
      yield* tools[0]!.execute!({}, context)
      key = "replacement"
      yield* tools[0]!.execute!({}, context)
      expect(reads).toBe(2)
      expect(transmitted).toEqual([true, true])
    })
  )
})
