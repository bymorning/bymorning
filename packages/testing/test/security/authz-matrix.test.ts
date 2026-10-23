/**
 * CMMC L2 authorization matrix (NIST 3.1.5 least privilege, 3.1.7 privileged
 * functions): Workspace members may read and converse, but every
 * security-relevant mutation — automation identity, Spend Limits, Managed
 * Policy, risky Config sections, shared Model/Skill management, and
 * Workspace-scoped Connections — is reserved for Workspace administrators.
 * Each test carries a stable [SEC-AUTHZ-nn] identifier for compliance reports.
 */
import { Agent } from "@bymorning/schema/agent"
import { Auth } from "@bymorning/schema/auth"
import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../../src/application.js"
import { Chat } from "../../src/scenario/chat.js"

const memberEmail = Auth.Email.make("member@bymorning.ai")

/** Log in the Workspace owner (admin) and one invited member with an independent cookie jar. */
const members = Effect.fn("Authz.members")(function* (app: TestApp.Interface) {
  const admin = yield* app.login()
  yield* Effect.tryPromise(() => app.client.user.invite({ email: memberEmail, role: "member" }))
  const memberClient = app.clientFor()
  const member = yield* app.login(memberClient, { subject: Auth.Sub.make("test-member"), email: memberEmail })
  return { admin, member, memberClient }
})

/** Assert the SDK call fails with the expected typed error tag. */
const refused = (tag: string, operation: () => Promise<unknown>) =>
  Effect.gen(function* () {
    const error = yield* Effect.tryPromise(operation).pipe(Effect.flip)
    expect(error.cause ?? error).toMatchObject({ _tag: tag })
  })

const forbidden = (operation: () => Promise<unknown>) => refused("ForbiddenError", operation)
const unauthorized = (operation: () => Promise<unknown>) => refused("UnauthorizedError", operation)

test("[SEC-AUTHZ-01] Service Account CRUD and API-key minting require the admin Role", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { memberClient } = yield* members(app)

      // Members keep read visibility; automation identity changes are admin-only.
      yield* Effect.tryPromise(() => memberClient.serviceAccount.list())
      yield* forbidden(() => memberClient.serviceAccount.create({ name: "Member automation" }))

      const account = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "CI gateway" }))
      yield* Effect.tryPromise(() => memberClient.serviceAccount.get({ id: account.id }))
      yield* forbidden(() => memberClient.serviceAccount.update({ id: account.id, status: "suspended" }))
      yield* forbidden(() => memberClient.serviceAccount.key.create({ id: account.id, name: "Member minted" }))

      const issued = yield* Effect.tryPromise(() =>
        app.client.serviceAccount.key.create({ id: account.id, name: "Production" }),
      )
      yield* Effect.tryPromise(() => memberClient.serviceAccount.key.list({ id: account.id }))
      yield* forbidden(() => memberClient.serviceAccount.key.revoke({ id: account.id, keyID: issued.key.id }))
      yield* Effect.tryPromise(() => app.client.serviceAccount.key.revoke({ id: account.id, keyID: issued.key.id }))
      yield* forbidden(() => memberClient.serviceAccount.remove({ id: account.id }))
      yield* Effect.tryPromise(() => app.client.serviceAccount.remove({ id: account.id }))
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-02] Spend Limit mutation for any Holder requires the admin Role", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { member, memberClient } = yield* members(app)

      yield* Effect.tryPromise(() => memberClient.budget.status())
      yield* forbidden(() => memberClient.budget.limit({ target: { type: "workspace" }, amount: 5 }))
      yield* forbidden(() =>
        memberClient.budget.limit({ target: { type: "user", userID: member.properties.userID }, amount: 5 }),
      )

      const standing = yield* Effect.tryPromise(() =>
        app.client.budget.limit({ target: { type: "workspace" }, amount: 5 }),
      )
      expect(standing).toMatchObject({ target: { type: "workspace" }, limit: 5 })
      const status = yield* Effect.tryPromise(() => memberClient.budget.status())
      expect(status.standings.find((row) => row.target.type === "workspace")).toMatchObject({ limit: 5 })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-03] Managed Policy create/update/delete/setEnabled require the admin Role", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { memberClient } = yield* members(app)
      const definition = {
        id: "cui-guardrail",
        name: "CUI guardrail",
        rules: [{ type: "guardrail", action: "tool.execute", resource: "shell", effect: "deny" }],
      } as const

      // The Role gate precedes Managed Policy resolution, so member refusals are stable 403s.
      yield* forbidden(() => memberClient["api.policy"].create(definition))
      yield* forbidden(() => memberClient["api.policy"].update({ policyID: "cui-guardrail", ...definition }))
      yield* forbidden(() => memberClient["api.policy"].setEnabled({ policyID: "cui-guardrail", enabled: false }))
      yield* forbidden(() => memberClient["api.policy"].delete({ policyID: "cui-guardrail" }))

      // An administrator passes the Role gate. The Managed Policy capability is not yet
      // wired into the production Workspace graph on this branch, so the call may fail
      // downstream — it must never fail with ForbiddenError.
      const admin = yield* Effect.tryPromise(() => app.client["api.policy"].create(definition)).pipe(Effect.flip)
      expect(admin.cause ?? admin).not.toMatchObject({ _tag: "ForbiddenError" })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-04] security-relevant Workspace Config sections refuse member writes", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { memberClient } = yield* members(app)
      const current = yield* Effect.tryPromise(() => memberClient["api.config"].get())

      // A byte-identical round-trip changes nothing and stays allowed for members.
      yield* Effect.tryPromise(() => memberClient["api.config"].update({ ...current }))
      // Session compaction tuning is operational, not a security boundary.
      yield* Effect.tryPromise(() =>
        memberClient["api.config"].update({ ...current, compaction: { ...current.compaction, auto: false } }),
      )

      yield* forbidden(() =>
        memberClient["api.config"].update({
          ...current,
          plugins: [...(current.plugins ?? []), "@evil/cui-egress"],
        }),
      )
      yield* forbidden(() => memberClient["api.config"].update({ ...current, providers: { allow: [] } }))
      yield* forbidden(() =>
        memberClient["api.config"].update({
          ...current,
          routing: [{ from: Chat.model, to: Chat.routedModel }],
        }),
      )
      yield* forbidden(() => memberClient["api.config"].update({ ...current, gateway: { limits: { rpm: 1 } } }))
      yield* forbidden(() => memberClient["api.config"].update({ ...current, websearch: { provider: "random" } }))
      yield* forbidden(() =>
        memberClient["api.config"].update({
          ...current,
          code_interpreter: { implementation: CodeInterpreter.ID.make("member-selected") },
        }),
      )
      yield* forbidden(() =>
        memberClient["api.config"].update({ ...current, tool_output: { max_lines: 100_000, max_bytes: 50_000_000 } }),
      )
      yield* forbidden(() =>
        memberClient["api.config"].update({ ...current, default_agent: Agent.ID.make("member-picked") }),
      )
      yield* forbidden(() =>
        memberClient["api.config"].update({
          ...current,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        }),
      )

      const routed = yield* Effect.tryPromise(() =>
        app.client["api.config"].update({ ...current, routing: [{ from: Chat.model, to: Chat.routedModel }] }),
      )
      // The Routing schema normalizes the legacy `from` shorthand to a match condition.
      expect(routed.routing).toEqual([{ match: { model: Chat.model }, to: Chat.routedModel }])
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-05] Skill create/update/delete require the admin Role", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const { memberClient } = yield* members(app)
      const input = { name: "Review", description: "Reviews changes", instructions: "Inspect carefully" }

      // Members read the effective catalog (including built-in contributions) but cannot change it.
      const listed = yield* Effect.tryPromise(() => memberClient.skill.list())
      const builtIn = listed[0]
      if (builtIn === undefined) return yield* Effect.die(new Error("Built-in Skill missing"))
      yield* Effect.tryPromise(() => memberClient.skill.get({ skillID: builtIn.id }))
      yield* forbidden(() => memberClient.skill.create(input))
      yield* forbidden(() => memberClient.skill.update({ skillID: builtIn.id, ...input }))
      yield* forbidden(() => memberClient.skill.delete({ skillID: builtIn.id }))

      const skill = yield* Effect.tryPromise(() => app.client.skill.create(input))
      const renamed = yield* Effect.tryPromise(() => app.client.skill.update({ skillID: skill.id, ...input }))
      expect(renamed).toMatchObject({ id: skill.id, name: input.name })
      yield* Effect.tryPromise(() => app.client.skill.delete({ skillID: skill.id }))
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-06] shared Model enablement and default require the admin Role", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* Chat.make(app)
      const { memberClient } = yield* members(app)

      const models = yield* Effect.tryPromise(() => memberClient.model.list({ provider: Chat.model.provider }))
      expect(models.some((model) => model.info.id === Chat.model.id)).toBe(true)
      yield* forbidden(() => memberClient.model.toggle({ ...Chat.model, enabled: false }))
      yield* forbidden(() => memberClient.model.default({ ...Chat.model }))

      const disabled = yield* Effect.tryPromise(() => app.client.model.toggle({ ...Chat.model, enabled: false }))
      expect(disabled.find((model) => model.info.id === Chat.model.id)?.enabled).toBe(false)
      yield* Effect.tryPromise(() => app.client.model.toggle({ ...Chat.model, enabled: true }))
      const preferred = yield* Effect.tryPromise(() => app.client.model.default({ ...Chat.model }))
      expect(preferred.find((model) => model.info.id === Chat.model.id)?.isPreferredDefault).toBe(true)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-07] Workspace Connections, OAuth client setup, and shared Credentials require the admin Role", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* Chat.make(app)
      const { memberClient } = yield* members(app)
      const integrationID = Integration.ID.make(Provider.OpenCode)
      const methodID = Integration.MethodID.make("oauth")

      // An omitted scope resolves to a shared Workspace Connection: admin-only.
      yield* forbidden(() => memberClient.integration.connect.key({ integrationID, key: "member-workspace-key" }))
      // A member may still hold a personal Connection on the same Integration.
      yield* Effect.tryPromise(() =>
        memberClient.integration.connect.key({ integrationID, scope: "member", key: "member-personal-key" }),
      )
      // Workspace OAuth application setup is shared by every authorization for its method.
      yield* forbidden(() =>
        memberClient.integration.oauth.client.put({ integrationID, methodID, answer: { client_id: "id" } }),
      )
      yield* forbidden(() => memberClient.integration.oauth.client.remove({ integrationID, methodID }))
      // An administrator passes the Role gate; the unknown method then fails as a domain error, never 403.
      yield* refused("Integration.OAuthMethodNotFoundError", () =>
        app.client.integration.oauth.client.put({ integrationID, methodID, answer: { client_id: "id" } }),
      )

      yield* Effect.tryPromise(() => app.client.integration.connect.key({ integrationID, key: "admin-workspace-key" }))
      const info = yield* Effect.tryPromise(() => app.client.integration.get({ integrationID }))
      const shared = info?.connections.find((connection) => "scope" in connection && connection.scope !== "member")
      if (shared === undefined || !("id" in shared)) return yield* Effect.die(new Error("Workspace Connection missing"))
      yield* forbidden(() => memberClient.credential.remove({ credentialID: shared.id }))
      yield* forbidden(() => memberClient.credential.update({ credentialID: shared.id, label: "Relabeled" }))
      yield* forbidden(() => memberClient.credential.activate({ credentialID: shared.id }))
      yield* Effect.tryPromise(() => app.client.credential.update({ credentialID: shared.id, label: "Production" }))
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-08] members of one Workspace cannot read or mutate another Workspace", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const data = yield* Chat.make(app)
      const first = data.owner.properties.workspaceID
      const { memberClient } = yield* members(app)

      // A second Account provisions its own Workspace through the same public login path.
      const outsiderClient = app.clientFor()
      const outsider = yield* app.login(outsiderClient, {
        subject: Auth.Sub.make("test-outsider"),
        email: Auth.Email.make("outsider@bymorning.ai"),
      })
      const second = outsider.properties.workspaceID
      expect(second).not.toBe(first)

      // The outsider (admin of their own Workspace) gets 401 against the first Workspace.
      yield* unauthorized(() => outsiderClient["api.config"].get({ workspace: first }))
      yield* unauthorized(() => outsiderClient.project.list({ workspace: first }))
      yield* unauthorized(() => outsiderClient.budget.status({ workspace: first }))
      yield* unauthorized(() => outsiderClient.serviceAccount.list({ workspace: first }))
      yield* unauthorized(() => outsiderClient["api.policy"].list({ workspace: first }))
      yield* unauthorized(() => outsiderClient.skill.list({ workspace: first }))
      yield* unauthorized(() =>
        outsiderClient.project.directory.read({ projectID: data.project.id, path: data.path, workspace: first }),
      )
      yield* unauthorized(() =>
        outsiderClient.project.directory.delete({ projectID: data.project.id, path: data.path, workspace: first }),
      )
      yield* unauthorized(() =>
        outsiderClient.project.directory.move({
          projectID: data.project.id,
          from: data.path,
          to: "taken.txt",
          workspace: first,
        }),
      )
      yield* unauthorized(() => outsiderClient["api.config"].update({ workspace: first, permissions: [] }))
      yield* unauthorized(() =>
        outsiderClient.budget.limit({ workspace: first, target: { type: "workspace" }, amount: 0 }),
      )
      // Persisted Session endpoints bind the Session's recorded owner, not the requested Workspace.
      yield* unauthorized(() => outsiderClient.session.get({ sessionID: data.session.id }))

      // A member of the first Workspace is equally bound away from the second.
      yield* unauthorized(() => memberClient["api.config"].get({ workspace: second }))
      yield* unauthorized(() => memberClient.project.list({ workspace: second }))
      // Session records bind their owning Account: another member of the same Workspace is refused too.
      yield* unauthorized(() => memberClient.session.get({ sessionID: data.session.id }))

      // The refused file changes left the first Workspace's Project file in place.
      const files = yield* Effect.tryPromise(() =>
        app.client.project.directory.list({ projectID: data.project.id, workspace: first }),
      )
      expect(files.paths).toEqual([data.path])

      // Both retain full access to their own Workspace.
      yield* Effect.tryPromise(() => app.client["api.config"].get({ workspace: first }))
      yield* Effect.tryPromise(() => outsiderClient["api.config"].get({ workspace: second }))
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-AUTHZ-09] a Service Account Key cannot drive the browser control plane", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      yield* app.login()
      const account = yield* Effect.tryPromise(() => app.client.serviceAccount.create({ name: "Automation" }))
      const issued = yield* Effect.tryPromise(() =>
        app.client.serviceAccount.key.create({ id: account.id, name: "Inference" }),
      )
      // The control plane authenticates Login Session cookies only; a minted Key is 401 there.
      const response = yield* Effect.tryPromise(() =>
        fetch(new URL("/api/service-account", app.origin), {
          headers: { authorization: `Bearer ${issued.secret}` },
        }),
      )
      expect(response.status).toBe(401)
    }).pipe(Effect.scoped),
    { signal },
  )
})
