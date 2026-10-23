import { Bus } from "@bymorning/core/bus"
import { Session } from "@bymorning/core/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Effect, Option, Stream } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

test("a Workspace spend budget refuses Session inference before the model is called", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspace = data.owner.properties.workspaceID
        yield* Effect.tryPromise(() => app.client.budget.limit({ workspace, target: { type: "workspace" }, amount: 0 }))

        yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: "Budget refusal" }),
        )
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        expect(yield* app.llm.list()).toEqual([])
        const status = yield* Effect.tryPromise(() => app.client.budget.status({ workspace }))
        expect(status.standings.find(({ target }) => target.type === "workspace")).toMatchObject({ spent: 0, limit: 0 })
      }),
    ),
    { signal },
  )
})

test("a member spend budget refuses Session inference while the Workspace stays unlimited", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspace = data.owner.properties.workspaceID
        yield* Effect.tryPromise(() =>
          app.client.budget.limit({
            workspace,
            target: { type: "user", userID: data.owner.properties.userID },
            amount: 0,
          }),
        )

        yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: "Budget refusal" }),
        )
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        expect(yield* app.llm.list()).toEqual([])
        const status = yield* Effect.tryPromise(() => app.client.budget.status({ workspace }))
        const member = status.standings.find(({ target }) => target.type === "user")
        expect(member).toMatchObject({ spent: 0, limit: 0 })
        const workspaceStanding = status.standings.find(({ target }) => target.type === "workspace")
        expect(workspaceStanding).toMatchObject({ spent: 0 })
        expect("limit" in (workspaceStanding ?? {})).toBe(false)
      }),
    ),
    { signal },
  )
})

test("an exhausted Budget refuses the judge, falls back to the default Tier, and refuses the turn", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const general = Model.Ref.make({ provider: Provider.Name.make("auto"), id: "general" })
        const fast = Chat.model
        const deep = Chat.routedModel
        const config = yield* Effect.tryPromise(() => app.client["api.config"].get())
        yield* Effect.tryPromise(() =>
          app.client["api.config"].update({
            ...config,
            routing: [
              {
                match: { model: general },
                to: {
                  tiers: [
                    { name: "fast", model: fast, description: "Short factual questions" },
                    { name: "deep", model: deep, description: "Multi-step work that reads files" },
                  ],
                  default: "fast",
                  judge: { model: fast, timeout: 10_000 },
                },
              },
            ] as typeof config.routing,
          }),
        )
        yield* Effect.tryPromise(() => app.client.session.switchModel({ sessionID: data.session.id, model: general }))
        const workspace = data.owner.properties.workspaceID
        yield* Effect.tryPromise(() => app.client.budget.limit({ workspace, target: { type: "workspace" }, amount: 0 }))

        yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: "Budget refusal" }),
        )
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )

        // The judge's reservation is refused before the model is called, and so is the assistant's.
        expect(yield* app.llm.list()).toEqual([])
        const messages = yield* Effect.tryPromise(() =>
          app.client.message.list({ sessionID: data.session.id, order: "asc" }),
        )
        const [failed] = messages.data.filter((message) => message.type === "assistant")
        // Routing recorded its degraded decision on the turn...
        expect(failed).toMatchObject({
          model: fast,
          requestedModel: general,
          route: { cause: "fallback", fallback: "error", rule: 0, tier: "fast" },
        })
        // ...and the exhausted Budget refused the inference with the normal spend-limit error.
        expect(JSON.stringify(failed?.error)).toContain("spend limit")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("a positive member spend budget admits the first prompt and its concurrent title request", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const script = yield* Chat.script(app, data)
        const workspace = data.owner.properties.workspaceID
        yield* Effect.tryPromise(() =>
          app.client.budget.limit({
            workspace,
            target: { type: "user", userID: data.owner.properties.userID },
            amount: 10_000,
          }),
        )

        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
        yield* app.llm.waitGate(script.gate)
        yield* app.llm.release(script.gate)
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        yield* app.llm.settled(data.session.id, "title")

        const messages = yield* Effect.tryPromise(() =>
          app.client.message.list({ sessionID: data.session.id, order: "asc" }),
        )
        const assistant = messages.data.filter((message) => message.type === "assistant")
        expect(assistant.length).toBeGreaterThan(0)
        expect(messages.data.some((message) => JSON.stringify(message).includes("spend limit"))).toBe(false)
        const status = yield* Effect.tryPromise(() => app.client.budget.status({ workspace }))
        const member = status.standings.find(({ target }) => target.type === "user")
        expect(member?.limit).toBe(10_000)
        expect(member?.spent ?? 0).toBeGreaterThan(0)
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("an exhausted Workspace budget refusal names the budget, live, for the first prompt and a follow-up", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspace = data.owner.properties.workspaceID
        yield* Effect.tryPromise(() => app.client.budget.limit({ workspace, target: { type: "workspace" }, amount: 0 }))
        const bus = yield* app.workspace({ account: data.account }, Bus.Service)

        const refusal = Effect.fn("refusal")(function* (text: string) {
          // The subscription buffers from this point, so the event cannot be missed.
          const failures = yield* bus.subscribe([SessionEvent.Failed])
          yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text }))
          const event = yield* failures.pipe(
            Stream.filter((item) => item.data.sessionID === data.session.id),
            Stream.runHead,
          )
          if (Option.isNone(event)) throw new Error("No live failure event")
          return event.value.data.error
        })

        for (const text of ["First prompt", "Follow-up prompt"]) {
          const error = yield* refusal(text)
          expect(error).toMatchObject({ _tag: "SessionError.ProviderError", category: "quota" })
          const message = JSON.stringify(error)
          expect(message).toContain("Workspace budget reached")
          expect(message).not.toContain("Inference spend limit exceeded")
          expect(message.toLowerCase()).not.toContain("provider quota")
          yield* app.workspace(
            { account: data.account },
            Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
          )
        }
        expect(yield* app.llm.list()).toEqual([])
      }),
    ),
    { signal },
  )
})
