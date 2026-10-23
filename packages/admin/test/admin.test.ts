import { NodeHttpServer } from "@effect/platform-node"
import { Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { afterEach, expect, test } from "vitest"
import { AdminApi } from "../src/api.js"
import { handlers } from "../src/handlers.js"

const runtimes: Array<{ readonly dispose: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

test("exposes GET /admin/health without authentication", () => {
  const endpoints: Array<string> = []
  HttpApi.reflect(AdminApi, {
    onGroup() {},
    onEndpoint({ endpoint, middleware }) {
      endpoints.push(`${endpoint.method} ${endpoint.path}`)
      expect(middleware.size).toBe(0)
    },
  })
  expect(endpoints).toEqual(["GET /admin/health"])
})

test("serves GET /admin/health", async () => {
  const runtime = ManagedRuntime.make(
    HttpRouter.serve(HttpApiBuilder.layer(AdminApi).pipe(Layer.provide(handlers)), {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 }))),
  )
  runtimes.push(runtime)
  const server = await runtime.runPromise(HttpServer.HttpServer)
  const origin = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")
  const response = await fetch(`${origin}/admin/health`)
  expect(response.status).toBe(200)
  expect(await response.text()).toBe("ok")
})
