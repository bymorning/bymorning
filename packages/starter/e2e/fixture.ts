import { expect, test as base } from "@playwright/test"
import { TestApp } from "@bymorning/testing/application"
import { TestDatabase } from "@bymorning/testing/database"
import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect, Exit, Scope } from "effect"
import { createServer as createHTTPServer, request as requestHTTP, type ClientRequest } from "node:http"
import type { Socket } from "node:net"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { build, createServer as createViteServer, loadConfigFromFile, type ViteDevServer } from "vite"

type Application = TestApp.Interface & {
  readonly data: Chat.Data
  readonly web: URL
}

type Fixtures = {
  readonly app: Application
  readonly appOptions: NonNullable<Parameters<typeof TestApp.make>[0]>
  readonly scenario: (app: TestApp.Interface) => Effect.Effect<Chat.Data, unknown, Scope.Scope>
}

/**
 * One real Application and Vite server per test. The browser receives normal local
 * login cookies; its API traffic is only proxied to the fixture Application.
 */
export const test = base.extend<Fixtures, { readonly database: TestDatabase.Interface }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  appOptions: async ({}, use) => use({}),
  // eslint-disable-next-line no-empty-pattern -- This fixture has no dependencies.
  scenario: async ({}, use) => use(Chat.make),
  database: [
    // eslint-disable-next-line no-empty-pattern -- This worker fixture has no dependencies.
    async ({}, use) => {
      const scope = Effect.runSync(Scope.make())
      try {
        await use(await Effect.runPromise(TestDatabase.make.pipe(Scope.provide(scope))))
      } finally {
        await Effect.runPromise(Scope.close(scope, Exit.void))
      }
    },
    { scope: "worker" },
  ],
  app: async ({ database, appOptions, scenario }, use) => {
    const scope = Effect.runSync(Scope.make())
    const server = createHTTPServer()
    server.on("request", (request, response) => {
      if (new URL(request.url ?? "/", "http://starter.local").pathname !== "/e2e/observer") return
      response.setHeader("content-type", "text/html")
      response.end('<!doctype html><main id="root"></main><script type="module" src="/e2e/observer.tsx"></script>')
    })
    const sockets = new Set<Socket>()
    const upstreams = new Set<ClientRequest>()
    server.on("connection", (socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    })
    let vite: ViteDevServer | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject)
          resolve()
        })
      })
      const address = server.address()
      if (address === null || typeof address === "string") throw new Error("Missing starter browser fixture address")
      const web = new URL(`http://127.0.0.1:${address.port}`)
      const app = await Effect.runPromise(
        TestApp.make({ ...appOptions, appOrigin: web, database }).pipe(Scope.provide(scope)),
      )
      const data = await Effect.runPromise(scenario(app).pipe(Scope.provide(scope)))
      const root = fileURLToPath(new URL("..", import.meta.url))
      const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, `${root}/vite.config.ts`)
      if (loaded === null) throw new Error("Missing starter Vite config")
      if (process.env.STARTER_E2E_BUILD === "1") {
        const output = path.join(app.directory, "starter-dist")
        await build({
          ...loaded.config,
          configFile: false,
          root,
          build: { ...loaded.config.build, outDir: output, emptyOutDir: true },
        })
        server.on("request", (request, response) => serveBuild(request, response, app.origin, output, upstreams))
      } else {
        vite = await createViteServer({
          ...loaded.config,
          configFile: false,
          root,
          cacheDir: `${app.directory}/starter-vite`,
          plugins: loaded.config.plugins,
          define: { ...loaded.config.define, "import.meta.env.VITE_API_ORIGIN": JSON.stringify(app.origin.href) },
          server: {
            middlewareMode: true,
            hmr: { server },
            proxy: Object.fromEntries(
              Object.keys(loaded.config.server?.proxy ?? {}).map((path) => [
                path,
                { target: app.origin.href, changeOrigin: true },
              ]),
            ),
          },
        })
        server.on("request", (request, response) => {
          if (!response.writableEnded) vite?.middlewares(request, response)
        })
        await vite.warmupRequest("/src/entry.tsx")
      }
      await use({ ...app, data, web })
    } finally {
      try {
        await vite?.close()
      } finally {
        // The production static host owns these proxy requests. In particular,
        // abort its upstream Event stream before disposing the Application.
        for (const upstream of upstreams) upstream.destroy()
        for (const socket of sockets) socket.destroy()
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
        await Effect.runPromise(Scope.close(scope, Exit.void))
      }
    }
  },
  baseURL: async ({ app }, use) => use(app.web.href),
  page: async ({ page, app }, use) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto("/")
    await page.getByRole("link", { name: "Continue to sign in", exact: true }).click()
    await expect(page.getByRole("combobox", { name: "Workspace", exact: true })).toBeVisible()
    await page.goto(
      `/?workspace=${app.data.owner.properties.workspaceID}&project=${app.data.project.id}&session=${app.data.session.id}`,
    )
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable()
    await use(page)
    expect(errors).toEqual([])
  },
})

export { expect } from "@playwright/test"

function serveBuild(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  api: URL,
  output: string,
  upstreams: Set<ClientRequest>,
) {
  const pathname = new URL(request.url ?? "/", "http://starter.local").pathname
  if (
    ["/.well-known", "/auth", "/api", "/inference", "/mcp", "/oauth", "/system"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    const upstream = requestHTTP(
      {
        hostname: api.hostname,
        port: api.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: api.host },
      },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers)
        incoming.pipe(response)
      },
    )
    upstreams.add(upstream)
    const abort = () => {
      if (!upstream.destroyed) upstream.destroy()
    }
    request.once("aborted", abort)
    response.once("close", abort)
    upstream.once("close", () => {
      upstreams.delete(upstream)
      request.off("aborted", abort)
      response.off("close", abort)
    })
    upstream.once("error", (error) => response.destroy(error))
    request.pipe(upstream)
    return
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1)
  const file = path.resolve(output, relative)
  if (!file.startsWith(`${output}${path.sep}`)) return response.writeHead(403).end()
  readFile(file)
    .catch(() => readFile(path.join(output, "index.html")))
    .then((body) => response.writeHead(200, { "content-type": contentType(file) }).end(body))
    .catch(() => response.writeHead(404).end())
}

function contentType(file: string) {
  if (file.endsWith(".js")) return "text/javascript"
  if (file.endsWith(".css")) return "text/css"
  if (file.endsWith(".svg")) return "image/svg+xml"
  return "text/html"
}
