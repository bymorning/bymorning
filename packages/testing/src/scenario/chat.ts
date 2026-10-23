/** Shared persisted chat data and model scenarios for backend, SDK, and browser tests. */
export * as Chat from "./chat.js"

import { Config } from "@bymorning/core/config"
import { Integration } from "@bymorning/core/integration"
import { Project } from "@bymorning/core/project"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { Session } from "@bymorning/core/session"
import { Storage } from "@bymorning/core/storage"
import { AccountActor } from "@bymorning/schema/actor"
import type { Session as SessionSchema } from "@bymorning/schema/session"
import { Model } from "@bymorning/schema/model"
import { Provider } from "@bymorning/schema/provider"
import { Effect, Layer, Stream } from "effect"
import assert from "node:assert/strict"
import type { TestApp } from "../application.js"
import type { Request } from "../llm.js"

/** A shipped OpenAI-compatible model; the fixture routes its real transport locally. */
export const model = Model.Ref.make({ provider: Provider.OpenCode, id: "deepseek-v4-pro" })
/** A second shipped Model on the same Provider for routing scenarios. */
export const routedModel = Model.Ref.make({ provider: Provider.OpenCode, id: "glm-5.1" })

/** Provision and select a real owner, connect the model, and create a Project file and Session. */
export const make = Effect.fn("Chat.make")(function* (
  app: TestApp.Interface,
  options: { readonly path?: string; readonly content?: string } = {},
) {
  const owner = yield* app.login()
  const account = new AccountActor({ type: "account", properties: { accountID: owner.properties.accountID } })
  const file = yield* ProjectDirectory.parse(options.path ?? "notes.txt")
  const content = options.content ?? "hello"
  const project = yield* app.workspace(
    { account },
    Effect.gen(function* () {
      const integration = yield* Integration.Service
      yield* integration.connection.key({
        integrationID: Integration.ID.make(Provider.OpenCode),
        key: "test-fixture-key",
      })
      const config = yield* Config.Service
      yield* config.modelPolicy.setDefault(model, owner)
      return yield* (yield* Project.Service).create({ name: "Conversation fixture" })
    }),
  )
  const storage = yield* app.process(Storage.Service)
  yield* app.workspace(
    { account },
    ProjectDirectory.Service.use((directory) =>
      directory.write(file, {
        content: Stream.succeed(new TextEncoder().encode(content)),
        contentType: "text/plain",
      }),
    ).pipe(
      Effect.provide(
        ProjectDirectory.layer(owner.properties.workspaceID, project.id).pipe(
          Layer.provide(Layer.succeed(Storage.Service, storage)),
        ),
      ),
    ),
  )
  const session = yield* app.workspace(
    { account },
    Session.Service.use((sessions) => sessions.create({ projectID: project.id, model })),
  )
  return { owner, account, project, session, path: file, content }
})

/** Asserts that a model request carries `prompt` in a user message. */
const mentionsPrompt = (prompt: string) => (request: Request) =>
  assert.ok(
    request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes(prompt)),
    `The model request must include "${prompt}"`,
  )

/** Persisted identities returned by the shared chat scenario. */
export type Data = Effect.Success<ReturnType<typeof make>>

/** Register a deterministic Tool conversation, failure, or cancellation against those real identities. */
export const script = Effect.fn("Chat.script")(function* (
  app: TestApp.Interface,
  data: Data,
  kind: "read" | "missing" | "cancel" | "provider" = "read",
) {
  const prompt = kind === "missing" ? "Read missing.txt" : `Read ${data.path}`
  const answer = kind === "missing" ? "The file could not be read." : `The file says ${data.content}.`
  const gate = `${data.session.id}:${kind === "cancel" ? "cancel" : "answer"}`
  yield* app.llm.expect(data.session.id, "title", [
    {
      expect: (request) =>
        assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(prompt))),
      response: { type: "success", events: [{ text: "Read project notes" }] },
    },
  ])
  const expectPrompt = mentionsPrompt(prompt)
  if (kind === "cancel") {
    yield* app.llm.expect(data.session.id, "assistant", [
      {
        expect: expectPrompt,
        response: { type: "cancel", gate, text: ["Reading the project notes..."] },
      },
    ])
    return { prompt, answer: "Reading the project notes...", gate }
  }
  if (kind === "provider") {
    yield* app.llm.expect(data.session.id, "assistant", [
      {
        expect: expectPrompt,
        response: { type: "error", status: 401, message: "Fixture authentication failure" },
      },
    ])
    return { prompt, answer: "Fixture authentication failure", gate }
  }
  yield* app.llm.expect(data.session.id, "assistant", [
    {
      expect: (request) => {
        expectPrompt(request)
        assert.ok(
          request.tools?.some((tool) => tool.function.name === "read"),
          "The real read Tool must be offered",
        )
      },
      response: {
        type: "success",
        events: [
          { tool: { id: "read-1", name: "read", input: { path: kind === "missing" ? "missing.txt" : data.path } } },
        ],
      },
    },
    {
      expect: (request) => {
        const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "read-1")
        assert.ok(result, "The next model request must include the real read-1 result")
        assert.ok(
          JSON.stringify(result.content).includes(kind === "missing" ? "not found" : data.content),
          JSON.stringify(result),
        )
      },
      response: { type: "success", events: [{ gate }, { text: answer }], usage: { input: 12, output: 6 } },
    },
  ])
  return { prompt, answer, gate }
})

/** The scripted outcome of one model turn registered by `reply`. */
export interface Reply {
  readonly prompt: string
  readonly answer: string
  /** Title generated in the background after a Session's first prompt. */
  readonly title?: string
  /** Pause the answer until the test releases this named gate. */
  readonly gate?: string
  /** Zero-based position among the assistant requests already registered for this Session. */
  readonly turn?: number
}

/** Register one assistant turn (and the first prompt's background title) for an existing Session. */
export const reply = Effect.fn("Chat.reply")(function* (
  app: TestApp.Interface,
  sessionID: SessionSchema.ID,
  input: Reply,
) {
  const expectPrompt = mentionsPrompt(input.prompt)
  if (input.title !== undefined) {
    yield* app.llm.expect(sessionID, "title", [
      { expect: expectPrompt, response: { type: "success", events: [{ text: input.title }] } },
    ])
  }
  yield* app.llm.expect(sessionID, "assistant", [
    {
      expect: expectPrompt,
      response: {
        type: "success",
        events: [...(input.gate === undefined ? [] : [{ gate: input.gate }]), { text: input.answer }],
        usage: { input: 12, output: 6 },
      },
    },
  ])
})

/** Script a turn, submit its prompt through the SDK, and wait for the Session to settle. */
export const converse = Effect.fn("Chat.converse")(function* (
  app: TestApp.Interface,
  data: Data,
  sessionID: SessionSchema.ID,
  input: Reply,
) {
  yield* reply(app, sessionID, input)
  yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID, text: input.prompt }))
  yield* app.llm.settled(sessionID, "assistant", input.turn ?? 0)
  yield* app.workspace(
    { account: data.account },
    Session.Service.use((sessions) => sessions.awaitIdle(sessionID)),
  )
  if (input.title !== undefined) yield* app.llm.settled(sessionID, "title")
})

/** A Session created through the SDK in the scenario's Project. */
export const open = Effect.fn("Chat.open")(function* (app: TestApp.Interface, data: Data) {
  return yield* Effect.tryPromise(() =>
    app.client.session.create({ workspace: data.owner.properties.workspaceID, projectID: data.project.id, model }),
  )
})

/** A child Session of `parentID`, created through the Session service as a subagent call would. */
export const child = Effect.fn("Chat.child")(function* (
  app: TestApp.Interface,
  data: Data,
  parentID: SessionSchema.ID,
  title: string,
) {
  return yield* app.workspace(
    { account: data.account },
    Session.Service.use((sessions) => sessions.createChild({ parentID, title })),
  )
})

/** Register a plain answer and the background title request's raw model output for a fresh Session. */
export const titled = Effect.fn("Chat.titled")(function* (
  app: TestApp.Interface,
  data: Data,
  options: { readonly prompt: string; readonly title: string },
  inspect: (request: Request) => void = () => {},
) {
  yield* app.llm.expect(data.session.id, "title", [
    {
      expect: mentionsPrompt(options.prompt),
      response: { type: "success", events: [{ text: options.title }] },
    },
  ])
  yield* app.llm.expect(data.session.id, "assistant", [
    { expect: inspect, response: { type: "success", events: [{ text: "Understood." }] } },
  ])
})
