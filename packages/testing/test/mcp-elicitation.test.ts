import { Effect, Exit, Fiber, Option, Stream } from "effect"
import { Session } from "@bymorning/core/session"
import { Mcp } from "@bymorning/core/mcp"
import assert from "node:assert/strict"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { TestUpstream } from "../src/upstream.js"

const events = (app: TestApp.Interface, workspace: string) =>
  Stream.fromAsyncIterable(
    app.client.event.subscribe({ workspace: workspace as never }),
    (cause) => new TestApp.RequestError({ message: "Workspace Event stream failed", cause }),
  )

test("connects an unauthenticated MCP server through its real URL Form and uses its catalog in the same Run", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const upstream = yield* TestUpstream.make({
        tools: [{ name: "remote", description: "Return the fixture remote value", result: "remote fixture result" }],
      })
       const app = yield* TestApp.make()
       const data = yield* Chat.make(app)
       const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
        const mcpReady = yield* events(app, data.owner.properties.workspaceID).pipe(
          Stream.filter((event) => event.type === "mcp.status.changed"),
          Stream.take(1),
         Stream.runHead,
         Effect.forkScoped({ startImmediately: true }),
       )
       yield* Effect.tryPromise(() =>
        app.client["api.config"].update({
          ...config,
          mcp: { servers: { fixture: { type: "remote", url: upstream.url.href, codemode: false, disabled: true } } },
          permissions: [
            { action: "mcp_connect", resource: "fixture", effect: "allow" },
            { action: "fixture_remote", resource: "*", effect: "allow" },
          ],
         }),
       )
       yield* Fiber.join(mcpReady)
       const activated = yield* events(app, data.owner.properties.workspaceID).pipe(
         Stream.filter((event) => event.type === "mcp.status.changed"),
         Stream.take(1),
         Stream.runHead,
         Effect.forkScoped({ startImmediately: true }),
       )
       const enabled = yield* Effect.tryPromise(() =>
         app.client.mcp.servers.update({
           workspace: data.owner.properties.workspaceID,
           server: "fixture",
           enabled: true,
         }),
       )
       expect(enabled.enabled).toBe(true)
       yield* Fiber.join(activated)
       const configured = yield* app.workspace({ account: data.account }, Mcp.Service.use((mcp) => mcp.servers()))
       assert.equal(configured.find((server) => server.name === "fixture")?.enabled, true)
       const prompt = "Connect the fixture MCP server, then call its remote tool."
      const answer = "The remote tool returned the fixture result."
      const gate = `${data.session.id}:mcp-result`
      yield* app.llm.expect(data.session.id, "title", [
        {
          expect: (request) => assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(prompt))),
          response: { type: "success", events: [{ text: "Connect fixture MCP" }] },
        },
      ])
      yield* app.llm.expect(data.session.id, "assistant", [
        {
          expect: (request) => {
            assert.ok(request.tools?.some((tool) => tool.function.name === "execute"), "Code Mode must be offered")
            assert.ok(
              JSON.stringify(request).includes("tools.toolkit.mcp.connect") && JSON.stringify(request).includes("fixture"),
              "Disabled configured server guidance must advertise the eligible connection tool",
            )
          },
          response: {
            type: "success",
            events: [{ tool: { id: "connect-1", name: "execute", input: { description: "Connect fixture MCP", code: 'return await tools.toolkit.mcp.connect({ server: "fixture" })' } } }],
          },
        },
        {
          expect: (request) => {
            const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "connect-1")
            assert.ok(result, "The actual MCP connection result must reach the next model request")
            assert.ok(
              JSON.stringify(result.content).includes("connected") && JSON.stringify(result.content).includes("fixture"),
              JSON.stringify(result.content),
            )
            assert.ok(request.tools?.some((tool) => tool.function.name === "fixture_remote"), "The fresh remote catalog must be offered")
          },
          response: { type: "success", events: [{ tool: { id: "remote-1", name: "fixture_remote", input: {} } }] },
        },
        {
          expect: (request) => {
            const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "remote-1")
            assert.ok(result, "The actual remote Tool result must reach the next model request")
            assert.ok(JSON.stringify(result.content).includes("remote fixture result"))
          },
          response: { type: "success", events: [{ gate }, { text: answer }] },
        },
      ])
       const formCreated = yield* events(app, data.owner.properties.workspaceID).pipe(
         Stream.filter((event) => event.type === "form.created" && event.data.sessionID === data.session.id),
        Stream.take(1),
        Stream.runHead,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: prompt }))
       const first = yield* app.llm.wait(data.session.id, "assistant")
        assert.ok(first.tools?.some((tool) => tool.function.name === "execute"), JSON.stringify(first.tools))
       const created = Option.getOrThrow(yield* Fiber.join(formCreated))
       const formID = "id" in created.data ? created.data.id : undefined
       assert.ok(typeof formID === "string", "The Form creation event must identify the new Form")
        const forms = yield* Effect.tryPromise(() => app.client.form.list({ sessionID: data.session.id }))
        const form = forms.find((candidate) => candidate.id === formID)
       assert.ok(form, "The pending OAuth URL Form must be visible through the generated SDK")
      const external = form.fields.find((field) => field.type === "external")
      assert.ok(external, "The OAuth Form must expose its real external URL")
      const action = form.fields.find(
        (field) => field.type === "string" && "options" in field && (field.options ?? []).some((option) => option.value === "accept"),
      )
      assert.ok(action && action.type === "string" && "options" in action, "The OAuth Form must expose an explicit Continue or Decline action")
      expect(action.options?.map((option) => option.value)).toContain("decline")
      yield* Effect.tryPromise(() =>
        app.client.form.reply({
          sessionID: data.session.id,
          formID: form.id,
          answer: { [action.key]: "accept", [external.key]: true },
        }),
      )

      const authorization = yield* Effect.tryPromise(() => fetch(external.url, { redirect: "manual" }))
       expect(authorization.status).toBe(302)
       const callback = authorization.headers.get("location")
       assert.ok(callback)
       const callbackURL = new URL(callback)
       const complete = yield* Effect.tryPromise(() =>
          fetch(new URL(callbackURL.pathname + callbackURL.search, app.origin), { redirect: "manual" }),
        )
       assert.equal(complete.status, 303, `OAuth callback ${callbackURL.href} resolved as ${complete.url}`)

       yield* app.llm.wait(data.session.id, "assistant", 1)
       yield* app.llm.waitGate(gate)
      expect(upstream.pkceVerified).toBe(true)
      expect(upstream.registrations).toBe(1)
      expect(upstream.invocations()).toEqual([{ name: "remote", arguments: {} }])
      yield* app.llm.release(gate)
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
      )
      yield* app.llm.settled(data.session.id, "title")
      yield* app.llm.verify()
      const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
      expect(JSON.stringify(messages)).toContain(answer)
      const disabled = yield* Effect.tryPromise(() =>
        app.client.mcp.servers.update({
          workspace: data.owner.properties.workspaceID,
          server: "fixture",
          enabled: false,
        }),
      )
      expect(disabled).toMatchObject({ name: "fixture", enabled: false, status: "disabled" })
      const reconnect = yield* Effect.tryPromise(() =>
        app.client.mcp.servers.connect({ workspace: data.owner.properties.workspaceID, server: "fixture" }),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(reconnect)).toBe(true)
      expect(
        (yield* Effect.tryPromise(() =>
          app.client.mcp.tools.list({ workspace: data.owner.properties.workspaceID }),
        )).some((tool) => tool.server === "fixture"),
      ).toBe(false)
    }).pipe(Effect.scoped),
    { signal },
  )
})
