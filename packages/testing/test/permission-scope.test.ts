import { AccountActor, type UserActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"
import { Agent } from "@bymorning/schema/agent"
import { User } from "@bymorning/schema/user"
import { Auth as CoreAuth } from "@bymorning/core/auth"
import { User as CoreUser } from "@bymorning/core/user"
import { Permission } from "@bymorning/core/permission"
import { Session } from "@bymorning/core/session"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

const account = (actor: UserActor) => new AccountActor({ type: "account", properties: { accountID: actor.properties.accountID } })

test("authorizes scoped Permission rules and limits member permission authoring through the generated SDK", async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        const workspace = data.owner.properties.workspaceID
        yield* Effect.tryPromise(() =>
          app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" }),
        )
        const memberClient = app.clientFor()
        const member = yield* app.login(memberClient, {
          subject: Auth.Sub.make("test-member"),
          email: Auth.Email.make("member@bymorning.ai"),
        })
        const config = yield* Effect.tryPromise(() => app.client["api.config"].get({ workspace }))
        yield* Effect.tryPromise(() =>
          app.client["api.config"].update({
            ...config,
            permissions: [
              { action: "workspace-fallback", resource: "*", effect: "allow" },
              { action: "member-ask", resource: "*", effect: "allow" },
              { action: "member-ask", resource: "*", effect: "ask", user: member.properties.userID },
              { action: "member-deny", resource: "*", effect: "allow" },
              { action: "member-deny", resource: "*", effect: "deny", user: member.properties.userID },
            ],
          }),
        )
        const memberSession = yield* app.workspace(
          { account: account(member), workspaceID: workspace },
          Session.Service.use((sessions) => sessions.create({ projectID: data.project.id })),
        )

        const ownerFallback = yield* app.workspace(
          { account: account(data.owner), workspaceID: workspace },
          Permission.Service.use((permissions) =>
            permissions.ask({ sessionID: data.session.id, action: "workspace-fallback", resources: ["*"] }),
          ),
        )
        expect(ownerFallback.effect).toBe("allow")

        const memberAsk = yield* app.workspace(
          { account: account(member), workspaceID: workspace },
          Permission.Service.use((permissions) =>
            permissions.ask({ sessionID: memberSession.id, action: "member-ask", resources: ["*"] }),
          ),
        )
        expect(memberAsk.effect).toBe("ask")
        const ownerAsk = yield* app.workspace(
          { account: account(data.owner), workspaceID: workspace },
          Permission.Service.use((permissions) =>
            permissions.ask({ sessionID: data.session.id, action: "member-ask", resources: ["*"] }),
          ),
        )
        expect(ownerAsk.effect).toBe("allow")
        const memberDeny = yield* app.workspace(
          { account: account(member), workspaceID: workspace },
          Permission.Service.use((permissions) =>
            permissions.ask({ sessionID: memberSession.id, action: "member-deny", resources: ["*"] }),
          ),
        )
        expect(memberDeny.effect).toBe("deny")

        const permanent = yield* Effect.tryPromise(() =>
          memberClient.permission.reply({ sessionID: memberSession.id, requestID: memberAsk.id, reply: "always" }),
        ).pipe(Effect.flip)
        expect(permanent.cause).toMatchObject({
          _tag: "Protocol.InputError",
          error: "Permanent permission grants are unavailable; ask for a Workspace rule instead",
        })
        const pending = yield* app.workspace(
          { account: account(member), workspaceID: workspace },
          Permission.Service.use((permissions) => permissions.get({ sessionID: memberSession.id, requestID: memberAsk.id })),
        )
        expect(pending.id).toBe(memberAsk.id)
        yield* Effect.tryPromise(() =>
          memberClient.permission.reply({ sessionID: memberSession.id, requestID: memberAsk.id, reply: "once" }),
        )

        yield* Effect.tryPromise(() =>
          app.client["api.config"].update({
            ...config,
            permissions: [
              { action: "read", resource: "*", effect: "deny", user: data.owner.properties.userID },
              { action: "read", resource: "private", effect: "ask", user: member.properties.userID },
            ],
          }),
        )
        const tools = yield* Effect.tryPromise(() => app.client.permission.tools.list({ workspace }))
        expect(tools.some((tool) => tool.action === "read")).toBe(true)
        yield* Effect.tryPromise(() =>
          app.client.permission.tools.update({
            workspace,
            user: member.properties.userID,
            tools: [{ action: "read", effect: "allow" }],
          }),
        )
        yield* Effect.tryPromise(() =>
          app.client.permission.tools.update({ workspace, tools: [{ action: "read", effect: "deny" }] }),
        )
        const memberTools = yield* Effect.tryPromise(() =>
          app.client.permission.tools.list({ workspace, user: member.properties.userID }),
        )
        const ownerTools = yield* Effect.tryPromise(() =>
          app.client.permission.tools.list({ workspace, user: data.owner.properties.userID }),
        )
        expect(memberTools.find((tool) => tool.action === "read")?.effect).toBe("allow")
        expect(ownerTools.find((tool) => tool.action === "read")?.effect).toBe("deny")
        const preserved = yield* Effect.tryPromise(() => app.client["api.config"].get({ workspace }))
        expect(preserved.permissions).toEqual(
          expect.arrayContaining([
            { action: "read", resource: "*", effect: "deny", user: data.owner.properties.userID },
            { action: "read", resource: "private", effect: "ask", user: member.properties.userID },
            { action: "read", resource: "*", effect: "allow", user: member.properties.userID },
            { action: "read", resource: "*", effect: "deny" },
          ]),
        )

        const foreignAccount = yield* app.process(
          CoreAuth.Service.use((auth) =>
            auth.resolve(
              Auth.Assertion.make({
                provider: Auth.Provider.make("test"),
                subject: Auth.Sub.make("test-foreign"),
                verifiedEmail: Auth.Email.make("foreign@bymorning.ai"),
              }),
            ),
          ),
        )
        const foreign = yield* app.process(
          CoreUser.Service.use((users) => users.select({ account: foreignAccount })),
        )
        const foreignDenied = yield* Effect.tryPromise(() =>
          app.client.permission.tools.update({
            workspace,
            user: foreign.properties.userID,
            tools: [{ action: "read", effect: "allow" }],
          }),
        ).pipe(Effect.flip)
        expect(foreignDenied.cause).toMatchObject({
          _tag: "Protocol.InputError",
          error: "Selected member is unavailable in this Workspace",
        })

        const memberConfig = yield* Effect.tryPromise(() => memberClient["api.config"].get({ workspace }))
        const configDenied = yield* Effect.tryPromise(() =>
          memberClient["api.config"].update({
            ...memberConfig,
            permissions: [{ action: "workspace-fallback", resource: "*", effect: "deny" }],
          }),
        ).pipe(Effect.flip)
        expect(configDenied.cause).toMatchObject({ _tag: "ForbiddenError" })

        const toolsDenied = yield* Effect.tryPromise(() => memberClient.permission.tools.update({ workspace, tools: [] })).pipe(
          Effect.flip,
        )
        expect(toolsDenied.cause).toMatchObject({ _tag: "Protocol.InputError" })

        const [defaultAgent] = yield* Effect.tryPromise(() => memberClient.agent.list({ workspace }))
        if (defaultAgent === undefined) return yield* Effect.die(new Error("Fixture default Agent missing"))
        const empty = yield* Effect.tryPromise(() =>
          memberClient.agent.create({
            ...defaultAgent,
            id: Agent.ID.make("member-empty"),
            name: Agent.Name.make("Member empty"),
            // Everything a member creates is a subagent of the Default Agent.
            mode: "subagent",
            permissions: [],
          }),
        )
        expect(empty.permissions).toEqual([])
        const { id: _, ...agentUpdate } = defaultAgent
        const agentDenied = yield* Effect.tryPromise(() =>
          memberClient.agent.update({
            workspace,
            id: defaultAgent.id,
            ...agentUpdate,
            permissions: [{ action: "workspace-fallback", resource: "*", effect: "deny" }],
          }),
        ).pipe(Effect.flip)
        expect(agentDenied.cause).toMatchObject({ _tag: "ForbiddenError" })
      }),
    ),
    { signal },
  )
})
