import { expect, test } from "vitest"
import { Effect, Option, Stream } from "effect"
import { Bus } from "@bymorning/core/bus"
import { Command } from "@bymorning/core/command"
import { Session } from "@bymorning/core/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Session as SessionSchema } from "@bymorning/schema/session"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

test("a real Session executes read and gives its persisted result to the model", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const script = yield* Chat.script(app, data)
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.prompt({ sessionID: data.session.id, text: script.prompt })),
        )
        yield* app.llm.waitGate(script.gate)
        yield* app.llm.release(script.gate)
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
        const assistants = messages.data.filter((message) => message.type === "assistant")
        expect(assistants.flatMap((message) => message.content)).toContainEqual(
          expect.objectContaining({
            type: "tool",
            id: "read-1",
            name: "read",
            state: expect.objectContaining({ status: "completed", input: { path: data.path } }),
          }),
        )
        expect(assistants.flatMap((message) => message.content)).toContainEqual(
          expect.objectContaining({ type: "text", text: script.answer }),
        )
        expect(assistants.every((message) => message.time.completed !== undefined)).toBe(true)
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("a provider authentication failure is persisted with its real category and status", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const script = yield* Chat.script(app, data, "provider")
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.prompt({ sessionID: data.session.id, text: script.prompt })),
        )
        yield* app.llm.settled(data.session.id, "assistant")
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
        expect(messages.data).toContainEqual(
          expect.objectContaining({
            type: "assistant",
            error: expect.objectContaining({ _tag: "SessionError.ProviderError", category: "auth", status: 401 }),
          }),
        )
        expect(
          yield* app.workspace(
            { account: data.account },
            Session.Service.use((sessions) => sessions.active),
          ),
        ).not.toContain(data.session.id)
        yield* app.llm.settled(data.session.id, "title")
      }),
    ),
    { signal },
  )
})

test("cancelling an observed stream persists partial text and interruption, then settles transport", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const script = yield* Chat.script(app, data, "cancel")
        const bus = yield* app.workspace({ account: data.account }, Bus.Service)
        const stream = yield* bus.subscribe([SessionEvent.TextDelta])
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.prompt({ sessionID: data.session.id, text: script.prompt })),
        )
        yield* stream.pipe(
          Stream.filter((event) => event.data.sessionID === data.session.id && event.data.text.includes(script.answer)),
          Stream.take(1),
          Stream.runDrain,
        )
        yield* app.llm.waitGate(script.gate)
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.interrupt(data.session.id, "user")),
        )
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        yield* app.llm.settled(data.session.id, "assistant")
        const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
        expect(messages.data).toContainEqual(
          expect.objectContaining({
            type: "assistant",
            error: expect.objectContaining({ _tag: "SessionError.AbortedError" }),
            content: expect.arrayContaining([expect.objectContaining({ type: "text", text: script.answer })]),
          }),
        )
        yield* app.llm.settled(data.session.id, "title")
      }),
    ),
    { signal },
  )
})

test("command interpolation uses the fixture directory", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const result = yield* app.workspace(
          { account: data.account },
          Command.Service.use((commands) =>
            Effect.gen(function* () {
              yield* commands.transform((editor) =>
                editor.update("location", (command) => {
                  command.template = "!`pwd`"
                }),
              )
              return yield* commands.evaluate({ name: "location" })
            }).pipe(Effect.scoped),
          ),
        )
        expect(result.text.trim()).toBe(app.directory)
      }),
    ),
    { signal },
  )
})

const generatedTitle = (rawTitle: string, prompt: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      yield* Chat.titled(app, data, { prompt, title: rawTitle })
      const bus = yield* app.workspace({ account: data.account }, Bus.Service)
      const updates = yield* bus.subscribe([SessionEvent.Updated])
      yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: prompt }))
      const updated = yield* updates.pipe(
        Stream.filter((event) => event.data.sessionID === data.session.id),
        Stream.runHead,
      )
      expect(Option.isSome(updated)).toBe(true)
      yield* app.workspace(
        { account: data.account },
        Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
      )
      yield* app.llm.settled(data.session.id, "title")
      yield* app.llm.verify()
      return (yield* Effect.tryPromise(() => app.client.session.get({ sessionID: data.session.id }))).title
    }),
  )

test("a title model reply that is only a code block falls back to the user's prompt", async ({ signal }) => {
  const title = await Effect.runPromise(
    generatedTitle("```mermaid\nflowchart LR\n  A --> B\n```", "Draw a flowchart A to B in a mermaid code block."),
    { signal },
  )
  expect(title).toBe("Draw a flowchart A to B in a")
})

test("a markdown-wrapped title reply is cleaned before it names the Session", async ({ signal }) => {
  const title = await Effect.runPromise(generatedTitle("**Title:** Foo", "Summarize the quarterly report"), { signal })
  expect(title).toBe("Foo")
})

test("archiving and restoring a Session keeps its updated time; a rename bumps it", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const other = yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.create({ projectID: data.project.id, model: Chat.model })),
        )
        const sessionID = data.session.id
        const read = () => Effect.tryPromise(() => app.client.session.get({ sessionID }))
        const before = yield* read()

        const archived = yield* Effect.tryPromise(() => app.client.session.update({ sessionID, archived: true }))
        expect(archived.archivedAt).toBeDefined()
        expect(archived.updatedAt).toEqual(before.updatedAt)
        const restored = yield* Effect.tryPromise(() => app.client.session.update({ sessionID, archived: false }))
        expect(restored.archivedAt).toBeUndefined()
        expect(restored.updatedAt).toEqual(before.updatedAt)
        expect((yield* read()).updatedAt).toEqual(before.updatedAt)

        // Archiving and restoring left the listed activity time untouched (no relative ordering on the real clock).
        const listed = yield* Effect.tryPromise(() => app.client.session.list({}))
        expect(listed.data.find((session) => session.id === sessionID)?.updatedAt).toEqual(before.updatedAt)
        expect(listed.data.some((session) => session.id === other.id)).toBe(true)

        const renamed = yield* Effect.tryPromise(() =>
          app.client.session.update({ sessionID, title: SessionSchema.Title.make("Renamed") }),
        )
        expect(renamed.title).toBe("Renamed")
        expect(renamed.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
        const reordered = yield* Effect.tryPromise(() => app.client.session.list({}))
        expect(reordered.data.map((session) => session.id)).toEqual([sessionID, other.id])
      }),
    ),
    { signal },
  )
})
