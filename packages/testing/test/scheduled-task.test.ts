import { Database, ScheduledTaskTable } from "@bymorning/core/database"
import { Permission } from "@bymorning/core/permission"
import { Plugin } from "@bymorning/core/plugin"
import { ScheduledTask } from "@bymorning/core/scheduled-task"
import { Session } from "@bymorning/core/session"
import { AccountActor, type UserActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import { Effect, Scope } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"
import { ScheduledTaskScenario } from "../src/scenario/scheduled-task.js"

const account = (actor: UserActor) => new AccountActor({ type: "account", properties: { accountID: actor.properties.accountID } })

/** A message text body, whether the provider framed it as a string or text parts. */
const textOf = (content: unknown): string | undefined => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = content.map((part) =>
      part !== null && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "",
    )
    return parts.every((part) => part.length > 0) ? parts.join("") : undefined
  }
  return undefined
}

test("scheduled Tasks are managed over the SDK and run with a scripted model", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const name = "Daily briefing"
        const prompt = "Summarize the last 24 hours of notable repository activity in five bullets."

        const created = yield* Effect.tryPromise(() =>
          app.client.scheduledTask.create({
            name,
            prompt,
            cron: "0 8 * * 1-5",
            timezone: "America/New_York",
            projectID: data.project.id,
          }),
        )
        expect(created.id).toMatch(/^tsk_[0-9A-Za-z]{26}$/)
        expect(created).toMatchObject({
          name,
          prompt,
          cron: "0 8 * * 1-5",
          timezone: "America/New_York",
          projectID: data.project.id,
          enabled: true,
        })
        expect(created.nextRunAt).toBeInstanceOf(Date)
        expect(created.nextRunAt!.getTime()).toBeGreaterThan(Date.now())

        const listed = yield* Effect.tryPromise(() => app.client.scheduledTask.list())
        expect(listed.map((task) => task.id)).toContain(created.id)

        // Occurrences closer than one hour are rejected with the mapped schedule error.
        const rejected = yield* Effect.tryPromise(() =>
          app.client.scheduledTask.create({
            name: "Too frequent",
            prompt: "Check in",
            cron: "*/5 * * * *",
            timezone: "UTC",
          }),
        ).pipe(Effect.flip)
        expect(rejected.cause).toMatchObject({ _tag: "ScheduledTask.ScheduleError" })

        // Pausing clears the next occurrence; resuming schedules it again from now.
        const paused = yield* Effect.tryPromise(() =>
          app.client.scheduledTask.update({ taskID: created.id, enabled: false }),
        )
        expect(paused.enabled).toBe(false)
        expect(paused.nextRunAt).toBeUndefined()
        const resumed = yield* Effect.tryPromise(() =>
          app.client.scheduledTask.update({ taskID: created.id, enabled: true }),
        )
        expect(resumed.enabled).toBe(true)
        expect(resumed.nextRunAt).toBeInstanceOf(Date)
        expect(resumed.nextRunAt!.getTime()).toBeGreaterThan(Date.now())

        // A run creates its Session and admits the prompt inside one call, so the
        // model script for the fresh Session is registered from a prompt hook,
        // before admission wakes the runner.
        const answer = "Briefing delivered."
        const gate = `scheduled-task:${created.id}`
        const scope = yield* Effect.scope
        yield* app.workspace(
          { account: data.account },
          Plugin.Hooks.Service.use((hooks) =>
            hooks.register("session", "prompt", (event) =>
              event.prompt.text === prompt
                ? app.llm
                    .expect(event.sessionID, "assistant", [
                      {
                        expect: (request) => {
                          const user = request.messages.find((message) => message.role === "user")
                          expect(textOf(user?.content)).toBe(prompt)
                          const system = request.messages
                            .filter((message) => message.role === "system" || message.role === "developer")
                            .map((message) => textOf(message.content) ?? JSON.stringify(message.content))
                          expect(system.some((text) => text.includes("scheduled task"))).toBe(true)
                          expect(system.some((text) => text.includes(name))).toBe(true)
                          expect(system.some((text) => text.includes("50"))).toBe(true)
                        },
                        response: {
                          type: "success",
                          events: [{ gate }, { text: answer }],
                          usage: { input: 10, output: 5 },
                        },
                      },
                    ])
                    .pipe(Effect.orDie)
                : Effect.void,
            ),
          ).pipe(Effect.provideService(Scope.Scope, scope)),
        )

        const session = yield* Effect.tryPromise(() => app.client.scheduledTask.run({ taskID: created.id }))
        expect(session.title).toBe(name)
        expect(session.scheduledTaskID).toBe(created.id)

        const fetched = yield* Effect.tryPromise(() => app.client.session.get({ sessionID: session.id }))
        expect(fetched.scheduledTaskID).toBe(created.id)
        expect(fetched.title).toBe(name)

        yield* app.llm.wait(session.id, "assistant")
        yield* app.llm.waitGate(gate)
        yield* app.llm.release(gate)
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(session.id)),
        )
        const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: session.id }))
        expect(messages.data).toContainEqual(expect.objectContaining({ type: "user", text: prompt }))
        expect(
          messages.data
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .some((part) => part.type === "text" && part.text === answer),
        ).toBe(true)

        const afterRun = yield* Effect.tryPromise(() => app.client.scheduledTask.list())
        const ran = afterRun.find((task) => task.id === created.id)
        expect(ran?.lastSessionID).toBe(session.id)
        expect(ran?.lastRunAt).toBeInstanceOf(Date)
        expect(ran?.missedAt).toBeUndefined()

        // A miss recorded on the row is cleared by dismiss. This Application owns a
        // fresh database holding exactly this one Scheduled Task row.
        const missedAt = new Date("2026-09-18T08:00:00.000Z")
        yield* app
          .process(
            Database.Service.use((database) =>
              database.use("ScheduledTaskTest.miss", (db) =>
                db.update(ScheduledTaskTable).set({ missedAt }),
              ),
            ),
          )
          .pipe(Effect.orDie)
        const missed = yield* Effect.tryPromise(() => app.client.scheduledTask.get({ taskID: created.id }))
        expect(missed.missedAt).toBeInstanceOf(Date)
        const dismissed = yield* Effect.tryPromise(() => app.client.scheduledTask.dismiss({ taskID: created.id }))
        expect(dismissed.missedAt).toBeUndefined()
        const cleared = yield* Effect.tryPromise(() => app.client.scheduledTask.get({ taskID: created.id }))
        expect(cleared.missedAt).toBeUndefined()

        // Delete removes the task; the Session it ran remains.
        yield* Effect.tryPromise(() => app.client.scheduledTask.delete({ taskID: created.id }))
        const gone = yield* Effect.tryPromise(() => app.client.scheduledTask.get({ taskID: created.id })).pipe(
          Effect.flip,
        )
        expect(gone.cause).toMatchObject({ _tag: "ScheduledTask.NotFoundError" })
        const remaining = yield* Effect.tryPromise(() => app.client.session.get({ sessionID: session.id }))
        expect(remaining.title).toBe(name)

        yield* app.llm.verify()
      }),
    ),
    { signal },
  )
})

test("enforces the per-member Scheduled Task limit and isolates tasks between members", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)

        // Occurrences one hour apart so MaxPerMember distinct tasks never collide with each other's schedule.
        for (let hour = 0; hour < ScheduledTask.MaxPerMember; hour++) {
          yield* ScheduledTaskScenario.create(app, data, { name: `Task ${hour}`, cron: `0 ${hour} * * *` })
        }
        const atLimit = yield* Effect.tryPromise(() =>
          app.client.scheduledTask.list({}, undefined),
        ).pipe(Effect.orElseSucceed(() => []))
        expect(atLimit.length).toBeGreaterThanOrEqual(ScheduledTask.MaxPerMember)

        const rejected = yield* ScheduledTaskScenario.create(app, data, {
          name: "One too many",
          cron: "0 23 * * *",
        }).pipe(Effect.flip)
        expect(rejected.cause).toMatchObject({ _tag: "ScheduledTask.LimitError", limit: ScheduledTask.MaxPerMember })

        // A second member's task is invisible to, and unreachable by, the first member.
        yield* Effect.tryPromise(() =>
          app.client.user.invite({ email: Auth.Email.make("second@bymorning.ai"), role: "member" }),
        )
        const secondClient = app.clientFor()
        yield* app.login(secondClient, {
          subject: Auth.Sub.make("test-second-member"),
          email: Auth.Email.make("second@bymorning.ai"),
        })
        const secondProject = yield* Effect.tryPromise(() =>
          secondClient.project.create({ workspace: data.owner.properties.workspaceID, name: "Second member" }),
        )
        const secondTask = yield* Effect.tryPromise(() =>
          secondClient.scheduledTask.create({
            workspace: data.owner.properties.workspaceID,
            name: "Second member's task",
            prompt: "Summarize",
            cron: "0 9 * * *",
            timezone: "UTC",
            projectID: secondProject.id,
          }),
        )
        const ownerList = yield* Effect.tryPromise(() => app.client.scheduledTask.list())
        expect(ownerList.map((task) => task.id)).not.toContain(secondTask.id)
        const ownerGetsOther = yield* Effect.tryPromise(() =>
          app.client.scheduledTask.get({ taskID: secondTask.id }),
        ).pipe(Effect.flip)
        expect(ownerGetsOther.cause).toMatchObject({ _tag: "ScheduledTask.NotFoundError" })
      }),
    ),
    { signal },
  )
})

test("a Scheduled Task run is unattended: an ask rule and the question Tool are denied, and a child Session inherits the same denial", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const owner = account(data.owner)
        const workspaceID = data.owner.properties.workspaceID

        // A workspace rule that would normally pause a Session to ask the member.
        const config = yield* Effect.tryPromise(() => app.client["api.config"].get({ workspace: workspaceID }))
        yield* Effect.tryPromise(() =>
          app.client["api.config"].update({
            ...config,
            permissions: [...config.permissions, { action: "custom-tool", resource: "*", effect: "ask" }],
          }),
        )

        const task = yield* ScheduledTaskScenario.create(app, data)

        // A run's Session is created directly through core, bypassing the model entirely: this test only
        // needs the Session to carry the marker `ScheduledTask.run` sets, not a completed conversation.
        const run = yield* app.workspace(
          { account: owner, workspaceID },
          Session.Service.use((sessions) => sessions.create({ projectID: data.project.id, scheduledTaskID: task.id })),
        )
        expect(run.scheduledTaskID).toBe(task.id)

        const child = yield* app.workspace(
          { account: owner, workspaceID },
          Session.Service.use((sessions) => sessions.createChild({ parentID: run.id })),
        )
        expect(child.scheduledTaskID).toBe(task.id)

        for (const sessionID of [run.id, child.id]) {
          const askRule = yield* app.workspace(
            { account: owner, workspaceID },
            Permission.Service.use((permissions) =>
              permissions.ask({ sessionID, action: "custom-tool", resources: ["*"] }),
            ),
          )
          expect(askRule.effect).toBe("deny")
          const question = yield* app.workspace(
            { account: owner, workspaceID },
            Permission.Service.use((permissions) => permissions.ask({ sessionID, action: "question", resources: ["*"] })),
          )
          expect(question.effect).toBe("deny")
        }

        // The same rule on an attended Session still asks, proving the denial is specific to the marked Sessions.
        const attended = yield* app.workspace(
          { account: owner, workspaceID },
          Session.Service.use((sessions) => sessions.create({ projectID: data.project.id })),
        )
        const attendedAsk = yield* app.workspace(
          { account: owner, workspaceID },
          Permission.Service.use((permissions) =>
            permissions.ask({ sessionID: attended.id, action: "custom-tool", resources: ["*"] }),
          ),
        )
        expect(attendedAsk.effect).toBe("ask")
      }),
    ),
    { signal },
  )
})
