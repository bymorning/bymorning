import { expect, test } from "vitest"
import { Effect } from "effect"
import { Session } from "@bymorning/core/session"
import { Provider } from "@bymorning/schema/provider"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

/** A second Catalog Model on the fixture Provider; the fixture plugin still sends it to TestLLM. */
const routed = Chat.routedModel

const idle = (app: TestApp.Interface, data: Chat.Data) =>
  app.workspace(
    { account: data.account },
    Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
  )

const configure = (
  app: TestApp.Interface,
  patch: {
    readonly providers?: { readonly allow?: ReadonlyArray<Provider.Name> }
    readonly routing?: ReadonlyArray<
      | { readonly from: typeof Chat.model; readonly to: typeof routed }
      | { readonly when: { readonly tool: string }; readonly to: typeof routed }
    >
  },
) =>
  Effect.gen(function* () {
    const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
    return yield* Effect.tryPromise(() => app.client["api.config"].update({ ...current, ...patch }))
  })

const completeRead = (
  app: TestApp.Interface,
  data: Chat.Data,
  script: { prompt: string; answer: string; gate: string },
) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
    yield* app.llm.waitGate(script.gate)
    yield* app.llm.release(script.gate)
    yield* idle(app, data)
    const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
    expect(
      messages.data.filter((message) => message.type === "assistant").flatMap((message) => message.content),
    ).toContainEqual(expect.objectContaining({ type: "text", text: script.answer }))
    yield* app.llm.settled(data.session.id, "title")
    yield* app.llm.verify()
  })

test("PUT/GET persists providers.allow and routing while default_model stays not client-writable", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
        expect(current.providers).toBeUndefined()
        expect(current.routing).toBeUndefined()
        expect(current.default_model).toEqual(Chat.model)

        const attemptedDefault = { provider: Provider.OpenAI, id: "gpt-5.6" }
        const payload = {
          ...current,
          default_model: attemptedDefault,
          providers: { allow: [Provider.OpenCode] },
          routing: [{ from: Chat.model, to: routed }],
        }
        const updated = yield* Effect.tryPromise(() => app.client["api.config"].update(payload))
        expect(updated.providers).toEqual({ allow: [Provider.OpenCode] })
        // Legacy rules still decode; writers emit the current Match shape.
        expect(updated.routing).toEqual([{ match: { model: Chat.model }, to: routed }])
        expect(updated.default_model).toEqual(Chat.model)
        expect(updated.default_model).not.toEqual(attemptedDefault)

        const got = yield* Effect.tryPromise(() => app.client["api.config"].get())
        expect(got.providers).toEqual({ allow: [Provider.OpenCode] })
        expect(got.routing).toEqual([{ match: { model: Chat.model }, to: routed }])
        expect(got.default_model).toEqual(Chat.model)
        expect(data.session.model).toEqual(Chat.model)
      }),
    ),
    { signal },
  )
})

test("omitted providers admits Chat.script read", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        expect((yield* Effect.tryPromise(() => app.client["api.config"].get())).providers).toBeUndefined()
        const script = yield* Chat.script(app, data)
        yield* completeRead(app, data, script)
      }),
    ),
    { signal },
  )
})

test("empty providers.allow refuses Session inference before the model is called", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* configure(app, { providers: { allow: [] } })
        yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: "Refuse inference" }),
        )
        yield* idle(app, data)
        expect(yield* app.llm.list()).toEqual([])
      }),
    ),
    { signal },
  )
})

test("providers.allow excluding bymorning refuses Session inference", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* configure(app, { providers: { allow: [Provider.OpenAI] } })
        yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: "Refuse inference" }),
        )
        yield* idle(app, data)
        expect(yield* app.llm.list()).toEqual([])
      }),
    ),
    { signal },
  )
})

test("providers.allow including bymorning admits Chat.script read", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* configure(app, { providers: { allow: [Provider.OpenCode] } })
        const script = yield* Chat.script(app, data)
        yield* completeRead(app, data, script)
      }),
    ),
    { signal },
  )
})

test("routing from remaps Chat.model for this request", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* configure(app, { routing: [{ from: Chat.model, to: routed }] })
        const script = yield* Chat.script(app, data)
        yield* completeRead(app, data, script)
        for (const request of yield* app.llm.list()) expect(request.model).toBe(routed.id)
        const assistants = (yield* Effect.tryPromise(() =>
          app.client.message.list({ sessionID: data.session.id }),
        )).data.filter((message) => message.type === "assistant")
        expect(assistants.length).toBeGreaterThan(0)
        for (const message of assistants) {
          expect(message.model).toEqual(routed)
          expect(message.requestedModel).toEqual(Chat.model)
        }
      }),
    ),
    { signal },
  )
})

test("routing when.tool remaps the next participant turn after read completes, never mid-turn", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* configure(app, { routing: [{ when: { tool: "read" }, to: routed }] })
        const script = yield* Chat.script(app, data)
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
        yield* app.llm.waitGate(script.gate)
        yield* app.llm.release(script.gate)
        yield* idle(app, data)
        yield* app.llm.settled(data.session.id, "title")

        // The whole first turn, including the step after `read` completes, stays on the turn's Model.
        const first = (yield* app.llm.list()).filter((request) => request.purpose === "assistant")
        expect(first.length).toBeGreaterThan(1)
        for (const request of first) expect(request.model).toBe(Chat.model.id)

        const secondPrompt = "What did the file say?"
        const secondAnswer = `It said ${data.content}.`
        yield* app.llm.expect(data.session.id, "assistant", [
          {
            expect: (request) => {
              expect(request.model).toBe(routed.id)
              expect(
                request.messages.some(
                  (message) => message.role === "user" && JSON.stringify(message.content).includes(secondPrompt),
                ),
              ).toBe(true)
            },
            response: { type: "success", events: [{ text: secondAnswer }], usage: { input: 8, output: 4 } },
          },
        ])
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: secondPrompt }))
        yield* idle(app, data)
        const messages = yield* Effect.tryPromise(() =>
          app.client.message.list({ sessionID: data.session.id, order: "asc" }),
        )
        const assistants = messages.data.filter((message) => message.type === "assistant")
        expect(assistants[0]).toMatchObject({ model: Chat.model })
        expect(assistants[0]?.requestedModel).toBeUndefined()
        expect(assistants.at(-1)).toMatchObject({
          model: routed,
          requestedModel: Chat.model,
          route: { cause: "rule", rule: 0 },
        })
        expect(assistants.flatMap((message) => message.content)).toContainEqual(
          expect.objectContaining({ type: "text", text: secondAnswer }),
        )
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("empty providers.allow denies LLM Gateway inference", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const serviceAccount = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.create({ name: "Providers fixture" }),
        )
        const apiKey = yield* Effect.tryPromise(() =>
          app.client.serviceAccount.key.create({ id: serviceAccount.id, name: "Inference" }),
        )
        yield* configure(app, { providers: { allow: [] } })
        const response = yield* Effect.tryPromise(() =>
          fetch(new URL("/inference/openai/v1/chat/completions", app.origin), {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey.secret}`, "content-type": "application/json" },
            body: JSON.stringify({
              model: `${data.session.model.provider}/${data.session.model.id}`,
              messages: [{ role: "user", content: "hello" }],
            }),
          }),
        )
        expect(response.status).toBe(403)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          error: { type: "permission_error" },
        })
        expect(yield* app.llm.list()).toEqual([])
      }),
    ),
    { signal },
  )
})
