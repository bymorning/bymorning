/** Shared real HTTP Tool conversation and inbound MCP verification. */
export * as ToolScenario from "./tool.js"

import { Session } from "@bymorning/core/session"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import type { TestApp } from "../application.js"
import { TestMCP } from "../mcp.js"
import { Chat } from "./chat.js"

export const plugin = (endpoint: URL) => ({
  package: fileURLToPath(new URL("../tool-plugin.ts", import.meta.url)),
  options: { endpoint: endpoint.href },
})

/** Provision the real chat fixture and admit the HTTP Tool without starting a Run. */
export const make = Effect.fn("ToolScenario.make")(function* (app: TestApp.Interface) {
  const data = yield* Chat.make(app)
  const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
  yield* Effect.tryPromise(() =>
    app.client["api.config"].update({
      ...config,
      permissions: [
        { action: "execute", resource: "*", effect: "allow" },
        { action: "fixture.http", resource: "*", effect: "allow" },
      ],
    }),
  )
  return data
})

export interface Script {
  readonly prompt: string
  readonly answer: string
  readonly gate: string
}

/** Register title/assistant responses; the caller owns prompt submission and lifecycle waits. */
export const script = Effect.fn("ToolScenario.script")(function* (
  app: TestApp.Interface,
  data: Chat.Data,
  content: string,
) {
  const prompt = "Read the fixture HTTP endpoint"
  const answer = `The endpoint says ${content}.`
  const gate = `${data.session.id}:http-result`
  yield* app.llm.expect(data.session.id, "title", [
    {
      expect: (request) =>
        assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(prompt))),
      response: { type: "success", events: [{ text: "Read fixture endpoint" }] },
    },
  ])
  yield* app.llm.expect(data.session.id, "assistant", [
    {
      expect: (request) => {
        assert.ok(request.tools?.some((tool) => tool.function.name === "fixture_http"))
        assert.ok(request.tools?.some((tool) => tool.function.name === "execute"))
      },
      response: { type: "success", events: [{ tool: { id: "http-1", name: "fixture_http", input: {} } }] },
    },
    {
      expect: (request) => {
        const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "http-1")
        assert.ok(result, "The actual HTTP Tool result must reach the next model request")
        assert.ok(JSON.stringify(result.content).includes(content), JSON.stringify(result))
      },
      response: { type: "success", events: [{ gate }, { text: answer }] },
    },
  ])
  return { prompt, answer, gate }
})

/** Scripts assert the next actual model request, not just a canned final sentence. */
export const run = Effect.fn("ToolScenario.run")(function* (app: TestApp.Interface, content: string) {
  const data = yield* make(app)
  const { prompt, answer, gate } = yield* script(app, data, content)
  yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: prompt }))
  yield* app.llm.waitGate(gate)
  yield* app.llm.release(gate)
  yield* app.workspace(
    { account: data.account },
    Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
  )
  const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
  assert.ok(JSON.stringify(messages).includes(answer))
  yield* app.llm.settled(data.session.id, "title")
  yield* app.llm.verify()
  const mcp = yield* TestMCP.connect(app, data.owner.properties.workspaceID)
  type OutputSchema = { type?: string; properties?: Record<string, unknown>; anyOf?: ReadonlyArray<OutputSchema> }
  const tools = yield* Effect.tryPromise<{ tools: ReadonlyArray<{ name: string; outputSchema?: OutputSchema }> }>(
    () => mcp.listTools() as Promise<{ tools: ReadonlyArray<{ name: string; outputSchema?: OutputSchema }> }>,
  )
  assert.ok(tools.tools.find((tool) => tool.name === "fixture_http"))
  assert.ok(tools.tools.find((tool) => tool.name === "execute"))
  const fixture = tools.tools.find((tool) => tool.name === "fixture_http")
  assert.equal(fixture?.outputSchema?.type, "object")
  // The Tool Gateway advertises `anyOf: [result, pending]` so an elicitation can
  // interrupt the call; the wrapped string result is the first branch.
  assert.ok(fixture?.outputSchema?.anyOf?.[0]?.properties?.output)
  const direct = yield* Effect.tryPromise<{ isError?: boolean; content: unknown; structuredContent?: unknown }>(
    async () =>
      (await mcp.callTool({ name: "fixture_http", arguments: {} })) as {
        isError?: boolean
        content: unknown
        structuredContent?: unknown
      },
  )
  assert.notEqual(direct.isError, true)
  assert.ok(JSON.stringify(direct.content).includes(content))
  assert.deepEqual(direct.structuredContent, { output: content })
  const code = yield* Effect.tryPromise<{ isError?: boolean; content: unknown }>(
    async () =>
      (await mcp.callTool({ name: "execute", arguments: { description: "Call fixture code", code: "return await tools.fixture_code({})" } })) as {
        isError?: boolean
        content: unknown
      },
  )
  assert.notEqual(code.isError, true)
  assert.ok(JSON.stringify(code.content).includes(content))
  return { data, mcp }
})
