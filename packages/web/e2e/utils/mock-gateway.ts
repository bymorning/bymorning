import type { Page, Route } from "@playwright/test"
import * as WorkspaceEvent from "@bymorning/schema/workspace-event"
import { Schema } from "effect"

type MockGatewayConfig = {
  readonly workspaceID: string
  readonly sessionID: string
  readonly responses: {
    readonly account?: unknown
    readonly workspaces: unknown
    readonly projects: unknown
    readonly sessions: unknown
    readonly session: unknown
    readonly active: unknown
    readonly messages?: unknown
    readonly tools?: unknown
    readonly providers?: unknown
    readonly models?: unknown
    readonly agents?: unknown
    readonly projectFiles?: unknown
    readonly sessionDetails?: Readonly<Record<string, unknown>>
    readonly users?: unknown
    readonly usage?: unknown
    readonly integrations?: unknown
    readonly mcpServers?: unknown
    readonly mcpTools?: unknown
    readonly toolPermissions?: unknown
    readonly websearchProviders?: unknown
    readonly permissions?: unknown
    readonly skills?: unknown
  }
}

type MockGatewayWindow = Window & {
  __e2eEventConnections?: number
  __e2eEventRequests?: Array<{
    readonly fixtureWorkspaceAuthorized: boolean
    readonly method: string
    readonly protocolValid: boolean
    readonly selectedWorkspace: string | null
    readonly url: string
    readonly workspaceSelector: string | null
  }>
  __e2eEventController?: ReadableStreamDefaultController<Uint8Array>
  __e2eEventControllers?: Array<ReadableStreamDefaultController<Uint8Array>>
  __e2eEventClose?: () => void
}

export async function mockGateway(page: Page, config: MockGatewayConfig) {
  const requests: string[] = []
  const urls: string[] = []
  const servedResponses: unknown[] = []
  const unexpected: string[] = []
  let active = config.responses.active
  let messages = config.responses.messages
  let tools = Promise.withResolvers<void>()
  tools.resolve()
  let nextToolsStatus: number | undefined

  await page.addInitScript((workspaceID) => {
    const host = window as MockGatewayWindow
    const originalFetch = window.fetch.bind(window)
    const encoder = new TextEncoder()

    window.fetch = (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (url.pathname !== "/api/event") return originalFetch(request)

      const workspace = url.searchParams.getAll("workspace")
      // Protocol Struct decoding ignores unknown query keys, so only declared fields affect validity.
      const protocolValid =
        request.method === "GET" && workspace.length <= 1 && (workspace[0] === undefined || workspace[0].startsWith("wrk_"))
      // This fixture exposes one authorized Workspace and treats an omitted selector as that default.
      const selectedWorkspace = workspace[0] ?? workspaceID
      const fixtureWorkspaceAuthorized = protocolValid && selectedWorkspace === workspaceID
      host.__e2eEventRequests = [
        ...(host.__e2eEventRequests ?? []),
        {
          fixtureWorkspaceAuthorized,
          method: request.method,
          protocolValid,
          selectedWorkspace: protocolValid ? selectedWorkspace : null,
          url: url.href,
          workspaceSelector: workspace[0] ?? null,
        },
      ]
      if (!protocolValid) return Promise.resolve(new Response(null, { status: 400 }))
      if (!fixtureWorkspaceAuthorized) return Promise.resolve(new Response(null, { status: 403 }))

      host.__e2eEventConnections = (host.__e2eEventConnections ?? 0) + 1
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              let open = true
              host.__e2eEventController = controller
              host.__e2eEventControllers = [...(host.__e2eEventControllers ?? []), controller]
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    id: "00000000-0000-4000-8000-000000000000",
                    type: "server.connected",
                    data: {},
                  })}\n\n`,
                ),
              )
              const close = () => {
                if (!open) return
                open = false
                host.__e2eEventControllers = (host.__e2eEventControllers ?? []).filter((item) => item !== controller)
                const latest = host.__e2eEventControllers.at(-1)
                if (latest) host.__e2eEventController = latest
                else delete host.__e2eEventController
                controller.close()
              }
              host.__e2eEventClose = close
              if (request.signal.aborted) close()
              else request.signal.addEventListener("abort", close, { once: true })
            },
          }),
          { status: 200, headers: { "cache-control": "no-cache", "content-type": "text/event-stream" } },
        ),
      )
    }
  }, config.workspaceID)

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })

  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${request.method()} ${url.pathname}`
    const projectDirectory = url.pathname.match(/^\/api\/project\/([^/]+)\/directory$/)?.[1]
    const sessionMessages = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/)?.[1]
    const permissionTools = url.pathname === "/api/permission/tool"
    const workspaceScoped =
      projectDirectory !== undefined ||
      permissionTools ||
      [
        "/api/agent",
        "/api/providers",
        "/api/models",
        "/api/skill",
        "/api/project",
        "/api/session",
        "/api/session/active",
        "/api/users",
        "/api/usage/overview",
        "/api/integration",
        "/api/mcp/server",
        "/api/websearch/provider",
        "/api/permission/request",
      ].includes(url.pathname)
    const validWorkspace = !workspaceScoped || url.searchParams.get("workspace") === config.workspaceID
    const validLimit = url.pathname !== "/api/session" || url.searchParams.get("limit") === "100"

    if (!validWorkspace || !validLimit) {
      unexpected.push(`${key}${url.search}`)
      await fulfillJson(route, { error: "Unexpected E2E request" }, 400)
      return
    }

    if (permissionTools && request.method() === "GET") {
      requests.push(key)
      urls.push(url.href)
      await tools.promise
      if (nextToolsStatus !== undefined) {
        const status = nextToolsStatus
        nextToolsStatus = undefined
        await fulfillJson(route, { message: "Mock tools failed" }, status)
        return
      }
      await fulfillJson(route, config.responses.tools ?? [])
      return
    }
    if (request.method() !== "GET") {
      unexpected.push(`${key}${url.search}`)
      await fulfillJson(route, { error: "Unexpected E2E request" }, 400)
      return
    }

    const response =
      url.pathname === "/api/account"
        ? config.responses.account ?? { id: "acc_e2e", email: "admin@example.test" }
        : url.pathname === "/api/workspaces"
        ? config.responses.workspaces
        : url.pathname === "/api/providers"
            ? config.responses.providers ?? []
             : url.pathname === "/api/models"
               ? config.responses.models ?? []
               : url.pathname === "/api/skill"
                 ? config.responses.skills ?? []
                 : url.pathname === "/api/agent"
                   ? config.responses.agents ?? []
                   : url.pathname === "/api/project"
                     ? config.responses.projects
                     : projectDirectory
                       ? config.responses.projectFiles
                       : sessionMessages
                         ? messages
                         : url.pathname === "/api/session"
                           ? config.responses.sessions
                           : url.pathname === "/api/session/active"
                             ? active
                             : url.pathname === "/api/permission/request"
                               ? config.responses.permissions ?? []
                               : url.pathname === "/api/users"
                                 ? config.responses.users ?? { role: "member", members: [] }
                                 : url.pathname === "/api/usage/overview"
                                   ? config.responses.usage
                                   : url.pathname === "/api/integration"
                                     ? config.responses.integrations ?? []
                                       : url.pathname === "/api/mcp/server"
                                         ? config.responses.mcpServers ?? []
                                         : url.pathname === "/api/mcp/tool"
                                           ? config.responses.mcpTools ?? []
                                           : url.pathname === "/api/permission/tool"
                                             ? config.responses.toolPermissions ?? []
                                        : url.pathname === "/api/websearch/provider"
                                         ? config.responses.websearchProviders ?? []
                                         : url.pathname === `/api/session/${config.sessionID}`
                                           ? config.responses.session
                                           : url.pathname.startsWith("/api/session/")
                                             ? config.responses.sessionDetails?.[
                                                 url.pathname.slice("/api/session/".length)
                                               ]
                                             : undefined

    if (response === undefined) {
      unexpected.push(`${key}${url.search}`)
      await fulfillJson(route, { error: "Unhandled E2E request" }, 501)
      return
    }

    requests.push(key)
    urls.push(url.href)
    servedResponses.push(response)
    await fulfillJson(route, response)
  })

  return {
    requests: () => requests.toSorted(),
    urls: () => [...urls],
    servedResponses: () => [...servedResponses],
    unexpected: () => [...unexpected],
    setActive: (response: unknown) => {
      active = response
    },
    setMessages: (response: unknown) => {
      messages = response
    },
    holdTools: () => {
      tools = Promise.withResolvers<void>()
    },
    releaseTools: () => tools.resolve(),
    failNextTools: (status = 500) => {
      nextToolsStatus = status
    },
    emit: (item: unknown) => {
      const decoded = Schema.decodeUnknownSync(WorkspaceEvent.Item)(item)
      const encoded = Schema.encodeSync(WorkspaceEvent.Item)(decoded)
      return page.evaluate((value) => {
        const host = window as MockGatewayWindow
        const controller = host.__e2eEventControllers?.at(-1)
        if (!controller) throw new Error("Workspace event stream is not connected")
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
      }, encoded)
    },
    disconnect: () =>
      page.evaluate(() => {
        const host = window as MockGatewayWindow
        if (!host.__e2eEventClose) throw new Error("Workspace event stream is not connected")
        host.__e2eEventClose()
      }),
    event: () =>
      page.evaluate(() => {
        const host = window as MockGatewayWindow
        return { connections: host.__e2eEventConnections ?? 0, requests: host.__e2eEventRequests ?? [] }
      }),
  }
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}
