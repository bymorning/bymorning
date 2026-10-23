import { Session } from "@bymorning/core/session"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

test("SDK usage accumulates completed model turns while an unfinished turn contributes nothing", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const script = yield* Chat.script(app, data)
      const get = () => Effect.tryPromise(() => app.client.session.get({ sessionID: data.session.id }))
      const messages = () =>
        Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id, order: "asc" }))

      expect((yield* get()).usage.tokens).toMatchObject({ input: 0, output: 0 })
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }))
      // Receipt of the next request proves the first model turn and real Tool have completed.
      yield* app.llm.waitGate(script.gate)
      const pending = yield* get()
      expect(pending.usage.tokens).toEqual({
        total: 15,
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      })
      const before = (yield* messages()).data.filter((message) => message.type === "assistant")
      expect(before).toHaveLength(2)
      expect(before[0]?.usage?.tokens).toMatchObject({ total: 15, input: 10, output: 5 })
      expect(before[1]?.usage?.tokens).toMatchObject({ input: 0, output: 0 })

      yield* app.llm.release(script.gate)
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
      )
      yield* app.llm.settled(data.session.id, "title")
      const completed = yield* get()
      const after = (yield* messages()).data.filter((message) => message.type === "assistant")
      expect(after).toHaveLength(2)
      expect(after[0]?.usage).toEqual(before[0]?.usage)
      expect(after[1]?.usage?.tokens).toMatchObject({ total: 18, input: 12, output: 6 })
      expect(completed.usage.tokens).toEqual({
        total: 33,
        input: 22,
        output: 11,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      })
      expect(completed.usage.cost).toBeCloseTo(after.reduce((total, message) => total + (message.usage?.cost ?? 0), 0), 12)
      expect(completed.usage.cost).toBeGreaterThan(pending.usage.cost)
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
})
