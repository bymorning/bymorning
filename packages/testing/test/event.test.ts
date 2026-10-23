import { Effect, Option, Stream } from "effect"
import type { Workspace } from "@bymorning/schema/workspace"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

const workspaceEvents = (app: TestApp.Interface, workspace: Workspace.ID) =>
  Stream.fromAsyncIterable(
    app.client.event.subscribe({ workspace }),
    (cause) => new TestApp.RequestError({ message: "Workspace Event stream failed", cause }),
  )

const request = <A>(message: string, action: () => Promise<A>) =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => new TestApp.RequestError({ message, cause }),
  })

test("/api/event starts each authorized live stream with server.connected", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const item = yield* workspaceEvents(app, data.owner.properties.workspaceID).pipe(Stream.take(1), Stream.runHead)
        expect(Option.getOrThrow(item)).toMatchObject({ type: "server.connected", data: {} })
      }),
    ),
    { signal },
  )
})

test("a new volatile Event subscription rehydrates the current Session resources through SDK reads", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const script = yield* Chat.script(app, data)

        // The first connection deliberately observes only its connection marker. Closing a
        // volatile feed must not be mistaken for a durable-state loss.
        const first = yield* workspaceEvents(app, data.owner.properties.workspaceID).pipe(
          Stream.take(1),
          Stream.runHead,
        )
        expect(Option.getOrThrow(first).type).toBe("server.connected")
        const admitted = yield* request("Session prompt failed", () =>
          app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }),
        )
        yield* app.llm.waitGate(script.gate)

        const reconnected = yield* workspaceEvents(app, data.owner.properties.workspaceID).pipe(
          Stream.take(1),
          Stream.runHead,
        )
        expect(Option.getOrThrow(reconnected).type).toBe("server.connected")

        const [session, messages, inbox, active, permissions, forms] = yield* Effect.all([
          request("Session read failed", () => app.client.session.get({ sessionID: data.session.id })),
          request("Message list failed", () => app.client.message.list({ sessionID: data.session.id })),
          request("Session inbox read failed", () => app.client.session.inbox.list({ sessionID: data.session.id })),
          request("Active Session read failed", () => app.client.session.active()),
          request("Permission list failed", () => app.client.permission.list({ sessionID: data.session.id })),
          request("Form list failed", () => app.client.form.list({ sessionID: data.session.id })),
        ])
        expect(session).toMatchObject({ id: data.session.id, projectID: data.project.id })
        expect(messages.data).toContainEqual(expect.objectContaining({ id: admitted.id, text: script.prompt }))
        expect(inbox).toEqual([])
        expect(active).toHaveProperty(data.session.id)
        expect(permissions).toEqual([])
        expect(forms).toEqual([])

        yield* app.llm.release(script.gate)
        yield* request("Session wait failed", () => app.client.session.wait({ sessionID: data.session.id }))
        const saved = yield* request("Message list failed", () =>
          app.client.message.list({ sessionID: data.session.id }),
        )
        expect(saved.data).toContainEqual(
          expect.objectContaining({
            type: "assistant",
            content: expect.arrayContaining([expect.objectContaining({ text: script.answer })]),
          }),
        )
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("Event audiences and durable Message reads remain workspace-isolated", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const left = yield* TestApp.make()
        const right = yield* TestApp.make()
        const leftData = yield* Chat.make(left)
        const rightData = yield* Chat.make(right)

        const connected = yield* workspaceEvents(right, rightData.owner.properties.workspaceID).pipe(
          Stream.take(1),
          Stream.runHead,
        )
        expect(Option.getOrThrow(connected).type).toBe("server.connected")

        const missing = yield* request("Message list failed", () =>
          right.client.message.list({ sessionID: leftData.session.id }),
        ).pipe(Effect.flip)
        expect(missing.cause).toMatchObject({ _tag: "Session.NotFoundError" })
        expect(
          yield* request("Message list failed", () => right.client.message.list({ sessionID: rightData.session.id })),
        ).toMatchObject({ data: [] })
      }),
    ),
    { signal },
  )
})

test("Message list has a default page, cursor traversal, and rejects cursors under another order", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const script = yield* Chat.script(app, data)
        yield* request("Session prompt failed", () =>
          app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }),
        )
        yield* app.llm.waitGate(script.gate)
        yield* app.llm.release(script.gate)
        yield* request("Session wait failed", () => app.client.session.wait({ sessionID: data.session.id }))

        const defaults = yield* request("Message list failed", () =>
          app.client.message.list({ sessionID: data.session.id }),
        )
        expect(defaults.data.length).toBeGreaterThanOrEqual(2)
        const newest = yield* request("Message list failed", () =>
          app.client.message.list({ sessionID: data.session.id, order: "desc", limit: 1 }),
        )
        expect(newest.data).toHaveLength(1)
        expect(newest.cursor.previous).toBeUndefined()
        expect(newest.cursor.next).toEqual(expect.any(String))
        const next = yield* request("Message list failed", () =>
          app.client.message.list({ sessionID: data.session.id, order: "desc", limit: 1, cursor: newest.cursor.next! }),
        )
        expect(next.data).toHaveLength(1)
        expect(next.data[0]?.id).not.toBe(newest.data[0]?.id)
        expect(next.cursor.previous).toEqual(expect.any(String))
        const previous = yield* request("Message list failed", () =>
          app.client.message.list({ sessionID: data.session.id, order: "desc", limit: 1, cursor: next.cursor.previous! }),
        )
        expect(previous.data).toEqual(newest.data)
        const invalid = yield* request("Message list failed", () =>
          app.client.message.list({ sessionID: data.session.id, order: "asc", limit: 1, cursor: newest.cursor.next! }),
        ).pipe(Effect.flip)
        expect(invalid.cause).toMatchObject({ _tag: "Session.InvalidCursorError" })
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})
