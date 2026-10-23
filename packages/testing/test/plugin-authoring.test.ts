import { Plugin } from "@bymorning/core/plugin"
import { Session } from "@bymorning/core/session"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { PluginAuthoring } from "../src/scenario/plugin-authoring.js"

const converse = (app: TestApp.Interface, data: Chat.Data, prompt: string, gate: string) =>
  Effect.gen(function* () {
    yield* app.workspace(
      { account: data.account },
      Session.Service.use((sessions) => sessions.prompt({ sessionID: data.session.id, text: prompt })),
    )
    yield* app.llm.waitGate(gate)
    yield* app.llm.release(gate)
    yield* app.workspace(
      { account: data.account },
      Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
    )
    yield* app.llm.settled(data.session.id, "title")
    yield* app.llm.verify()
  })

test("the model writes the Skill's probe plugin and sees it active in the inventory on the next turn", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // Project plugins are imported from the Application directory; see TestApp.repository.
        const app = yield* TestApp.make({ parent: TestApp.repository })
        const data = yield* Chat.make(app)
        const content = yield* PluginAuthoring.probe(app, data)
        const prompt = "Write the probe plugin and confirm it activated."
        let seen: ReadonlyArray<PluginAuthoring.Row> = []
        const script = yield* PluginAuthoring.script(app, data, {
          content,
          prompt,
          inspect: (rows) => {
            seen = rows
            const row = rows.find((candidate) => candidate.source.path === PluginAuthoring.path)
            assert.ok(row, JSON.stringify(rows))
            assert.equal(row.status, "active", JSON.stringify(row))
            assert.equal(row.id, "project.probe")
            assert.equal(row.source.type, "project")
            assert.equal(row.source.projectID, data.project.id)
          },
        })
        yield* converse(app, data, prompt, script.gate)

        // The model saw the same inventory the public Plugin service reports.
        const inventory = yield* app.workspace({ account: data.account }, Plugin.Service.use((plugin) => plugin.list()))
        expect(inventory).toContainEqual(
          expect.objectContaining({
            id: "project.probe",
            status: "active",
            source: { type: "project", projectID: data.project.id, path: PluginAuthoring.path },
          }),
        )
        expect(seen.every((row) => row.source.type === "project")).toBe(true)
        expect(JSON.stringify(seen)).not.toMatch(/\/(tmp|var|Users|home|srv)\//)

        const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
        const parts = messages.data.filter((message) => message.type === "assistant").flatMap((message) => message.content)
        expect(parts).toContainEqual(
          expect.objectContaining({ type: "tool", id: "write-1", name: "write", state: expect.objectContaining({ status: "completed" }) }),
        )
        expect(parts).toContainEqual(
          expect.objectContaining({ type: "tool", id: "list-1", name: "execute", state: expect.objectContaining({ status: "completed" }) }),
        )
        expect(parts).toContainEqual(expect.objectContaining({ type: "text", text: script.answer }))
      }),
    ),
    { signal },
  )
}, 90_000)

test("a Project plugin that cannot load is reported to the model as failed with a redacted error", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make({ parent: TestApp.repository })
        const data = yield* Chat.make(app)
        const prompt = "Write the broken plugin and check the inventory."
        const script = yield* PluginAuthoring.script(app, data, {
          content: PluginAuthoring.broken,
          prompt,
          inspect: (rows) => {
            const row = rows.find((candidate) => candidate.source.path === PluginAuthoring.path)
            assert.ok(row, JSON.stringify(rows))
            assert.equal(row.status, "failed", JSON.stringify(row))
            assert.equal(row.id, undefined)
            assert.match(row.error ?? "", /^Plugin failed to load/)
            assert.match(row.ref ?? "", /^err_[0-9a-f]{8}$/)
            // The redacted row carries no host path, stack frame, or source text.
            const text = JSON.stringify(row)
            assert.doesNotMatch(text, /\/(tmp|var|Users|home|srv)\//)
            assert.doesNotMatch(text, /\.bymorning|materialized|\n\s+at /)
          },
        })
        yield* converse(app, data, prompt, script.gate)

        const inventory = yield* app.workspace({ account: data.account }, Plugin.Service.use((plugin) => plugin.list()))
        expect(inventory).toContainEqual(
          expect.objectContaining({
            status: "failed",
            error: expect.stringMatching(/^Plugin failed to load/),
            source: { type: "project", projectID: data.project.id, path: PluginAuthoring.path },
          }),
        )
      }),
    ),
    { signal },
  )
}, 90_000)

test("a Project plugin with a malformed Integration method fails alone and its Workspace keeps serving requests", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make({ parent: TestApp.repository })
        const data = yield* Chat.make(app)
        const workspace = data.owner.properties.workspaceID
        const installed = yield* PluginAuthoring.install(app, data, [PluginAuthoring.sibling, PluginAuthoring.incident])

        // The malformed plugin is reported as failed with the author-facing reason; its valid sibling stays active.
        expect(installed.rows).toContainEqual(
          expect.objectContaining({
            id: "project.integration.google-workspace",
            status: "failed",
            error: PluginAuthoring.incidentError,
            source: { type: "project", projectID: data.project.id, path: PluginAuthoring.incident.path },
          }),
        )
        expect(installed.rows).toContainEqual(
          expect.objectContaining({
            id: "project.jira-my-issues",
            status: "active",
            integrations: ["jira"],
            tools: [expect.stringContaining("jira_my_issues")],
            source: { type: "project", projectID: data.project.id, path: PluginAuthoring.sibling.path },
          }),
        )
        expect(installed.rows.filter((row) => row.status === "failed")).toHaveLength(1)

        // Every Workspace-scoped request the web app makes on load answers promptly instead of waiting on readiness.
        const prompt = <A>(name: string, request: () => Promise<A>) =>
          Effect.tryPromise(request).pipe(
            Effect.timeoutOrElse({
              duration: "5 seconds",
              orElse: () => Effect.die(new Error(`${name} did not answer within 5 seconds`)),
            }),
          )
        const projects = yield* prompt("project list", () => app.client.project.list({ workspace }))
        expect(projects.map((project) => project.id)).toContain(data.project.id)
        const sessions = yield* prompt("session list", () => app.client.session.list({ workspace }))
        expect(sessions.data.map((session) => session.id)).toContain(data.session.id)
        yield* prompt("active sessions", () => app.client.session.active({ workspace }))
        const models = yield* prompt("model list", () => app.client.model.list({ workspace }))
        expect(models.length).toBeGreaterThan(0)
        const agents = yield* prompt("agent list", () => app.client.agent.list({ workspace }))
        expect(agents.map((agent) => agent.id)).toContain("default")
        const integrations = yield* prompt("integration list", () => app.client.integration.list({ workspace }))
        expect(integrations.map((integration) => integration.id)).toContain("jira")
        expect(integrations.map((integration) => integration.id)).not.toContain("google-workspace")
        const created = yield* prompt("project create", () => app.client.project.create({ workspace, name: "After the bad plugin" }))
        expect(created.name).toBe("After the bad plugin")

        // A model invocation runs normally, and nothing retries the unchanged failed plugin meanwhile.
        const turn = Chat.converse(app, data, data.session.id, {
          prompt: "Are you still there?",
          answer: "Still here.",
          title: "Still there",
        })
        const reloads = yield* PluginAuthoring.reloads(
          app,
          data,
          turn,
          (event) =>
            event.type === "session.run.succeeded" &&
            typeof event.data === "object" &&
            event.data !== null &&
            "sessionID" in event.data &&
            event.data.sessionID === data.session.id,
        )
        expect(reloads).toBe(0)
        expect(installed.updates).toBeLessThanOrEqual(2)
        yield* app.llm.verify()
        const inventory = yield* app.workspace({ account: data.account }, Plugin.Service.use((plugin) => plugin.list()))
        expect(inventory).toContainEqual(
          expect.objectContaining({ id: "project.integration.google-workspace", status: "failed", error: PluginAuthoring.incidentError }),
        )
        expect(inventory).toContainEqual(expect.objectContaining({ id: "project.jira-my-issues", status: "active" }))
      }),
    ),
    { signal },
  )
}, 90_000)
