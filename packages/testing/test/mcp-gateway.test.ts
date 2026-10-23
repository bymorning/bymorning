import { Effect, Fiber } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { TestHTTP } from "../src/http.js"
import { TestMCP } from "../src/mcp.js"
import { ToolScenario } from "../src/scenario/tool.js"
import { Form } from "@bymorning/schema/form"
import { Auth } from "@bymorning/schema/auth"

test("uses negotiated modern MCP elicitation for one and consecutive Tool rounds without the model opt-in", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* TestHTTP.make((_request, response) => response.writeHead(200).end("modern fixture value"))
      const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
      const data = yield* ToolScenario.make(app)
      const requests: unknown[] = []
      const mcp = yield* TestMCP.connect(app, data.owner.properties.workspaceID, {
        capabilities: { elicitation: { form: {} } },
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        configure: (client) => client.setRequestHandler("elicitation/create", async (request) => {
          requests.push(request.params)
          if (request.params.mode !== "form") throw new Error("Expected form elicitation")
          const fields = request.params.requestedSchema.properties
          const content: Record<string, boolean> = "first" in fields ? { first: true } : { second: true }
          return { action: "accept", content }
        }),
      })

      const result = yield* Effect.tryPromise(() => mcp.callTool({ name: "fixture_elicit_twice", arguments: {} }))
      expect(result.isError).not.toBe(true)
      expect(JSON.stringify(result.content)).toContain("modern fixture value")
      expect(requests).toHaveLength(2)
      expect(http.requests()).toHaveLength(1)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("keeps a legacy MCP caller on the authenticated browser Form and resumes only after its caller reply", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* TestHTTP.make((_request, response) => response.writeHead(200).end("browser fixture value"))
      const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
      const data = yield* ToolScenario.make(app)
      const mcp = yield* TestMCP.connect(app, data.owner.properties.workspaceID, { capabilities: {} })
      const first = yield* Effect.tryPromise(() => mcp.callTool({ name: "fixture_elicit", arguments: {} }))
      const pending = first.structuredContent as { status: string; mode: string; url: string; continuation: string }
      expect(pending).toMatchObject({ status: "pending", mode: "browser" })
      expect(pending.url).toMatch(/^http:\/\//)
      const workspace = data.owner.properties.workspaceID
      const formID = Form.ID.make(pending.url.split("/").at(-1)!)
      expect(yield* Effect.tryPromise(() => app.client.form.caller.state({ workspace, formID }))).toEqual({ status: "pending" })
      expect(http.requests()).toHaveLength(0)

      yield* Effect.tryPromise(() => app.client.form.caller.reply({ workspace, formID, answer: { __bymorning_gateway_action: "accept", confirm: true } }))
      const result = yield* Effect.tryPromise(() => mcp.callTool({ name: "mcp_resume", arguments: { continuation: pending.continuation } }))
      expect(result.isError).not.toBe(true)
      expect(JSON.stringify(result.content)).toContain("browser fixture value")
      expect(http.requests()).toHaveLength(1)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("uses the explicit model relay without native capabilities", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const http = yield* TestHTTP.make((_request, response) => response.writeHead(200).end("model fixture value"))
    const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
    const data = yield* ToolScenario.make(app)
    const mcp = yield* TestMCP.connect(app, data.owner.properties.workspaceID, { capabilities: {}, model: true })
    const first = yield* Effect.tryPromise(() => mcp.callTool({ name: "fixture_elicit", arguments: {} }))
    const pending = first.structuredContent as { status: string; mode: string; request: unknown; continuation: string }
    expect(pending).toMatchObject({ status: "pending", mode: "model", request: { mode: "form" } })
    const result = yield* Effect.tryPromise(() => mcp.callTool({ name: "mcp_resume", arguments: {
      continuation: pending.continuation, response: { action: "accept", answer: { confirm: true } },
    } }))
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result.content)).toContain("model fixture value")
    expect(http.requests()).toHaveLength(1)
  }).pipe(Effect.scoped), { signal })
})

test("rejects bad model continuations without settling, and duplicate resumes do not repeat its side effect", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const http = yield* TestHTTP.make((_request, response) => response.writeHead(200).end("adversarial fixture value"))
    const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
    const data = yield* ToolScenario.make(app)
    const mcp = yield* TestMCP.connect(app, data.owner.properties.workspaceID, { elicitation: "model" })
    const first = yield* Effect.tryPromise(() => mcp.callTool({ name: "fixture_elicit", arguments: {} }))
    const pending = first.structuredContent as { continuation: string }

    const tampered = yield* Effect.tryPromise(() => mcp.callTool({ name: "mcp_resume", arguments: {
      continuation: `${pending.continuation}tampered`, response: { action: "accept", answer: { confirm: true } },
    } }))
    expect(tampered.isError).toBe(true)
    const invalid = yield* Effect.tryPromise(() => mcp.callTool({ name: "mcp_resume", arguments: {
      continuation: pending.continuation, response: { action: "accept", answer: { confirm: "yes" } },
    } }))
    expect(invalid.isError).toBe(true)
    expect(http.requests()).toHaveLength(0)

    const response = { continuation: pending.continuation, response: { action: "accept" as const, answer: { confirm: true } } }
    const completed = yield* Effect.tryPromise(() => mcp.callTool({ name: "mcp_resume", arguments: response }))
    expect(completed.isError).not.toBe(true)
    const duplicate = yield* Effect.tryPromise(() => mcp.callTool({ name: "mcp_resume", arguments: response }))
    expect(duplicate).toEqual(completed)
    expect(http.requests()).toHaveLength(1)
  }).pipe(Effect.scoped), { signal })
})

test("an explicit browser query overrides native capabilities without becoming the model relay", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const http = yield* TestHTTP.make((_request, response) => response.writeHead(200).end("forced browser fixture value"))
    const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
    const data = yield* ToolScenario.make(app)
    const mcp = yield* TestMCP.connect(app, data.owner.properties.workspaceID, {
      elicitation: "browser",
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    })
    const first = yield* Effect.tryPromise(() => mcp.callTool({ name: "fixture_elicit", arguments: {} }))
    const pending = first.structuredContent as { mode: string; url: string; continuation: string }
    expect(pending).toMatchObject({ mode: "browser" })
    expect(pending).not.toHaveProperty("request")
    const formID = Form.ID.make(pending.url.split("/").at(-1)!)
    const forged = yield* Effect.promise(() => mcp.callTool({ name: "mcp_resume", arguments: {
      continuation: pending.continuation,
      response: { action: "accept", answer: { confirm: true } },
    } })).pipe(Effect.forkScoped({ startImmediately: true }))
    // Browser responses are intentionally ignored: only the authenticated Form
    // is allowed to settle this invocation.
    expect(http.requests()).toHaveLength(0)
    yield* Effect.tryPromise(() => app.client.form.caller.reply({
      workspace: data.owner.properties.workspaceID,
      formID,
      answer: { __bymorning_gateway_action: "accept", confirm: true },
    }))
    const complete = yield* Fiber.join(forged)
    expect(complete.isError).not.toBe(true)
    expect(http.requests()).toHaveLength(1)
  }).pipe(Effect.scoped), { signal })
})

test("binds a browser continuation to the authenticated member that received it", async ({ signal }) => {
  await Effect.runPromise(Effect.gen(function* () {
    const http = yield* TestHTTP.make((_request, response) => response.writeHead(200).end("member-bound fixture value"))
    const app = yield* TestApp.make({ plugins: [ToolScenario.plugin(http.origin)] })
    const data = yield* ToolScenario.make(app)
    const ownerMCP = yield* TestMCP.connect(app, data.owner.properties.workspaceID)
    const first = yield* Effect.tryPromise(() => ownerMCP.callTool({ name: "fixture_elicit", arguments: {} }))
    const pending = first.structuredContent as { url: string; continuation: string }
    const workspace = data.owner.properties.workspaceID
    const formID = Form.ID.make(pending.url.split("/").at(-1)!)

    yield* Effect.tryPromise(() => app.client.user.invite({
      email: Auth.Email.make("member@bymorning.ai"),
      role: "member",
    }))
    const memberClient = app.clientFor()
    yield* app.login(memberClient, {
      subject: Auth.Sub.make("test-member"),
      email: Auth.Email.make("member@bymorning.ai"),
    })
    const memberMCP = yield* TestMCP.connect({ origin: app.origin, client: memberClient }, workspace)
    const refused = yield* Effect.tryPromise(() => memberMCP.callTool({ name: "mcp_resume", arguments: {
      continuation: pending.continuation,
    } }))
    expect(refused.isError).toBe(true)
    expect(http.requests()).toHaveLength(0)
    expect(yield* Effect.tryPromise(() => app.client.form.caller.state({ workspace, formID }))).toEqual({ status: "pending" })

    yield* Effect.tryPromise(() => app.client.form.caller.reply({
      workspace,
      formID,
      answer: { __bymorning_gateway_action: "accept", confirm: true },
    }))
    const completed = yield* Effect.tryPromise(() => ownerMCP.callTool({ name: "mcp_resume", arguments: {
      continuation: pending.continuation,
    } }))
    expect(completed.isError).not.toBe(true)
    expect(JSON.stringify(completed.content)).toContain("member-bound fixture value")
    expect(http.requests()).toHaveLength(1)
  }).pipe(Effect.scoped), { signal })
})
