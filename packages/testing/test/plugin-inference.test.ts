import { Plugin } from "@bymorning/core/plugin"
import { ServiceAccount } from "@bymorning/core/service-account"
import { Session } from "@bymorning/core/session"
import { AccountActor } from "@bymorning/schema/actor"
import { Integration } from "@bymorning/schema/integration"
import { Session as SessionSchema } from "@bymorning/schema/session"
import { Provider } from "@bymorning/schema/provider"
import { Effect, Fiber } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Bedrock } from "../src/scenario/bedrock.js"
import { Chat } from "../src/scenario/chat.js"
import { PluginScenario } from "../src/scenario/plugin.js"

const send = (app: TestApp.Interface, headers: Record<string, string>, stream = false, model: string = Bedrock.model.converse) =>
  Effect.tryPromise((signal) =>
    fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
      method: "POST",
      headers,
      body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "hello" }] }),
      signal,
    }),
  )

const idle = (app: TestApp.Interface, data: Chat.Data) =>
  app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))

test("a cold service-key Gateway request activates only the Workspace Plugin host", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const app = yield* TestApp.make({
        plugins: [{ ...probe.plugin, options: { ...probe.plugin.options, denyRequest: true } }, probe.member],
      })
      const owner = yield* app.login()
      const headers = yield* app.process(
        ServiceAccount.Service.use((accounts) =>
          Effect.gen(function* () {
            const workspaceID = owner.properties.workspaceID
            const account = yield* accounts.create({ workspaceID, name: "Cold Gateway" })
            const key = yield* accounts.key.create(workspaceID, account.id, { name: "Inference" })
            return { authorization: `Bearer ${key.secret}`, "content-type": "application/json" }
          }),
        ),
      )
      expect(yield* probe.list).toEqual([])
      const response = yield* send(app, headers)
      const body = yield* Effect.promise(() => response.text())
      expect(response.status, body).toBe(403)
      const events = yield* probe.list
      expect(events.filter((event) => event.kind === "activate")).toHaveLength(1)
      expect(events).toContainEqual(expect.objectContaining({ kind: "request", domain: "gateway", protocol: "openai-chat" }))
      expect(events.some((event) => event.kind === "member")).toBe(false)
      expect(yield* app.llm.list()).toEqual([])
      // Acquiring the real member runtime later must reuse the Workspace activation.
      const inventory = yield* app.workspace(
        { account: new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } }) },
        Plugin.Service.use((plugin) => plugin.list()),
      )
      expect(inventory.filter((plugin) => plugin.id === "test.inference")).toHaveLength(1)
      yield* probe.wait((event) => event.kind === "member")
      expect((yield* probe.list).filter((event) => event.kind === "activate")).toHaveLength(1)
    }).pipe(Effect.scoped),
    { signal },
  )
})

for (const stream of [false, true])
  test(`translated Bedrock ${stream ? "SSE" : "JSON"} records actual usage once and closes Plugin resources`, async ({ signal }) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const probe = yield* PluginScenario.make()
        const { app, upstream, headers, owner } = yield* Bedrock.make({ plugins: [probe.plugin] })
        const step = yield* upstream.expect({
          transport: "converse",
          response: "text",
          expect: (request) => expect(request.body).toMatchObject({ messages: [{ role: "user", content: [{ text: "hello" }] }] }),
        })
        const response = yield* send(app, headers, stream)
        const body = yield* Effect.promise(() => response.text())
        expect(response.status, body).toBe(200)
        expect(body).toContain("Hello 世界")
        yield* step.settled
        const opened = yield* probe.wait((event) => event.kind === "open" && event.domain === "gateway")
        yield* probe.wait((event) => event.kind === "close" && event.id === opened.id && event.observer === 1)
        expect(opened).toMatchObject({
          workspaceID: owner.properties.workspaceID,
          model: { provider: Provider.AmazonBedrock, id: Bedrock.model.converse },
          publicModel: Bedrock.model.converse,
          protocol: "openai-chat",
          caller: false,
          frozen: true,
          stream,
        })
        expect(opened.sessionID).toBeUndefined()
        const events = (yield* probe.list).filter((event) => event.id === opened.id)
        const observations = events.filter((event) => event.kind === "usage")
        expect(observations.map((event) => event.observer)).toEqual([1, 2])
        for (const event of observations)
          expect(event).toMatchObject({ frozen: true, tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 2, cacheWrite: 1 } })
        expect(events.filter((event) => event.kind === "close").map((event) => event.observer)).toEqual([2, 1])
        const records = yield* Effect.tryPromise(() => app.client.usage.records({ limit: 100 }))
        expect(records.data).toHaveLength(1)
        expect(records.data[0]).toMatchObject({ source: "inference", model: Bedrock.model.converse, usage: { tokens: { input: 10, output: 5 } } })
        yield* upstream.verify
      }).pipe(Effect.scoped),
      { signal },
    )
  })

test("one routing Plugin runs before final admission on Session and Gateway", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const route = Chat.routedModel
      const gatewayID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000099")
      const app = yield* TestApp.make({ outbound: PluginScenario.transport(gatewayID), plugins: [{ ...probe.plugin, options: { ...probe.plugin.options, route } }] })
      const data = yield* Chat.make(app)
      const script = yield* Chat.script(app, data)
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
      yield* app.llm.waitGate(script.gate)
      yield* app.llm.release(script.gate)
      yield* idle(app, data)
      yield* app.llm.settled(data.session.id, "title")
      yield* app.llm.expect(data.session.id, "compaction", [{
        expect: (request) => {
          expect(JSON.stringify(request.messages)).toContain(script.answer)
          expect(request.tools?.length ?? 0).toBe(0)
        },
        response: { type: "success", events: [{ text: "## Objective\nRead notes.\n\n## Work State\nNotes read." }] },
      }])
      yield* Effect.tryPromise(() => app.client.session.compact({ sessionID: data.session.id }))
      yield* idle(app, data)
      yield* app.llm.settled(data.session.id, "compaction")
      yield* app.llm.expect(data.session.id, "generate", [{
        expect: (request) => expect(JSON.stringify(request.messages)).toContain("Generate a short label"),
        response: { type: "success", events: [{ text: "Notes" }], usage: { input: 4, output: 1 } },
      }])
      const generated = yield* Effect.tryPromise(() => app.client.session.generate({ sessionID: data.session.id, prompt: "Generate a short label" }))
      expect(generated.text).toBe("Notes")
      const events = yield* probe.list
      const attempts = events.filter((event) => event.kind === "open")
      expect(attempts.filter((event) => event.purpose === "assistant")).toHaveLength(2)
      expect(attempts.filter((event) => event.purpose === "title")).toHaveLength(1)
      expect(attempts.filter((event) => event.purpose === "compaction")).toHaveLength(1)
      expect(attempts.filter((event) => event.purpose === "generate")).toHaveLength(1)
      expect(new Set(attempts.map((event) => event.id)).size).toBe(5)
      for (const attempt of attempts) expect(attempt.model).toEqual(route)
      for (const request of yield* app.llm.list()) expect(request.model).toBe(route.id)

      const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
      yield* Effect.tryPromise(() => app.client["api.config"].update({
        ...config,
        plugins: [...(config.plugins ?? []).filter((entry) => typeof entry !== "object" || entry.package !== probe.plugin.package), {
          ...probe.plugin, options: { ...probe.plugin.options, route, nativeAPI: app.llm.url, generation: 2 },
        }],
      }))
      yield* probe.wait((event) => event.kind === "activate" && event.generation === 2)
      const account = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Routing" }))
      const key = yield* Effect.tryPromise(() => app.client.serviceAccount.key.create({ id: account.id, name: "Inference" }))
      yield* Effect.tryPromise(() => app.client.integration.connect.key({ integrationID: Integration.ID.make(Chat.model.provider), scope: "workspace", key: "fixture" }))
      for (const stream of [false, true]) {
        yield* app.llm.expect(gatewayID, "assistant", [{
          expect: (request) => {
            expect(request.model).toBe(route.id)
            expect(request.stream ?? false).toBe(stream)
          },
          response: { type: "success", events: [{ text: "Native routed answer" }], usage: { input: 7, output: 3 } },
        }])
        const response = yield* send(app, { authorization: `Bearer ${key.secret}`, "content-type": "application/json" }, stream)
        const body = yield* Effect.promise(() => response.text())
        expect(response.status, body).toBe(200)
        expect(body).toContain("Native routed answer")
        const opened = yield* probe.wait((event) => event.kind === "open" && event.domain === "gateway" && event.stream === stream)
        yield* probe.wait((event) => event.kind === "close" && event.id === opened.id && event.observer === 1)
        expect(opened.model).toEqual(route)
        expect((yield* probe.list).filter((event) => event.kind === "usage" && event.id === opened.id)).toHaveLength(2)
      }
      expect((yield* probe.list).filter((event) => event.kind === "request" && event.domain === "gateway")).toContainEqual(
        expect.objectContaining({ requestedModel: Bedrock.model.converse, protocol: "openai-chat" }),
      )
      expect(yield* app.llm.list()).toHaveLength(7)
      const records = yield* Effect.tryPromise(() => app.client.usage.records({ limit: 100 }))
      expect(records.data.filter((record) => record.source === "inference")).toHaveLength(2)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("a Session generate reservation blocks Gateway until cancellation releases it", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const { app, upstream, headers } = yield* Bedrock.make({ plugins: [probe.plugin] })
      const data = yield* Chat.make(app)
      // Below the fixture model's worst-case cost, so one in-flight generate holds the whole Period's room.
      yield* Effect.tryPromise(() =>
        app.client.budget.limit(
          { workspace: data.owner.properties.workspaceID, target: { type: "workspace" }, amount: 1 },
        ),
      )
      const gate = `${data.session.id}:generate-cancel`
      yield* app.llm.expect(data.session.id, "generate", [{
        expect: (request) => expect(JSON.stringify(request.messages)).toContain("Hold reservation"),
        response: { type: "cancel", gate, text: ["Partial"] },
      }])
      const generating = yield* Effect.tryPromise((signal) => app.client.session.generate({ sessionID: data.session.id, prompt: "Hold reservation" }, { signal })).pipe(Effect.forkChild)
      yield* app.llm.waitGate(gate)
      const refused = yield* send(app, headers)
      expect(refused.status, yield* Effect.promise(() => refused.text())).toBe(429)
      expect(yield* upstream.count).toBe(0)
      yield* Fiber.interrupt(generating)
      yield* app.llm.settled(data.session.id, "generate")
      const opened = yield* probe.wait((event) => event.kind === "open" && event.purpose === "generate")
      yield* probe.wait((event) => event.kind === "close" && event.id === opened.id && event.observer === 1)
      yield* upstream.expect({ transport: "converse", response: "text", expect: () => {} })
      const allowed = yield* send(app, headers)
      expect(allowed.status, yield* Effect.promise(() => allowed.text())).toBe(200)
      expect((yield* probe.list).filter((event) => event.id === opened.id && event.kind === "usage")).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("a failing usage observer preserves later observers, committed accounting, and cleanup", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const { app, upstream, headers } = yield* Bedrock.make({ plugins: [{ ...probe.plugin, options: { ...probe.plugin.options, failUsage: true } }] })
      yield* upstream.expect({ transport: "converse", response: "text", expect: () => {} })
      const response = yield* send(app, headers)
      const body = yield* Effect.promise(() => response.text())
      expect(response.status, body).toBe(429)
      const opened = yield* probe.wait((event) => event.kind === "open")
      yield* probe.wait((event) => event.kind === "close" && event.id === opened.id && event.observer === 1)
      const events = (yield* probe.list).filter((event) => event.id === opened.id)
      expect(events.filter((event) => event.kind === "usage").map((event) => event.observer)).toEqual([1, 2])
      expect(events.filter((event) => event.kind === "close").map((event) => event.observer)).toEqual([2, 1])
      const records = yield* Effect.tryPromise(() => app.client.usage.records({ limit: 100 }))
      expect(records.data).toHaveLength(1)
      expect(records.data[0]?.usage.tokens).toMatchObject({ input: 10, output: 5, cache: { read: 2, write: 1 } })
      expect(yield* upstream.count).toBe(1)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("Gateway revalidates native request edits before opening an invocation", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const { app, upstream, headers } = yield* Bedrock.make({ plugins: [{ ...probe.plugin, options: { ...probe.plugin.options, invalidStream: true } }] })
      const response = yield* send(app, headers)
      expect(response.status, yield* Effect.promise(() => response.text())).toBe(503)
      expect(yield* upstream.count).toBe(0)
      expect((yield* probe.list).some((event) => event.kind === "open")).toBe(false)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("an active Session and Gateway share the same request allowance", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const { app, upstream, headers } = yield* Bedrock.make({ plugins: [probe.plugin] })
      const data = yield* Chat.make(app)
      const script = yield* Chat.script(app, data, "cancel")
      const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
      // One assistant plus one title physical attempt exhausts the shared allowance.
      yield* Effect.tryPromise(() => app.client["api.config"].update({ ...config, gateway: { limits: { rpm: 2 } } }))
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
      yield* app.llm.waitGate(script.gate)
      yield* app.llm.settled(data.session.id, "title")
      const response = yield* send(app, headers)
      const body = yield* Effect.promise(() => response.text())
      expect(response.status, body).toBe(429)
      expect(yield* upstream.count).toBe(0)
      yield* Effect.tryPromise(() => app.client.session.interrupt({ sessionID: data.session.id }))
      yield* idle(app, data)
      yield* app.llm.settled(data.session.id, "assistant")
      const opened = yield* probe.wait((event) => event.kind === "open" && event.purpose === "assistant")
      yield* probe.wait((event) => event.kind === "close" && event.id === opened.id && event.observer === 1)
      expect((yield* probe.list).filter((event) => event.kind === "usage" && event.id === opened.id)).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("budget and model refusals stop both inference entrypoints before upstream receipt", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { app, upstream, headers } = yield* Bedrock.make()
      const data = yield* Chat.make(app)
      const workspace = data.owner.properties.workspaceID
      yield* Effect.tryPromise(() =>
        app.client.budget.limit({ workspace, target: { type: "workspace" }, amount: 0 }),
      )
      const response = yield* send(app, headers)
      const body = yield* Effect.promise(() => response.text())
      expect(response.status, body).toBe(429)
      expect(yield* upstream.count).toBe(0)
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: "Refuse inference" }))
      yield* idle(app, data)
      expect(yield* app.llm.list()).toEqual([])
      expect(yield* upstream.count).toBe(0)
      // Clear the Workspace limit so the model-refusal case is not still budget-capped.
      yield* Effect.tryPromise(() => app.client.budget.limit({ workspace, target: { type: "workspace" } }))
      const config = yield* Effect.tryPromise(() => app.client["api.config"].get({ workspace }))
      yield* Effect.tryPromise(() =>
        app.client["api.config"].update({ workspace, ...config, gateway: { models: [] } }),
      )
      const refused = yield* send(app, headers)
      const refusedBody = yield* Effect.promise(() => refused.text())
      expect(refused.status, refusedBody).toBe(403)
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: "Refuse inference" }))
      yield* idle(app, data)
      expect(yield* app.llm.list()).toEqual([])
      expect(yield* upstream.count).toBe(0)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("late admission refusal and upstream failure still close every Plugin resource", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const { app, upstream, headers } = yield* Bedrock.make({ plugins: [{ ...probe.plugin, options: { ...probe.plugin.options, deny: true } }] })
      const denied = yield* send(app, headers)
      expect(denied.status, yield* Effect.promise(() => denied.text())).toBe(403)
      const opened = yield* probe.wait((event) => event.kind === "open")
      yield* probe.wait((event) => event.kind === "close" && event.id === opened.id && event.observer === 1)
      expect(yield* upstream.count).toBe(0)
      expect((yield* probe.list).filter((event) => event.kind === "usage")).toEqual([])
      const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
      yield* Effect.tryPromise(() => app.client["api.config"].update({ ...config, plugins: ["*", { ...probe.plugin, options: { ...probe.plugin.options, generation: 2 } }] }))
      yield* probe.wait((event) => event.kind === "activate" && event.generation === 2)
      yield* upstream.expect({ transport: "converse", response: "error", expect: () => {} })
      const failed = yield* send(app, headers)
      expect(failed.status, yield* Effect.promise(() => failed.text())).toBe(403)
      const next = yield* probe.wait((event) => event.kind === "open" && event.generation === 2)
      yield* probe.wait((event) => event.kind === "close" && event.id === next.id && event.observer === 1)
      expect((yield* probe.list).filter((event) => event.kind === "usage")).toEqual([])
      expect((yield* Effect.tryPromise(() => app.client.usage.records({ limit: 100 }))).data).toEqual([])
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("cancelling an active stream drains reload before replacing its callbacks", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* PluginScenario.make()
      const { app, upstream, headers } = yield* Bedrock.make({ plugins: [probe.plugin] })
      const step = yield* upstream.expect({ transport: "converse", response: "cancel", expect: () => {} })
      const abort = new AbortController()
      const response = yield* Effect.tryPromise(() => fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
        method: "POST", headers, signal: abort.signal,
        body: JSON.stringify({ model: Bedrock.model.converse, stream: true, messages: [{ role: "user", content: "hello" }] }),
      }))
      expect(response.status).toBe(200)
      if (response.body === null) return yield* Effect.die(new Error("Expected a streaming response body"))
      const reader = response.body.getReader()
      yield* Effect.promise(() => reader.read())
      yield* step.blocked
      const opened = yield* probe.wait((event) => event.kind === "open")
      const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
      const update = yield* Effect.tryPromise(() => app.client["api.config"].update({
        ...config, plugins: ["*", { ...probe.plugin, options: { ...probe.plugin.options, generation: 2 } }],
      })).pipe(Effect.forkChild)
      // The committed Config is the reload trigger; active invocation cleanup must
      // precede disposal and replacement even when the configuration endpoint returns early.
      yield* Fiber.join(update)
      expect((yield* probe.list).some((event) => event.kind === "dispose")).toBe(false)
      abort.abort()
      yield* Effect.promise(() => reader.cancel().catch(() => undefined))
      yield* step.settled
      yield* probe.wait((event) => event.kind === "activate" && event.generation === 2)
      const events = yield* probe.list
      const closed = events.findIndex((event) => event.kind === "close" && event.id === opened.id && event.observer === 1)
      const disposed = events.findIndex((event) => event.kind === "dispose" && event.generation === 1)
      expect(closed).toBeGreaterThan(-1)
      expect(disposed).toBeGreaterThan(closed)
      expect(events.filter((event) => event.kind === "usage" && event.id === opened.id)).toEqual([])
      yield* upstream.expect({ transport: "converse", response: "text", expect: () => {} })
      const next = yield* send(app, headers)
      expect(next.status, yield* Effect.promise(() => next.text())).toBe(200)
      yield* probe.wait((event) => event.kind === "close" && event.generation === 2 && event.observer === 1)
    }).pipe(Effect.scoped),
    { signal },
  )
})
