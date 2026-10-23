import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http"
import { afterEach, expect, it } from "vitest"
import { createServer } from "node:http"
import { WebUi } from "./web-ui.js"

const runtimes = Array<ManagedRuntime.ManagedRuntime<HttpServer.HttpServer, unknown>>()

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

it("serves embedded assets and falls back to the SPA without hiding server 404s", async () => {
  const application = HttpRouter.add("GET", "/api/health", Effect.succeed(HttpServerResponse.text("healthy"))).pipe(
    Layer.provide(
      WebUi.layer({
        assets: {
          "index.html": "<main>ByMorning</main>",
          "assets/app.js": "console.log('bymorning')",
        },
      }),
    ),
  )
  const runtime = ManagedRuntime.make(
    HttpRouter.serve(application, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 }))),
  )
  runtimes.push(runtime)
  const server = await runtime.runPromise(HttpServer.HttpServer)
  const baseURL = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")

  const route = await fetch(`${baseURL}/workspace/project`)
  expect(route.status).toBe(200)
  expect(route.headers.get("content-type")).toBe("text/html; charset=utf-8")
  expect(await route.text()).toBe("<main>ByMorning</main>")

  const asset = await fetch(`${baseURL}/assets/app.js`)
  expect(asset.status).toBe(200)
  expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
  expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8")

  expect((await fetch(`${baseURL}/assets/missing.js`)).status).toBe(404)
  expect((await fetch(`${baseURL}/api/missing`)).status).toBe(404)
  expect(await (await fetch(`${baseURL}/api/health`)).text()).toBe("healthy")
})

it("[SEC-HDR-03] serves the SPA document with the application security policy", async () => {
  const application = HttpRouter.add("GET", "/api/health", Effect.succeed(HttpServerResponse.text("healthy"))).pipe(
    Layer.provide(
      WebUi.layer({
        assets: {
          "index.html": "<main>ByMorning</main>",
          "assets/app.js": "console.log('bymorning')",
        },
        https: true,
      }),
    ),
  )
  const runtime = ManagedRuntime.make(
    HttpRouter.serve(application, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 }))),
  )
  runtimes.push(runtime)
  const server = await runtime.runPromise(HttpServer.HttpServer)
  const baseURL = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")

  const document = await fetch(`${baseURL}/w/anything`)
  expect(document.status).toBe(200)
  const csp = document.headers.get("content-security-policy") ?? ""
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("base-uri 'self'")
  expect(csp).toContain("form-action 'self'")
  expect(csp).toContain("worker-src 'self'")
  expect(csp).toContain("connect-src 'self'")
  expect(document.headers.get("x-frame-options")).toBe("DENY")
  expect(document.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
  expect(document.headers.get("cross-origin-opener-policy")).toBe("same-origin")
  expect(document.headers.get("permissions-policy")).toContain("camera=()")
  expect(document.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains")
  expect(document.headers.get("x-content-type-options")).toBe("nosniff")

  // Immutable assets are not documents: no CSP, no HSTS, cacheable.
  const asset = await fetch(`${baseURL}/assets/app.js`)
  expect(asset.status).toBe(200)
  expect(asset.headers.get("content-security-policy")).toBeNull()
  expect(asset.headers.get("strict-transport-security")).toBeNull()
})

it("[SEC-HDR-04] omits HSTS for the document when the public origin is plain HTTP", async () => {
  const application = HttpRouter.add("GET", "/api/health", Effect.succeed(HttpServerResponse.text("healthy"))).pipe(
    Layer.provide(
      WebUi.layer({
        assets: { "index.html": "<main>ByMorning</main>" },
      }),
    ),
  )
  const runtime = ManagedRuntime.make(
    HttpRouter.serve(application, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 }))),
  )
  runtimes.push(runtime)
  const server = await runtime.runPromise(HttpServer.HttpServer)
  const baseURL = HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1")

  const document = await fetch(`${baseURL}/`)
  expect(document.status).toBe(200)
  expect(document.headers.get("strict-transport-security")).toBeNull()
  expect(document.headers.get("content-security-policy")).toContain("default-src 'self'")
})
