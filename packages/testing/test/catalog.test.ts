import { Catalog } from "@bymorning/core/catalog"
import { Integration } from "@bymorning/core/integration"
import { Session } from "@bymorning/core/session"
import { ModelResolver } from "@bymorning/core/model-resolver"
import { Agent } from "@bymorning/schema/agent"
import { fileURLToPath } from "node:url"
import { Provider } from "@bymorning/schema/provider"
import { Effect, Redacted } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { TestLLM } from "../src/llm.js"

test("the generated SDK browses disconnected provider models and refuses their execution", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const workspace = data.owner.properties.workspaceID
      const directory = yield* Effect.tryPromise(() => app.client.provider.list({ workspace }))
      expect(directory.some((entry) => entry.integration === undefined)).toBe(true)
      expect(
        yield* Effect.tryPromise(() => app.client.model.list({ workspace, provider: "unknown-provider" })),
      ).toEqual([])
      const unsupported = directory.find((entry) => !entry.integration && entry.modelCount > 0)
      expect(unsupported).toBeDefined()
      if (!unsupported) return
      const rows = yield* Effect.tryPromise(() => app.client.model.list({ workspace, provider: unsupported.info.name }))
      expect(rows[0]?.unavailableReason).toBe("provider-inactive")
      const first = rows[0]
      if (!first) return
      const error = yield* app.workspace(
        { account: data.account },
        Catalog.Service.use((catalog) => catalog.model.requireExecution(first.info).pipe(Effect.flip)),
      )
      expect(error.reason).toBe("provider-inactive")
    }).pipe(Effect.scoped),
    { signal },
  )
}, 120_000)

test("a newly connected native provider executes a real Tool conversation and shared disable refuses execution", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const model = { provider: Provider.Name.make("groq"), id: "llama-3.3-70b-versatile" }
      yield* app.workspace(
        { account: data.account },
        Integration.Service.use((integration) =>
          integration.connection.key({ integrationID: Integration.ID.make("groq"), key: "fixture-groq-key" }),
        ),
      )
      const session = yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.create({ projectID: data.project.id, model })),
      )
      const script = yield* Chat.script(app, { ...data, session })
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.prompt({ sessionID: session.id, text: script.prompt })),
      )
      yield* app.llm.waitGate(script.gate)
      yield* app.llm.release(script.gate)
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.awaitIdle(session.id)),
      )
      yield* app.llm.settled(session.id, "title")
      yield* app.llm.verify()
      const account = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Catalog parity" }))
      const key = yield* Effect.tryPromise(() =>
        app.client.serviceAccount.key.create({ id: account.id, name: "Parity key" }),
      )
      const discover = () =>
        Effect.tryPromise(async () => {
          const response = await fetch(new URL("/inference/openai/v1/models", app.origin), {
            headers: { authorization: `Bearer ${key.secret}` },
          })
          expect(response.status).toBe(200)
          return response.json()
        })
      expect(yield* discover()).toMatchObject({
        data: expect.arrayContaining([expect.objectContaining({ id: `groq/${model.id}` })]),
      })
      yield* Effect.tryPromise(() =>
        app.client.model.toggle({ workspace: data.owner.properties.workspaceID, ...model, enabled: false }),
      )
      const error = yield* app.workspace(
        { account: data.account },
        Catalog.Service.use((catalog) => catalog.model.requireExecution(model).pipe(Effect.flip)),
      )
      expect(error.reason).toBe("unavailable")
      expect(yield* discover()).not.toMatchObject({
        data: expect.arrayContaining([expect.objectContaining({ id: `groq/${model.id}` })]),
      })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("Workspace plugin custom Models execute through SDK chat and Gateway using effective overrides", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* TestLLM.make()
      const app = {
        ...(yield* TestApp.make({
          plugins: [
            "-test.model",
            {
              package: fileURLToPath(new URL("../src/catalog-plugin.ts", import.meta.url)),
              options: { endpoint: llm.url, upstream: "effective-upstream" },
            },
          ],
        })),
        llm,
      }
      const data = yield* Chat.make(app)
      const workspace = data.owner.properties.workspaceID
      yield* Effect.tryPromise(() =>
        app.client.integration.connect.key({
          workspace,
          integrationID: Integration.ID.make("deepseek"),
          key: "fixture-key",
          scope: "workspace",
        }),
      )
      const model = { provider: Provider.Name.make("fixture-custom"), id: "custom" }
      const rows = yield* Effect.tryPromise(() => app.client.model.list({ workspace, provider: model.provider }))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ info: { name: "Plugin Custom", apiID: "effective-upstream" }, enabled: true })
      expect(rows[0]?.unavailableReason).toBeUndefined()
      expect(rows[0]?.info.limit).toEqual({})
      expect(rows[0]?.info.capabilities.reasoning).toBeUndefined()
      expect(rows[0]?.info.cost.input).toBeUndefined()
      expect(JSON.stringify(rows)).not.toContain("fixture-key")
      yield* app.workspace(
        { account: data.account },
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const plan = yield* catalog.model.requireExecution({ ...model, variant: "alternate" })
          expect(plan.selection.options).toEqual({ reasoningEffort: "high" })
          expect(plan.selection.format).toBe("oa-compat")
          expect(plan.routing).toEqual({ type: "fixed", baseURL: new URL(app.llm.url) })
          const native = yield* (yield* ModelResolver.Service).native(plan)
          expect(Redacted.value(native.headers)["x-fixture-key"] === "fixture-key").toBe(true)
          const failure = yield* catalog.model.requireExecution({ ...model, variant: "missing" }).pipe(Effect.flip)
          expect(failure.reason).toBe("unavailable")
        }),
      )
      const agent = yield* Effect.tryPromise(() =>
        app.client.agent.create({
          id: Agent.ID.make("catalog-custom"),
          name: Agent.Name.make("Catalog custom"),
          model,
          instructions: "",
          mode: "subagent",
          hidden: false,
          steps: null,
          permissions: [],
        }),
      )
      const session = yield* Effect.tryPromise(() =>
        app.client.session.create({ projectID: data.project.id, model, agent: agent.id }),
      )
      const script = yield* Chat.script(app, { ...data, session })
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: session.id, text: script.prompt }))
      yield* app.llm.waitGate(script.gate)
      yield* app.llm.release(script.gate)
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.awaitIdle(session.id)),
      )
      yield* app.llm.settled(session.id, "title")
      expect(
        (yield* app.llm.list()).filter((request) => request.purpose === "assistant").map((request) => request.model),
      ).toEqual(["effective-upstream", "effective-upstream"])
      expect(
        (yield* app.llm.list())
          .filter((request) => request.purpose === "assistant")
          .map((request) => request.reasoning_effort),
      ).toEqual(["medium", "medium"])
      const compatible = { provider: Provider.Name.make("deepseek"), id: "deepseek-v4-flash" }
      const other = yield* Effect.tryPromise(() =>
        app.client.session.create({ projectID: data.project.id, model: compatible }),
      )
      const otherScript = yield* Chat.script(app, { ...data, session: other })
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: other.id, text: otherScript.prompt }))
      yield* app.llm.waitGate(otherScript.gate)
      yield* app.llm.release(otherScript.gate)
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.awaitIdle(other.id)),
      )
      yield* app.llm.settled(other.id, "title")
      expect(
        (yield* app.llm.list())
          .filter((request) => request.sessionID === other.id)
          .every((request) => request.model === compatible.id),
      ).toBe(true)
      const service = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Custom catalog" }))
      const key = yield* Effect.tryPromise(() =>
        app.client.serviceAccount.key.create({ id: service.id, name: "Gateway" }),
      )
      const headers = {
        authorization: `Bearer ${key.secret}`,
        "content-type": "application/json",
        "x-bm-test-session": session.id,
        "x-bm-test-purpose": "generate",
      }
      const invoke = (id: string) =>
        Effect.tryPromise(async () => {
          const response = await fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers,
            body: JSON.stringify({ model: id, stream: true, messages: [{ role: "user", content: "Gateway custom" }] }),
          })
          return { status: response.status, body: await response.text() }
        })
      yield* app.llm.expect(session.id, "generate", [
        {
          expect: (request) => {
            expect(request.model).toBe("effective-upstream")
            expect(request.reasoning_effort).toBe("medium")
          },
          response: { type: "success", events: [{ text: "Custom Gateway answer" }] },
        },
      ])
      const reply = yield* invoke("fixture-custom/custom")
      expect(reply.status, reply.body).toBe(200)
      expect(reply.body).toContain("Custom Gateway answer")
      // A previously unintegrated compatible Provider uses the same effective endpoint in Gateway.
      yield* app.llm.expect(session.id, "generate", [
        {
          expect: (request) => expect(request.model).toBe("deepseek-v4-flash"),
          response: { type: "success", events: [{ text: "Compatible Gateway answer" }] },
        },
      ])
      expect((yield* invoke("deepseek/deepseek-v4-flash")).status).toBe(200)
      yield* Effect.tryPromise(() => app.client.model.toggle({ workspace, ...model, enabled: false }))
      expect((yield* invoke("fixture-custom/custom")).status).toBe(404)
      yield* Effect.tryPromise(() =>
        expect(app.client.session.generate({ sessionID: session.id, prompt: "Must be refused" })).rejects.toBeDefined(),
      )
      yield* Effect.tryPromise(() => app.client.model.toggle({ workspace, ...compatible, enabled: false }))
      expect((yield* invoke("deepseek/deepseek-v4-flash")).status).toBe(404)
      yield* Effect.tryPromise(() =>
        expect(app.client.session.generate({ sessionID: other.id, prompt: "Must be refused" })).rejects.toBeDefined(),
      )
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
}, 90_000)
