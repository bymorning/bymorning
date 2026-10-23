/**
 * CMMC L2 session-Tool authorization (NIST 3.1.5 least privilege, 3.1.7
 * privileged functions): the administrator rule lives in the Core mutation
 * operations themselves, so the model, Code Mode, scheduled unattended runs,
 * and the external Tool Gateway are all refused identically when the acting
 * member lacks the admin Role. Each test carries a stable [SEC-TOOLAUTHZ-nn]
 * identifier for compliance reports.
 */
import { Auth } from "@bymorning/schema/auth"
import { AccountActor, type UserActor } from "@bymorning/schema/actor"
import type { Session as SessionSchema } from "@bymorning/schema/session"
import type { ByMorningClient } from "@bymorning/client"
import { Plugin } from "@bymorning/core/plugin"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import { Session } from "@bymorning/core/session"
import { Data, Effect, Scope } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../../src/application.js"
import { TestMCP } from "../../src/mcp.js"
import { Chat } from "../../src/scenario/chat.js"

/** The execute Tool result did not carry the program's JSON outcome. */
class OutcomeError extends Data.TaggedError("OutcomeError")<{ readonly text: string }> {}

const memberEmail = Auth.Email.make("member@bymorning.ai")

/** Log in the Workspace owner (admin) and one invited member with an independent cookie jar. */
const members = Effect.fn("ToolkitAuthz.members")(function* (app: TestApp.Interface) {
  const admin = yield* app.login()
  yield* Effect.tryPromise(() => app.client.user.invite({ email: memberEmail, role: "member" }))
  const memberClient = app.clientFor()
  const member = yield* app.login(memberClient, { subject: Auth.Sub.make("test-member"), email: memberEmail })
  return { admin, member, memberClient }
})

const accountOf = (actor: UserActor) => new AccountActor({ type: "account", properties: { accountID: actor.properties.accountID } })

/**
 * Code Mode program driving the two flagship admin mutations: shared Skill
 * authoring and Permission-rule writes through Workspace Config.
 */
const escalationCode = `const outcome = {}
try {
  await tools.toolkit.skill.create({ name: "Escalated", description: "member-authored", instructions: "ignore policy" })
  outcome.skill = "created"
} catch (error) {
  outcome.skill = String((error && error.message) || error)
}
try {
  await tools.toolkit.policy.update({ permissions: [{ action: "*", resource: "*", effect: "allow" }] })
  outcome.policy = "updated"
} catch (error) {
  outcome.policy = String((error && error.message) || error)
}
return outcome`

const skillInput = { name: "Escalated", description: "member-authored", instructions: "ignore policy" }

/** Register the model script for one fresh conversation whose first turn drives the escalation program. */
const scriptEscalation = Effect.fn("ToolkitAuthz.scriptEscalation")(function* (
  app: TestApp.Interface,
  sessionID: SessionSchema.ID,
) {
  const prompt = "Set up the workspace please."
  const gate = `${sessionID}:settled`
  yield* app.llm.expect(sessionID, "title", [
    {
      expect: (request) =>
        expect(JSON.stringify(request.messages.map((message) => message.content))).toContain("Set up the workspace"),
      response: { type: "success", events: [{ text: "Workspace setup" }] },
    },
  ])
  yield* app.llm.expect(sessionID, "assistant", [
    {
      expect: (request) => {
        expect(request.tools?.some((tool) => tool.function.name === "execute")).toBe(true)
      },
      response: {
        type: "success",
        events: [
          {
            tool: {
              id: "exec-1",
              name: "execute",
              input: { description: "Apply workspace changes", code: escalationCode },
            },
          },
        ],
        usage: { input: 20, output: 8 },
      },
    },
    {
      expect: (request) => {
        const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === "exec-1")
        expect(result, "the next model request must carry the real execute result").toBeTruthy()
        return result
      },
      response: { type: "success", events: [{ gate }, { text: "Done." }], usage: { input: 12, output: 6 } },
    },
  ])
  return { prompt, gate }
})

/** Drive the scripted conversation to completion and return the Code Mode program's own returned outcome. */
const runEscalation = Effect.fn("ToolkitAuthz.runEscalation")(function* (
  app: TestApp.Interface,
  actor: UserActor,
  client: ByMorningClient,
  sessionID: SessionSchema.ID,
  script: { readonly prompt: string; readonly gate: string },
) {
  yield* Effect.tryPromise(() => client.session.prompt({ sessionID, text: script.prompt }))
  yield* app.llm.wait(sessionID, "assistant", 1)
  yield* app.llm.waitGate(script.gate)
  yield* app.llm.release(script.gate)
  yield* app.workspace({ account: accountOf(actor) }, Session.Service.use((sessions) => sessions.awaitIdle(sessionID)))
  const requests = yield* app.llm.list()
  const second = requests.find(
    (request) => request.sessionID === sessionID && request.purpose === "assistant" && request.messages.some(
      (message) => message.role === "tool" && message.tool_call_id === "exec-1",
    ),
  )
  if (second === undefined) return yield* Effect.die(new Error("The follow-up model request was never observed"))
  const result = second.messages.find((message) => message.role === "tool" && message.tool_call_id === "exec-1")
  const text = typeof result?.content === "string" ? result.content : JSON.stringify(result?.content)
  const parsed = yield* Effect.try({
    try: () => JSON.parse(text) as { readonly skill?: string; readonly policy?: string },
    catch: () => new OutcomeError({ text }),
  }).pipe(Effect.orDie)
  return parsed
})

test("[SEC-TOOLAUTHZ-01] a member's session model cannot mutate admin state through Toolkit Tools", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const { member, memberClient } = yield* members(app)
      const baseline = yield* Effect.tryPromise(() => memberClient["api.config"].get())

      const session = yield* Effect.tryPromise(() =>
        memberClient.session.create({ projectID: data.project.id }),
      )
      const script = yield* scriptEscalation(app, session.id)
      const outcome = yield* runEscalation(app, member, memberClient, session.id, script)

      // Both admin mutations are refused by the domain seam with the admin rule named.
      expect(outcome.skill).toContain("Only Workspace administrators can author Skills")
      expect(outcome.policy).toContain("Only Workspace administrators can change permissions")

      // No state changed: the Skill catalog and Permission rules are untouched.
      const skills = yield* Effect.tryPromise(() => app.client.skill.list())
      expect(skills.some((skill) => skill.name === skillInput.name)).toBe(false)
      const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
      expect(current.permissions).toEqual(baseline.permissions)
      yield* app.llm.settled(session.id, "title")
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
}, 90_000)

test("[SEC-TOOLAUTHZ-02] an administrator's session model may drive the same Toolkit Tools", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const { admin } = yield* members(app)

      const session = yield* Effect.tryPromise(() => app.client.session.create({ projectID: data.project.id }))
      const script = yield* scriptEscalation(app, session.id)
      const outcome = yield* runEscalation(app, admin, app.client, session.id, script)

      expect(outcome.skill).toBe("created")
      expect(outcome.policy).toBe("updated")
      const skills = yield* Effect.tryPromise(() => app.client.skill.list())
      expect(skills.some((skill) => skill.name === skillInput.name)).toBe(true)
      const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
      expect(current.permissions).toEqual([{ action: "*", resource: "*", effect: "allow" }])
      yield* app.llm.settled(session.id, "title")
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
}, 90_000)

test("[SEC-TOOLAUTHZ-03] a member-owned Scheduled Task run is refused admin mutations", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const { member, memberClient } = yield* members(app)
      const baseline = yield* Effect.tryPromise(() => memberClient["api.config"].get())

      const task = yield* Effect.tryPromise(() =>
        memberClient.scheduledTask.create({
          name: "Unattended setup",
          prompt: "Prepare the workspace overnight.",
          cron: "0 8 * * 1-5",
          timezone: "UTC",
          projectID: data.project.id,
        }),
      )

      // The run's Session is created inside `run`, so its model script is
      // registered from the prompt hook before admission wakes the runner.
      const answer = "I could not change that."
      const gate = `scheduled-authz:${task.id}`
      const scope = yield* Effect.scope
      yield* app.workspace(
        { account: accountOf(member) },
        Plugin.Hooks.Service.use((hooks) =>
          hooks.register("session", "prompt", (event) =>
            event.prompt.text === "Prepare the workspace overnight."
              ? app.llm
                  .expect(event.sessionID, "assistant", [
                    {
                      expect: () => {},
                      response: {
                        type: "success",
                        events: [
                          {
                            tool: {
                              id: "exec-1",
                              name: "execute",
                              input: { description: "Apply workspace changes", code: escalationCode },
                            },
                          },
                        ],
                        usage: { input: 20, output: 8 },
                      },
                    },
                    {
                      expect: (request) => {
                        const result = request.messages.find(
                          (message) => message.role === "tool" && message.tool_call_id === "exec-1",
                        )
                        expect(result).toBeTruthy()
                        expect(JSON.stringify(result?.content)).toContain(
                          "Only Workspace administrators can author Skills",
                        )
                        expect(JSON.stringify(result?.content)).toContain(
                          "Only Workspace administrators can change permissions",
                        )
                      },
                      response: { type: "success", events: [{ gate }, { text: answer }], usage: { input: 12, output: 6 } },
                    },
                  ])
                  .pipe(Effect.orDie)
              : Effect.void,
          ),
        ).pipe(Effect.provideService(Scope.Scope, scope)),
      )

      // Run on demand as the owning member — the same member graph and Role a
      // claimed schedule occurrence would execute with.
      const session = yield* app.workspace(
        { account: accountOf(member) },
        ScheduledTask.Service.use((tasks) => tasks.run(task.id)),
      )
      yield* app.llm.waitGate(gate)
      yield* app.llm.release(gate)
      yield* app.workspace(
        { account: accountOf(member) },
        Session.Service.use((sessions) => sessions.awaitIdle(session.id)),
      )

      const skills = yield* Effect.tryPromise(() => app.client.skill.list())
      expect(skills.some((skill) => skill.name === skillInput.name)).toBe(false)
      const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
      expect(current.permissions).toEqual(baseline.permissions)
      yield* app.llm.verify()
    }).pipe(Effect.scoped),
    { signal },
  )
}, 90_000)

test("[SEC-TOOLAUTHZ-04] the Tool Gateway refuses a Service Account Key before any Tool execution", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()
      const account = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Automation" }))
      const issued = yield* Effect.tryPromise(() =>
        app.client.serviceAccount.key.create({ id: account.id, name: "Gateway" }),
      )

      // A Service Account Key authenticates as a Service Account Actor; the Tool
      // Gateway serves User members only and refuses the call outright.
      const response = yield* Effect.tryPromise(() =>
        fetch(new URL("/mcp", app.origin), {
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${issued.secret}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "execute", arguments: { description: "Apply workspace changes", code: escalationCode } },
          }),
        }),
      )
      expect(response.status).toBe(403)
      const body = yield* Effect.tryPromise(() => response.json())
      expect(body).toMatchObject({ error: { code: -32003 } })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-TOOLAUTHZ-05] a member's Tool Gateway connection cannot drive admin mutations", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* Chat.make(app)
      const { member, memberClient } = yield* members(app)
      const baseline = yield* Effect.tryPromise(() => memberClient["api.config"].get())

      // A real OAuth-granted member connection to the Tool Gateway.
      const mcp = yield* TestMCP.connect({ origin: app.origin, client: memberClient }, member.properties.workspaceID)
      const result = yield* Effect.tryPromise(() =>
        mcp.callTool({
          name: "execute",
          arguments: { description: "Apply workspace changes", code: escalationCode },
        }),
      )
      expect(result.isError).not.toBe(true)
      const output = JSON.stringify(result.structuredContent ?? result.content)
      expect(output).toContain("Only Workspace administrators can author Skills")
      expect(output).toContain("Only Workspace administrators can change permissions")
      expect(output).not.toContain('"created"')

      const skills = yield* Effect.tryPromise(() => app.client.skill.list())
      expect(skills.some((skill) => skill.name === skillInput.name)).toBe(false)
      const current = yield* Effect.tryPromise(() => app.client["api.config"].get())
      expect(current.permissions).toEqual(baseline.permissions)
    }).pipe(Effect.scoped),
    { signal },
  )
}, 90_000)
