import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { TestHTTP } from "../src/http.js"
import { ToolScenario } from "../src/scenario/tool.js"

test("shares a host HTTP Tool across Session and real inbound MCP; permission fails closed", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const content = "scoped external HTTP value"
    const http = yield* TestHTTP.make((request, response) => {
      response.writeHead(request.url === "/value" ? 200 : 404, { "content-type": "text/plain" })
      response.end(content)
    })
    const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
    const { mcp } = yield* ToolScenario.run(app, content)
    expect(http.requests()).toHaveLength(3)
    expect(http.requests().every((request) => request.method === "GET" && request.url === "/value" && request.authorization === undefined)).toBe(true)
    // Configuration reconciliation must dispose the old registration rather than
    // leaving a retired Tool executable in the shared member graph.
    const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
    yield* Effect.tryPromise(() => app.client["api.config"].update({ ...config, plugins: [...(config.plugins ?? []), "-test.tool"] }))
    const removed = yield* Effect.tryPromise<{ tools: ReadonlyArray<{ name: string }> }>(() => mcp.listTools())
    expect(removed.tools.find((tool) => tool.name === "fixture_http")).toBeUndefined()
    const restoredConfig = yield* Effect.tryPromise(() => app.client["api.config"].get())
    yield* Effect.tryPromise(() => app.client["api.config"].update({
      ...restoredConfig,
      plugins: [...(restoredConfig.plugins ?? []), ToolScenario.plugin(http.origin)],
      permissions: [
        { action: "execute", resource: "*", effect: "allow" },
        { action: "fixture.http", resource: "*", effect: "allow" },
      ],
    }))
    const restored = yield* Effect.tryPromise<{ tools: ReadonlyArray<{ name: string }> }>(() => mcp.listTools())
    expect(restored.tools.find((tool) => tool.name === "fixture_http")).toBeDefined()
    for (const effect of ["ask", "deny"] as const) {
      const permissionConfig = yield* Effect.tryPromise(() => app.client["api.config"].get())
      yield* Effect.tryPromise(() => app.client["api.config"].update({ ...permissionConfig, permissions: [
        { action: "execute", resource: "*", effect: "allow" },
        { action: "fixture.http", resource: http.origin.origin, effect },
      ] }))
      const advertised = yield* Effect.tryPromise<{ tools: ReadonlyArray<{ name: string }> }>(() => mcp.listTools())
      expect(advertised.tools.some((tool) => tool.name === "fixture_http")).toBe(true)
      const direct = yield* Effect.tryPromise<{ isError?: boolean; content: unknown; structuredContent?: { error?: boolean } }>(async () =>
        (await mcp.callTool({ name: "fixture_http", arguments: {} })) as { isError?: boolean; content: unknown; structuredContent?: { error?: boolean } })
      expect(direct.isError).toBe(true)
      expect(direct.structuredContent).toBeUndefined()
      expect(JSON.stringify(direct.content)).toContain("Permission denied")
      const code = yield* Effect.tryPromise<{ isError?: boolean; content: unknown; structuredContent?: { error?: boolean } }>(async () =>
        (await mcp.callTool({ name: "execute", arguments: { description: "Call fixture code", code: "return await tools.fixture_code({})" } })) as { isError?: boolean; content: unknown; structuredContent?: { error?: boolean } })
      expect(code.isError).toBeUndefined()
      expect(code.structuredContent?.error).toBe(true)
      expect(JSON.stringify(code.content)).toContain("Permission denied")
      expect(http.requests()).toHaveLength(3)
    }
  }).pipe(Effect.scoped), { signal })
})
