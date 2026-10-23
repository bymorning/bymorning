import { afterEach, describe, expect, it } from "vitest"
import { Credential, Integration, Tool } from "@bymorning/plugin"
import type { Context } from "@bymorning/plugin/promise/plugin"
import type { IntegrationOAuthMethodRegistration } from "@bymorning/plugin/promise/integration"
import type { ToolContext } from "@bymorning/plugin/promise/tool"
import drivePlugin, { drive } from "../src/drive.js"
import calendarPlugin, { calendar } from "../src/calendar.js"
import sheetsPlugin, { sheets } from "../src/sheets.js"
import docsPlugin, { docs } from "../src/docs.js"

const products = [drive, calendar, sheets, docs] as const
const plugins = [drivePlugin, calendarPlugin, sheetsPlugin, docsPlugin] as const

const accessSecret = "access-secret-value"
const refreshSecret = "refresh-secret-value"
const clientSecret = "client-secret-value"

function oauthCredential(access: string): Credential.OAuth {
  return Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make("oauth"),
    access,
    refresh: refreshSecret,
    expires: Date.now() + 3_600_000,
    metadata: { sub: "google-subject", email: "person@example.com" },
  })
}

interface CapturedTool {
  readonly name: string
  readonly options?: { readonly namespace?: string; readonly permission?: string }
  readonly execute: (input: never, context: ToolContext) => Promise<unknown>
}

function fixture() {
  const integrations: Array<{ id: string; name: string; connectionPolicy?: string }> = []
  const methods: IntegrationOAuthMethodRegistration[] = []
  const tools: CapturedTool[] = []
  const permissionCalls: Array<{ action: string; resources: ReadonlyArray<string> }> = []
  const order: string[] = []
  const state = {
    activeConnection: undefined as unknown,
    credential: undefined as Credential.Value | undefined,
    callbackWait: undefined as Promise<{ code: string } | { error: string }> | undefined,
  }
  const context = {
    integration: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          update: (id: string, update: (integration: { id: string; name: string }) => void) => {
            const integration = { id, name: id }
            update(integration)
            integrations.push(integration as { id: string; name: string })
          },
          remove: () => {},
          method: {
            list: () => [],
            update: (value: IntegrationOAuthMethodRegistration) => {
              methods.push(value)
            },
            remove: () => {},
          },
        })
        return { dispose: async () => {} }
      },
      connection: {
        active: async () => state.activeConnection,
        resolve: async () => state.credential,
      },
      oauth: {
        callback: {
          register: async () => ({
            state: "host-state",
            callbackURI: "https://app.example/auth/integration/callback",
            expiresAt: 123,
            wait: state.callbackWait ?? new Promise<never>(() => {}),
          }),
        },
      },
    },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          list: () => [],
          get: () => undefined,
          namespace: () => {},
          update: () => {},
          remove: () => {},
          add: (tool: CapturedTool) => {
            tools.push(tool)
          },
        })
        return { dispose: async () => {} }
      },
    },
  } as unknown as Context
  const toolContext = {
    permission: (async (request: { action: string; resources: ReadonlyArray<string> }) => {
      order.push("permission")
      permissionCalls.push(request)
    }) as ToolContext["permission"],
    progress: async () => {},
  } as unknown as ToolContext
  return { context, integrations, methods, tools, permissionCalls, order, state, toolContext }
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function stubFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    return handler(url, init ?? {})
  }) as typeof fetch
}

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("Google Workspace plugins", () => {
  it("registers four member-only products with disjoint scopes", async () => {
    const seenIDs = new Set<string>()
    const seenScopes = new Set<string>()
    for (let index = 0; index < plugins.length; index++) {
      const test = fixture()
      await plugins[index].setup(test.context)
      expect(test.integrations).toHaveLength(1)
      const integration = test.integrations[0]!
      expect(integration.id).toBe(products[index].integrationID)
      expect(integration.name).toBe(products[index].product)
      expect((integration as { connectionPolicy?: string }).connectionPolicy).toBe("member-only")
      expect(test.methods).toHaveLength(1)
      const method = test.methods[0]!
      expect(method.integrationID).toBe(products[index].integrationID)
      if (!("authorize" in method)) throw new Error("OAuth method missing")
      expect(method.method).toMatchObject({ id: "oauth", type: "oauth", label: "Google OAuth web app" })
      expect(test.tools.length).toBeGreaterThan(0)
      for (const tool of test.tools) expect(tool.options?.namespace).toBe(products[index].namespace)
      expect(seenIDs.has(products[index].pluginID)).toBe(false)
      seenIDs.add(products[index].pluginID)
      for (const scope of products[index].authorizationScopes) {
        expect(scope).not.toMatch(/gmail/)
        expect(seenScopes.has(scope) && !scope.startsWith("openid") && scope !== "email").toBe(false)
        seenScopes.add(scope)
      }
    }
    expect(seenIDs).toEqual(
      new Set([
        "google-workspace.drive",
        "google-workspace.calendar",
        "google-workspace.sheets",
        "google-workspace.docs",
      ]),
    )
  })

  it("authorizes with PKCE, offline access, and consent without leaking the client secret", async () => {
    const test = fixture()
    test.state.callbackWait = Promise.resolve({ code: "authorization-code" })
    test.state.credential = oauthCredential(accessSecret)
    const seen: string[] = []
    stubFetch(async (url) => {
      seen.push(url.href)
      if (url.href === "https://oauth2.googleapis.com/token")
        return tokenResponse({ access_token: accessSecret, expires_in: 3600, refresh_token: refreshSecret })
      return tokenResponse({ sub: "google-subject", email: "person@example.com", name: "Extra Name" })
    })
    await drivePlugin.setup(test.context)
    const method = test.methods[0]!
    if (!("authorize" in method) || method.refresh === undefined) throw new Error("OAuth method missing")
    const authorization = await method.authorize({}, { client_id: "client-id", client_secret: clientSecret })
    if (authorization.mode !== "auto") throw new Error("Automatic callback missing")
    const url = new URL(authorization.url)
    expect(url.origin).toBe("https://accounts.google.com")
    expect(url.searchParams.get("state")).toBe("host-state")
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/auth/integration/callback")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(0)
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toBe("consent")
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...drive.authorizationScopes])
    expect(authorization.url.includes(clientSecret)).toBe(false)
    const credential = await authorization.callback
    expect(credential.metadata).toEqual({ sub: "google-subject", email: "person@example.com" })
    expect(method.label?.(credential)).toBe("person@example.com")
    expect(JSON.stringify({ authorization, metadata: credential.metadata }).includes(clientSecret)).toBe(false)
    expect(seen[0]).toBe("https://oauth2.googleapis.com/token")
  })

  it("requires a refresh token and refreshes with current client configuration", async () => {
    const test = fixture()
    test.state.callbackWait = Promise.resolve({ code: "authorization-code" })
    const bodies: string[] = []
    let calls = 0
    stubFetch(async (url, init) => {
      if (url.href === "https://oauth2.googleapis.com/token") {
        calls++
        bodies.push(String(init.body))
        if (calls === 1) return tokenResponse({ access_token: "access-1", expires_in: 3600 })
        return tokenResponse({ access_token: "access-2", expires_in: 3600 })
      }
      return tokenResponse({ sub: "google-subject", email: "person@example.com" })
    })
    await drivePlugin.setup(test.context)
    const method = test.methods[0]!
    if (!("authorize" in method) || method.refresh === undefined) throw new Error("OAuth method missing")
    const authorization = await method.authorize({}, { client_id: "client-a", client_secret: "secret-a" })
    if (authorization.mode !== "auto") throw new Error("Automatic callback missing")
    await expect(authorization.callback).rejects.toThrow("did not return a refresh token")
    const credential = oauthCredential("access-1")
    const refreshed = await method.refresh(
      { ...credential, metadata: { sub: "google-subject", email: "person@example.com", legacy: "drop-me" } },
      { client_id: "client-b", client_secret: "secret-b" },
    )
    expect(refreshed.access).toBe("access-2")
    expect(refreshed.refresh).toBe(refreshSecret)
    expect(refreshed.metadata).toEqual({ sub: "google-subject", email: "person@example.com" })
    expect(bodies[0]?.includes("secret-a")).toBe(true)
    expect(bodies[1]?.includes("secret-b")).toBe(true)
    expect(JSON.stringify(refreshed.metadata).includes("secret-a")).toBe(false)
    await expect(method.authorize({}, {})).rejects.toThrow("OAuth client configuration is incomplete")
  })

  it("asserts permission before fetching for every product", async () => {
    const cases = [
      {
        plugin: drivePlugin,
        tool: "files_get",
        input: { fileId: "file-1" },
        path: "/drive/v3/files/file-1",
        body: { id: "file-1", name: "File", extra: "dropped" },
      },
      {
        plugin: calendarPlugin,
        tool: "events_list",
        input: {},
        path: "/calendar/v3/calendars/primary/events",
        body: { items: [{ id: "e1", summary: "Standup", start: { dateTime: "2026-09-10T09:00:00Z" } }] },
      },
      {
        plugin: sheetsPlugin,
        tool: "values_get",
        input: { spreadsheetId: "sheet-1", range: "A1:B2" },
        path: "/v4/spreadsheets/sheet-1/values/A1%3AB2",
        body: { range: "A1:B2", values: [["a"]] },
      },
      {
        plugin: docsPlugin,
        tool: "documents_get",
        input: { documentId: "doc-1" },
        path: "/v1/documents/doc-1",
        body: { title: "Doc", body: { content: [{ paragraph: { elements: [{ textRun: { content: "Hi" } }] } }] } },
      },
    ] as const
    for (const item of cases) {
      const test = fixture()
      test.state.activeConnection = { id: "connection-1" }
      test.state.credential = oauthCredential(accessSecret)
      const seen: string[] = []
      const headers: Record<string, string> = {}
      stubFetch(async (url, init) => {
        test.order.push("fetch")
        seen.push(url.href)
        for (const [key, value] of Object.entries(init.headers ?? {})) headers[key] = String(value)
        return tokenResponse(item.body)
      })
      await item.plugin.setup(test.context)
      const tool = test.tools.find((entry) => entry.name === item.tool)
      if (!tool) throw new Error(`Tool ${item.tool} missing`)
      test.order.length = 0
      await tool.execute(item.input as never, test.toolContext)
      expect(test.order).toEqual(["permission", "fetch"])
      expect(test.permissionCalls).toHaveLength(1)
      expect(seen).toHaveLength(1)
      expect(new URL(seen[0]!).origin).toBe("https://www.googleapis.com")
      expect(new URL(seen[0]!).pathname).toBe(item.path)
      expect(headers.Authorization).toBe(`Bearer ${accessSecret}`)
    }
  })

  it("resolves the connection on every call without capturing credentials", async () => {
    const test = fixture()
    test.state.activeConnection = { id: "connection-1" }
    test.state.credential = oauthCredential("first-access")
    const authorizations: Array<string | null> = []
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get("Authorization"))
      return tokenResponse({ files: [{ id: "f1", name: "F" }] })
    }) as typeof fetch
    await drivePlugin.setup(test.context)
    const tool = test.tools.find((entry) => entry.name === "files_list")
    if (!tool) throw new Error("files_list missing")
    await tool.execute({} as never, test.toolContext)
    test.state.credential = oauthCredential("second-access")
    await tool.execute({} as never, test.toolContext)
    expect(authorizations).toEqual(["Bearer first-access", "Bearer second-access"])
  })

  it("rejects crafted IDs before fetching and stays on the API origin", async () => {
    const test = fixture()
    test.state.activeConnection = { id: "connection-1" }
    test.state.credential = oauthCredential(accessSecret)
    let fetches = 0
    stubFetch(async () => {
      fetches++
      return tokenResponse({})
    })
    await drivePlugin.setup(test.context)
    const tool = test.tools.find((entry) => entry.name === "files_get")
    if (!tool) throw new Error("files_get missing")
    await expect(tool.execute({ fileId: "https://evil.example/x" } as never, test.toolContext)).rejects.toBeInstanceOf(
      Tool.Error,
    )
    await expect(tool.execute({ fileId: "../escape" } as never, test.toolContext)).rejects.toBeInstanceOf(Tool.Error)
    expect(fetches).toBe(0)
    expect(test.permissionCalls).toHaveLength(2)
  })

  it("sanitizes provider failures without leaking secrets", async () => {
    const test = fixture()
    test.state.activeConnection = { id: "connection-1" }
    test.state.credential = oauthCredential(accessSecret)
    stubFetch(async () => new Response("sensitive-provider-body", { status: 500 }))
    await calendarPlugin.setup(test.context)
    const tool = test.tools.find((entry) => entry.name === "calendars_list")
    if (!tool) throw new Error("calendars_list missing")
    const error = await tool.execute({} as never, test.toolContext).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Tool.Error)
    expect((error as Tool.Error).message).toContain("500")
    expect(JSON.stringify(error).includes(accessSecret)).toBe(false)
    expect(JSON.stringify(error).includes("sensitive-provider-body")).toBe(false)
  })

  it("refuses missing and mismatched credentials before fetching", async () => {
    const test = fixture()
    let fetches = 0
    stubFetch(async () => {
      fetches++
      return tokenResponse({})
    })
    await sheetsPlugin.setup(test.context)
    const tool = test.tools.find((entry) => entry.name === "sheets_get")
    if (!tool) throw new Error("sheets_get missing")
    await expect(tool.execute({ spreadsheetId: "s1" } as never, test.toolContext)).rejects.toThrow(
      "Connect Google Sheets",
    )
    test.state.activeConnection = { id: "connection-1" }
    test.state.credential = { type: "key", key: "some-key" } as unknown as Credential.Value
    await expect(tool.execute({ spreadsheetId: "s1" } as never, test.toolContext)).rejects.toThrow(
      "Reconnect Google Sheets",
    )
    expect(fetches).toBe(0)
  })

  it("bounds oversized responses", async () => {
    const test = fixture()
    test.state.activeConnection = { id: "connection-1" }
    test.state.credential = oauthCredential(accessSecret)
    stubFetch(async () => new Response("short", { headers: { "content-length": String(10 * 1024 * 1024) } }))
    await docsPlugin.setup(test.context)
    const tool = test.tools.find((entry) => entry.name === "documents_get")
    if (!tool) throw new Error("documents_get missing")
    const error = await tool
      .execute({ documentId: "doc-1" } as never, test.toolContext)
      .catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Tool.Error)
    expect((error as Tool.Error).message).toContain("too large")
    expect(JSON.stringify(error).includes(accessSecret)).toBe(false)
  })
})
