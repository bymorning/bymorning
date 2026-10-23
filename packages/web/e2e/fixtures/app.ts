import { expect, test as base } from "@playwright/test"
import { Effect, Exit, Scope } from "effect"
import { createServer as createHTTPServer } from "node:http"
import type { Socket } from "node:net"
import { fileURLToPath } from "node:url"
import { createServer as createViteServer, loadConfigFromFile, type ViteDevServer } from "vite"
import { TestApp } from "@bymorning/testing/application"
import { TestDatabase } from "@bymorning/testing/database"
import { Chat } from "@bymorning/testing/scenario/chat"
import { WebUi } from "../../../server/src/web-ui.js"

type Application<Data> = Effect.Success<ReturnType<typeof TestApp.make>> & {
  readonly data: Data
  readonly web: URL
  /**
   * Destroy the browser's TCP connections that are currently serving a request for `pathname`,
   * returning how many were cut. Chromium's offline emulation fails only new requests, so this is
   * how a test drops an already established stream for real.
   */
  readonly disconnect: (pathname: string) => number
}

type Fixtures<Data> = {
  app: Application<Data>
  appOptions: NonNullable<Parameters<typeof TestApp.make>[0]>
  scenario: (app: TestApp.Interface) => Effect.Effect<Data, unknown, Scope.Scope>
  /** Serve the production document security policy from the dev server. */
  csp: boolean
}

/** A real Application with caller-selected persisted setup. */
export const makeTest = <Data>(scenario: Fixtures<Data>["scenario"]) =>
  base.extend<Fixtures<Data>, { database: TestDatabase.Interface }>({
    appOptions: async ({}, use) => use({}),
    scenario: async ({}, use) => use(scenario),
    csp: async ({}, use) => use(false),
    database: [
      async ({}, use) => {
        const scope = Effect.runSync(Scope.make())
        try {
          const database = await Effect.runPromise(TestDatabase.make.pipe(Scope.provide(scope)))
          await use(database)
        } finally {
          await Effect.runPromise(Scope.close(scope, Exit.void))
        }
      },
      { scope: "worker" },
    ],
    app: async ({ database, appOptions, scenario, csp }, use) => {
      const scope = Effect.runSync(Scope.make())
      const server = createHTTPServer()
      const sockets = new Set<Socket>()
      server.on("connection", (socket) => {
        sockets.add(socket)
        socket.once("close", () => sockets.delete(socket))
      })
      // The pathname each connection is serving right now; HTTP/1.1 serves one request at a time.
      const serving = new Map<Socket, string>()
      server.on("request", (request, response) => {
        const pathname = (request.url ?? "/").split("?")[0]!
        serving.set(request.socket, pathname)
        response.once("close", () => {
          if (serving.get(request.socket) === pathname) serving.delete(request.socket)
        })
      })
      const disconnect = (pathname: string) => {
        const cut = [...serving].filter(([, current]) => current === pathname)
        for (const [socket] of cut) socket.destroy()
        return cut.length
      }
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
        if (address === null || typeof address === "string") throw new Error("Missing browser fixture address")
        const web = new URL(`http://127.0.0.1:${address.port}`)
        const app = await Effect.runPromise(
          TestApp.make({ ...appOptions, appOrigin: web, database }).pipe(Scope.provide(scope)),
        )
        const data = await Effect.runPromise(scenario(app).pipe(Scope.provide(scope)))
        const root = fileURLToPath(new URL("../..", import.meta.url))
        const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, `${root}/vite.config.ts`)
        if (loaded === null) throw new Error("Missing web Vite config")
        vite = await createViteServer({
          ...loaded.config,
          configFile: false,
          root,
          cacheDir: `${app.directory}/vite`,
          optimizeDeps: {
            ...loaded.config.optimizeDeps,
            include: [
              ...(loaded.config.optimizeDeps?.include ?? []),
              "@shikijs/stream",
              "shiki",
              "katex",
              "marked",
              "marked-shiki",
              "remend",
            ],
          },
          server: {
            middlewareMode: true,
            hmr: { server },
            // The production document policy, served by WebUi in the built host,
            // is applied verbatim so CSP regressions surface in the real UI.
            headers: csp ? WebUi.security(false) : undefined,
            proxy: Object.fromEntries(
              Object.keys(loaded.config.server?.proxy ?? {}).map((path) => [
                path,
                { target: app.origin.href, changeOrigin: true },
              ]),
            ),
          },
        })
        server.on("request", vite.middlewares)
        await vite.warmupRequest("/src/main.tsx")
        await use({ ...app, data, web, disconnect })
      } finally {
        try {
          await vite?.close()
        } finally {
          try {
            // Include upgraded HMR sockets even if Vite cleanup failed.
            for (const socket of sockets) socket.destroy()
            if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
          } finally {
            await Effect.runPromise(Scope.close(scope, Exit.void))
          }
        }
      }
    },
    baseURL: async ({ app }, use) => use(app.web.href),
  })

/** A real Application with the default persisted conversation and chat-ready page. */
export const test = makeTest(Chat.make).extend({
  page: async ({ page, app }, use) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto("/login")
    await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
    await page.goto(`/w/${app.data.owner.properties.workspaceID}/session/${app.data.session.id}`)
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
    await expect(page.locator('[data-component="session-workspace"]')).toHaveAttribute("data-session-sync", "ready")
    await expect(page.locator('[data-component="session-workspace"]')).toHaveAttribute("data-transcript-state", "ready")
    await use(page)
    expect(errors).toEqual([])
  },
})

export { expect } from "@playwright/test"
