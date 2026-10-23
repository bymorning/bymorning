import { ByMorning } from "@bymorning/client"
import { Session } from "@bymorning/core/session"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

test("the generated SDK requires real login and reads persisted scenario data with normal cookies", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const anonymous = ByMorning.make({ baseUrl: app.origin.href })
        const denied = yield* Effect.tryPromise(() => anonymous.workspace.list()).pipe(Effect.flip)
        expect(denied.cause).toMatchObject({ _tag: "UnauthorizedError" })

        const data = yield* Chat.make(app, { path: "sdk-notes.txt", content: "Stored by the backend scenario." })
        const workspace = data.owner.properties.workspaceID
        const workspaces = yield* Effect.tryPromise(() => app.client.workspace.list())
        expect(workspaces).toContainEqual(expect.objectContaining({ id: workspace, role: "admin" }))
        const project = yield* Effect.tryPromise(() =>
          app.client.project.get({ projectID: data.project.id, workspace }),
        )
        expect(project).toMatchObject({ id: data.project.id, name: "Conversation fixture" })
        const file = yield* Effect.tryPromise(() =>
          app.client.project.directory.read({ projectID: data.project.id, path: data.path, workspace }),
        )
        expect(new TextDecoder().decode(file)).toBe(data.content)
        const session = yield* Effect.tryPromise(() => app.client.session.get({ sessionID: data.session.id }))
        expect(session).toMatchObject({ id: data.session.id, projectID: data.project.id, model: Chat.model })
        expect(session.createdAt).toBeInstanceOf(Date)

        const renamed = yield* Effect.tryPromise(() =>
          app.client.project.update({ projectID: data.project.id, workspace, name: "Renamed through the SDK" }),
        )
        expect(renamed.name).toBe("Renamed through the SDK")
        const fresh = yield* Effect.tryPromise(() => app.client.project.get({ projectID: data.project.id, workspace }))
        expect(fresh.name).toBe("Renamed through the SDK")
        const stillDenied = yield* Effect.tryPromise(() => anonymous.session.get({ sessionID: data.session.id })).pipe(
          Effect.flip,
        )
        expect(stillDenied.cause).toMatchObject({ _tag: "UnauthorizedError" })

        yield* Effect.tryPromise(() => app.client.auth.logout())
        const loggedOut = yield* Effect.tryPromise(() => app.client.workspace.list()).pipe(Effect.flip)
        expect(loggedOut.cause).toMatchObject({ _tag: "UnauthorizedError" })
        yield* app.login()
        expect(
          yield* Effect.tryPromise(() => app.client.project.get({ projectID: data.project.id, workspace })),
        ).toEqual(fresh)
      }),
    ),
    { signal },
  )
})

test("the SDK receives real Tool failure events, persisted errors and the model's response to the actual failure", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const script = yield* Chat.script(app, data, "missing")
        const ready = yield* Deferred.make<void, TestApp.RequestError>()
        const events = yield* Stream.fromAsyncIterable(
          app.client.event.subscribe({ workspace: data.owner.properties.workspaceID }),
          (cause) => new TestApp.RequestError({ message: "SDK Session event stream failed", cause }),
        ).pipe(
          Stream.tap((event) => (event.type === "server.connected" ? Deferred.succeed(ready, undefined) : Effect.void)),
          Stream.takeUntil(
            (event) =>
              "data" in event &&
              "sessionID" in event.data &&
              event.data.sessionID === data.session.id &&
              event.type === "session.tool.failed",
          ),
          Stream.runCollect,
          Effect.tapError((error) => Deferred.fail(ready, error)),
          Effect.tap(() =>
            Deferred.fail(ready, new TestApp.RequestError({ message: "SDK Session stream ended before readiness" })),
          ),
          Effect.forkScoped,
        )
        yield* Deferred.await(ready)
        const admitted = yield* Effect.tryPromise(() =>
          app.client.session.prompt({ sessionID: data.session.id, text: script.prompt }),
        )
        expect(admitted).toMatchObject({ sessionID: data.session.id, text: script.prompt })
        expect(admitted.createdAt).toBeInstanceOf(Date)

        yield* app.llm.waitGate(script.gate)
        const active = yield* Effect.tryPromise(() =>
          app.client.message.list({ sessionID: data.session.id }),
        )
        const failed = active.data
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .find((part) => part.type === "tool" && part.id === "read-1")
        expect(failed).toMatchObject({
          type: "tool",
          name: "read",
          state: {
            status: "error",
            input: { path: "missing.txt" },
            error: { message: expect.stringContaining("not found") },
          },
        })
        yield* app.llm.release(script.gate)

        const observed = yield* Fiber.join(events)
        expect(observed.at(-1)?.type).toBe("session.tool.failed")
        expect(observed).toContainEqual(
          expect.objectContaining({
            type: "session.tool.failed",
            data: expect.objectContaining({
              callID: "read-1",
              name: "read",
              error: expect.objectContaining({ message: expect.stringContaining("not found") }),
            }),
          }),
        )
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        const messages = yield* Effect.tryPromise(() =>
          app.client.message.list({ sessionID: data.session.id }),
        )
        expect(messages.data).toContainEqual(
          expect.objectContaining({ type: "user", id: admitted.id, text: script.prompt }),
        )
        const parts = messages.data.flatMap((message) => (message.type === "assistant" ? message.content : []))
        expect(parts).toContainEqual(expect.objectContaining({ type: "text", text: script.answer }))
        expect(parts).toContainEqual(failed)
        expect(
          yield* Effect.tryPromise(() =>
            app.client.message.list({ sessionID: data.session.id }),
          ),
        ).toEqual(messages)
        const requests = yield* app.llm.list()
        const followup = requests.filter(
          (request) => request.sessionID === data.session.id && request.purpose === "assistant",
        )[1]
        expect(followup?.messages).toContainEqual(
          expect.objectContaining({
            role: "tool",
            tool_call_id: "read-1",
            content: expect.stringContaining("not found"),
          }),
        )
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})
