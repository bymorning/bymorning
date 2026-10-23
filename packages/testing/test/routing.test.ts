import { expect, test } from "vitest"
import { Effect } from "effect"
import { Session } from "@bymorning/core/session"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

const general = Model.Ref.make({ provider: Provider.Name.make("auto"), id: "general" })
const fast = Chat.model
const deep = Chat.routedModel

/** Two described Tiers over the fixture Provider; the cheap Tier also judges. */
const tiers = {
  match: { model: general },
  to: {
    tiers: [
      { name: "fast", model: fast, description: "Short factual questions and small edits" },
      { name: "deep", model: deep, description: "Multi-step work that reads files or reasons carefully" },
    ],
    default: "fast",
    judge: { model: fast, timeout: 10_000 },
  },
}

const idle = (app: TestApp.Interface, data: Chat.Data) =>
  app.workspace({ account: data.account }, Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)))

const configure = (app: TestApp.Interface, routing: ReadonlyArray<unknown>) =>
  Effect.gen(function* () {
    const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
    return yield* Effect.tryPromise(() =>
      app.client["api.config"].update({ ...current, routing: routing as typeof current.routing }),
    )
  })

/** Route the fixture Session through the Auto name. */
const useAuto = (app: TestApp.Interface, data: Chat.Data) =>
  Effect.tryPromise(() => app.client.session.switchModel({ sessionID: data.session.id, model: general }))

const assistants = (app: TestApp.Interface, data: Chat.Data) =>
  Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id, order: "asc" })).pipe(
    Effect.map((messages) => messages.data.filter((message) => message.type === "assistant")),
  )

test("an Auto name is judged once per participant turn and holds through the Tool loop", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* configure(app, [tiers])
        yield* useAuto(app, data)
        expect(yield* Effect.tryPromise(() => app.client.model.auto())).toEqual([general])

        const script = yield* Chat.script(app, data)
        yield* app.llm.expect(data.session.id, "route", [
          {
            expect: (request) => {
              expect(request.model).toBe(fast.id)
              expect(request.tools ?? []).toEqual([])
              const text = JSON.stringify(request.messages)
              expect(text).toContain(script.prompt)
              expect(text).toContain("- fast:")
              expect(text).toContain("- deep:")
            },
            response: { type: "success", events: [{ text: '{"tier": "deep"}' }], usage: { input: 77, output: 3 } },
          },
        ])
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
        yield* app.llm.waitGate(script.gate)
        yield* app.llm.release(script.gate)
        yield* idle(app, data)
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()

        const requests = yield* app.llm.list()
        expect(requests.filter((request) => request.purpose === "route")).toHaveLength(1)
        const turn = requests.filter((request) => request.purpose === "assistant")
        expect(turn).toHaveLength(2)
        for (const request of turn) expect(request.model).toBe(deep.id)
        // Titles never call the judge; they use the matched rule's default Tier.
        for (const request of requests.filter((request) => request.purpose === "title"))
          expect(request.model).toBe(fast.id)

        const recorded = yield* assistants(app, data)
        expect(recorded[0]).toMatchObject({ model: deep, requestedModel: general, route: { cause: "judge", rule: 0, tier: "deep" } })
        expect(recorded.at(-1)).toMatchObject({ model: deep, requestedModel: general, route: { cause: "judge", tier: "deep" } })

        // The judge is its own Session inference: priced and recorded like any other.
        const usage = yield* Effect.tryPromise(() => app.client.usage.records())
        expect(usage.data).toContainEqual(
          expect.objectContaining({ source: "session", usage: expect.objectContaining({ tokens: expect.objectContaining({ input: 77, output: 3 }) }) }),
        )
      }),
    ),
    { signal },
  )
})

test("a failing judge falls back to the default Tier without failing the turn", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* configure(app, [tiers])
        yield* useAuto(app, data)
        const script = yield* Chat.script(app, data)
        yield* app.llm.expect(data.session.id, "route", [
          { expect: () => {}, response: { type: "success", events: [{ text: "Probably the deep one?" }] } },
        ])
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
        yield* app.llm.waitGate(script.gate)
        yield* app.llm.release(script.gate)
        yield* idle(app, data)
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
        for (const request of (yield* app.llm.list()).filter((request) => request.purpose === "assistant"))
          expect(request.model).toBe(fast.id)
        expect((yield* assistants(app, data))[0]).toMatchObject({
          model: fast,
          route: { cause: "fallback", fallback: "invalid", tier: "fast" },
        })
      }),
    ),
    { signal },
  )
})

test("an Auto name with no matching rule fails the turn with a routing error", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* useAuto(app, data)
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: "hello" }))
        yield* idle(app, data)
        expect((yield* app.llm.list()).filter((request) => request.purpose === "assistant")).toEqual([])
        const [failed] = yield* assistants(app, data)
        expect(JSON.stringify(failed?.error)).toContain("No routing rule matches Auto name general")
      }),
    ),
    { signal },
  )
})

test("invalid routing writes are refused before they are saved", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        yield* Chat.make(app)
        const invalid = yield* configure(app, [
          { ...tiers, to: { ...tiers.to, default: "missing", judge: { model: general } } },
        ]).pipe(Effect.flip)
        const refusal = JSON.stringify(invalid.cause)
        expect(refusal).toContain("Default Tier missing is not one of the Tiers")
        expect(refusal).toContain("Judge Model cannot be an Auto name")
        expect((yield* Effect.tryPromise(() => app.client["api.config"].get())).routing).toBeUndefined()
      }),
    ),
    { signal },
  )
})
