import { Session } from "@bymorning/core/session"
import { Agent } from "@bymorning/schema/agent"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { TestHTTP } from "../src/http.js"
import { TestMCP } from "../src/mcp.js"
import { Chat } from "../src/scenario/chat.js"
import { ToolScenario } from "../src/scenario/tool.js"

// Real users paste documents, write long Skills and Agent instructions, and send file
// contents through MCP Tools. Each payload here is well past the 40 KiB default request limit.
const document = (marker: string, bytes: number) => `${marker}\n${"Lorem ipsum dolor sit amet. ".repeat(Math.ceil(bytes / 28))}`

test("a pasted long document is accepted by the prompt route and reaches the model", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const text = document("PASTED-DOCUMENT-START", 150 * 1024)
        const answer = "Summarized the document."
        const includesDocument = (request: import("../src/llm.js").Request) =>
          assert.ok(request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes("PASTED-DOCUMENT-START")))
        yield* app.llm.expect(data.session.id, "title", [
          { expect: includesDocument, response: { type: "success", events: [{ text: "Document summary" }] } },
        ])
        yield* app.llm.expect(data.session.id, "assistant", [
          { expect: includesDocument, response: { type: "success", events: [{ text: answer }] } },
        ])
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text }))
        yield* app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))
        const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
        expect(messages.data.filter((message) => message.type === "assistant").flatMap((message) => message.content)).toContainEqual(
          expect.objectContaining({ type: "text", text: answer }),
        )
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("long Skill and Agent instructions save through the API", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const instructions = document("LONG-INSTRUCTIONS", 80 * 1024)
        const skill = yield* Effect.tryPromise(() =>
          app.client.skill.create({ name: "long-skill", description: "A long reference Skill", instructions }),
        )
        expect(skill).toMatchObject({ name: "long-skill" })
        const agent = yield* Effect.tryPromise(() =>
          app.client.agent.create({
            id: Agent.ID.make("long-agent"),
            name: Agent.Name.make("Long agent"),
            model: data.session.model,
            instructions,
            mode: "subagent",
            hidden: false,
            steps: null,
            permissions: [],
          }),
        )
        expect(agent.instructions).toBe(instructions)
      }),
    ),
    { signal },
  )
})

test("an MCP client can send large Tool arguments through the gateway", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* TestHTTP.make((_request, response) => response.writeHead(200).end("unused"))
      const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
      const data = yield* ToolScenario.make(app)
      const mcp = yield* TestMCP.connect(app, data.owner.properties.workspaceID, { capabilities: {} })
      const text = document("MCP-FILE-CONTENT", 120 * 1024)
      const result = yield* Effect.tryPromise(() => mcp.callTool({ name: "fixture_echo", arguments: { text } }))
      expect(result.isError).not.toBe(true)
      expect(JSON.stringify(result.content)).toContain(`received ${text.length} characters`)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("unauthenticated routes keep the small request limit and answer 413", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const response = yield* Effect.tryPromise(() =>
          fetch(new URL("/auth/setup", app.origin), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "create", token: "x".repeat(100 * 1024) }),
          }),
        )
        expect(response.status).toBe(413)
      }),
    ),
    { signal },
  )
})
