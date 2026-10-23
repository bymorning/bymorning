import { expect, test } from "vitest"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { Session } from "@bymorning/core/session"
import { Agent } from "@bymorning/core/agent"
import { AgentSchema } from "@bymorning/schema/agent"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

test("an administrator saves the default Agent's instructions and resets them to the built-in", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspaceID = data.owner.properties.workspaceID
        const effective = () =>
          app.workspace(
            { account: data.account },
            Agent.Service.use((agents) => agents.get(AgentSchema.DefaultID)),
          )

        const shipped = yield* Effect.tryPromise(() =>
          app.client.agent.get({ workspace: workspaceID, id: AgentSchema.DefaultID }),
        )
        expect(shipped.instructions).toContain("Default Agent in ByMorning")
        expect(shipped.overridden).toBe(false)

        const saved = yield* Effect.tryPromise(() =>
          app.client.agent.update({
            workspace: workspaceID,
            id: AgentSchema.DefaultID,
            name: shipped.name,
            instructions: "Answer as our propulsion team's analyst.",
            mode: shipped.mode,
            hidden: shipped.hidden,
            steps: shipped.steps,
            permissions: shipped.permissions,
          }),
        )
        expect(saved.instructions).toBe("Answer as our propulsion team's analyst.")
        expect(saved.overridden).toBe(true)
        // The saved record replaces the shipped definition for Session execution.
        expect((yield* effective())?.instructions).toBe("Answer as our propulsion team's analyst.")

        const reread = yield* Effect.tryPromise(() =>
          app.client.agent.get({ workspace: workspaceID, id: AgentSchema.DefaultID }),
        )
        expect(reread.overridden).toBe(true)

        yield* Effect.tryPromise(() => app.client.agent.delete({ workspace: workspaceID, id: AgentSchema.DefaultID }))

        expect((yield* effective())?.instructions).toBe(shipped.instructions)
        const restored = yield* Effect.tryPromise(() =>
          app.client.agent.get({ workspace: workspaceID, id: AgentSchema.DefaultID }),
        )
        expect(restored.overridden).toBe(false)
        // Removing an absent record is a no-op rather than a failure.
        yield* Effect.tryPromise(() => app.client.agent.delete({ workspace: workspaceID, id: AgentSchema.DefaultID }))
        expect((yield* effective())?.instructions).toBe(shipped.instructions)
      }),
    ),
    { signal },
  )
}, 120_000)

test("the Workspace keeps one primary Agent and admits only subagents alongside it", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspaceID = data.owner.properties.workspaceID

        const agents = yield* Effect.tryPromise(() => app.client.agent.list({ workspace: workspaceID }))
        expect(agents.filter((agent) => agent.mode !== "subagent").map((agent) => agent.id)).toEqual([
          AgentSchema.DefaultID,
        ])

        // A created Agent must be a subagent; the public API refuses `primary`.
        const rejectedCreate = yield* Effect.tryPromise(() =>
          app.client.agent.create({
            workspace: workspaceID,
            id: AgentSchema.ID.make("second-primary"),
            name: AgentSchema.Name.make("Second primary"),
            instructions: "",
            mode: "primary",
            hidden: false,
            steps: null,
            permissions: [],
          }),
        ).pipe(Effect.flip)
        expect(rejectedCreate.cause).toMatchObject({ _tag: "ForbiddenError" })

        const reviewer = AgentSchema.ID.make("reviewer")
        const created = yield* Effect.tryPromise(() =>
          app.client.agent.create({
            workspace: workspaceID,
            id: reviewer,
            name: AgentSchema.Name.make("Reviewer"),
            instructions: "Review the work.",
            mode: "subagent",
            hidden: false,
            steps: null,
            permissions: [],
          }),
        )
        expect(created.mode).toBe("subagent")

        // Promoting an existing subagent to primary is refused the same way.
        const promoted = yield* Effect.tryPromise(() =>
          app.client.agent.update({
            workspace: workspaceID,
            id: reviewer,
            name: created.name,
            instructions: created.instructions,
            mode: "primary",
            hidden: created.hidden,
            steps: created.steps,
            permissions: created.permissions,
          }),
        ).pipe(Effect.flip)
        expect(promoted.cause).toMatchObject({ _tag: "ForbiddenError" })
        expect(
          yield* app.workspace(
            { account: data.account },
            Agent.Service.use((service) => service.get(reviewer)),
          ),
        ).toMatchObject({ mode: "subagent" })
      }),
    ),
    { signal },
  )
}, 120_000)

test("a renamed subagent is listed to the model with its display name", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspaceID = data.owner.properties.workspaceID
        const reviewer = AgentSchema.ID.make("reviewer")
        const created = yield* Effect.tryPromise(() =>
          app.client.agent.create({
            workspace: workspaceID,
            id: reviewer,
            name: AgentSchema.Name.make("Reviewer"),
            instructions: "Review the work.",
            mode: "subagent",
            hidden: false,
            steps: null,
            permissions: [],
          }),
        )
        yield* Effect.tryPromise(() =>
          app.client.agent.update({
            workspace: workspaceID,
            id: reviewer,
            name: AgentSchema.Name.make("Quality Gatekeeper"),
            instructions: created.instructions,
            mode: created.mode,
            hidden: created.hidden,
            steps: created.steps,
            permissions: created.permissions,
          }),
        )
        const prompt = "Which helpers can you call?"
        yield* Chat.titled(app, data, { prompt, title: "Available helpers" }, (request) => {
          const subagent = request.tools?.find((tool) => tool.function.name === "subagent")
          assert.ok(subagent, "The subagent Tool must be offered")
          assert.match(subagent.function.description ?? "", /^- reviewer \(name: Quality Gatekeeper\): /m)
        })
        yield* Effect.tryPromise(() => app.client.session.prompt({ sessionID: data.session.id, text: prompt }))
        yield* app.llm.settled(data.session.id, "assistant")
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        yield* app.llm.settled(data.session.id, "title")
        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
}, 120_000)
