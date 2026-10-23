import { describe, expect, it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Account } from "@bymorning/schema/account"
import { Integration as IntegrationSchema } from "@bymorning/schema/integration"
import { Event as McpEvent } from "@bymorning/schema/outbound-mcp"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { Context, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { Actor } from "../src/actor.js"
import * as Bus from "../src/bus.js"
import * as Credential from "../src/credential.js"
import * as Integration from "../src/integration.js"
import type { IntegrationOAuthCallback } from "../src/integration-oauth-callback.js"
import * as Mcp from "../src/mcp.js"
import * as AppProcess from "../src/util/process.js"
import { offlineAccount } from "./fixtures/offline-account.js"
import { server } from "./mcp/transport.js"

const workspaceID = Workspace.ID.make("wrk_mcp_values")
const tool = { name: "lookup", description: "Look something up", inputSchema: { type: "object" } }

/** Member-scoped in-memory Credentials: each member graph sees only its own. */
const memberCredentials = () =>
  Layer.sync(Credential.Service, () => {
    const values = new Map<Credential.ID, Credential.Info>()
    const visible = () => [...values.values()]
    return Credential.Service.of({
      client: {
        configured: () => Effect.succeed([]),
        resolve: () => Effect.succeed({}),
        put: () => Effect.void,
        remove: () => Effect.succeed(false),
      },
      all: () => Effect.sync(visible),
      list: (integrationID, scope) =>
        Effect.sync(() =>
          visible().filter((item) => item.integrationID === integrationID && (scope === undefined || item.scope === scope)),
        ),
      get: (id) => Effect.sync(() => values.get(id)),
      create: (input) =>
        Effect.sync(() => {
          for (const [id, item] of values)
            if (item.integrationID === input.integrationID) values.set(id, new Credential.Info({ ...item, active: false }))
          const created = new Credential.Info({
            id: Credential.ID.create(),
            integrationID: input.integrationID,
            label: input.label ?? "default",
            scope: input.scope ?? "workspace",
            active: true,
            value: input.value,
          })
          values.set(created.id, created)
          return created
        }),
      activate: () => Effect.void,
      update: (id, updates) =>
        Effect.sync(() => {
          const current = values.get(id)
          if (current !== undefined) values.set(id, new Credential.Info({ ...current, ...updates }))
        }),
      updateOAuth: () => Effect.succeed(false),
      removeOAuth: () => Effect.succeed(false),
      refreshOAuth: () => Effect.die("unused"),
      remove: (id) => Effect.sync(() => void values.delete(id)),
      discard: (integrationID) =>
        Effect.sync(() => {
          for (const [id, item] of values) if (item.integrationID === integrationID) values.delete(id)
        }),
      connected: () => Effect.succeed([]),
    })
  })

/** One member's retained graph: its own Credentials, Integration, Bus, and Mcp coordinator. */
const member = (name: string, email: string | null = `${name}@example.com`) =>
  Effect.gen(function* () {
    const accountID = Account.ID.make(`acc_${name}`)
    const binding = Layer.succeed(Actor.Binding.Service, {
      workspaceID,
      accountID,
      userID: User.ID.make(`usr_${name}`),
      role: "member",
    })
    const context = yield* Layer.build(
      Integration.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            memberCredentials(),
            Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie),
            LayerNode.compile(AppProcess.node),
            binding,
          ),
        ),
      ),
    )
    const integration = Context.get(context, Integration.Service)
    const bus = Context.get(context, Bus.Service)
    const mcp = yield* Mcp.make({
      integration,
      credential: Context.get(context, Credential.Service),
      oauthCallback: {} as IntegrationOAuthCallback.Interface,
      owner: { workspaceID, accountID, pluginID: "test" },
      bus,
      account: offlineAccount(email),
    })
    const status = (server: string) => Effect.map(mcp.servers(), (items) => items.find((item) => item.name === server))
    /** Save values and wait until the reconnect they trigger has settled. */
    const save = (server: string, url: string, values: Record<string, string>) =>
      Effect.gen(function* () {
        const changed = yield* (yield* bus.subscribe(McpEvent.ToolsChanged)).pipe(
          Stream.runHead,
          Effect.forkChild({ startImmediately: true }),
        )
        yield* integration.connection.values({
          integrationID: IntegrationSchema.ID.make(Mcp.identity(server, url)),
          values,
        })
        yield* Fiber.join(changed)
      })
    return { integration, mcp, status, save }
  })

const river = (url: string) =>
  ({
    type: "remote",
    url,
    oauth: false,
    codemode: false,
    headers: {
      JiraToken: "${JIRA_TOKEN}",
      Authorization: "Bearer ${CONFLUENCE_TOKEN}",
      UserEmail: "${member.email}",
      "X-Shared": "team",
    },
  }) as const

describe("Member Values", () => {
  it.effect("sends each member only their own values and does not contact the server for a member without values", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool)
      const jane = yield* member("jane")
      const bob = yield* member("bob")
      for (const graph of [jane, bob]) yield* graph.mcp.transform((editor) => editor.set("river", river(fixture.url)))

      const pending = yield* jane.status("river")
      expect(pending).toMatchObject({ status: "needs_auth", auth: "values" })
      expect(fixture.requests).toHaveLength(0)

      const method = (yield* jane.integration.get(IntegrationSchema.ID.make(Mcp.identity("river", fixture.url))))
        ?.methods.find((item) => item.type === "values")
      expect(method).toEqual({ type: "values", label: "Member values", fields: ["JIRA_TOKEN", "CONFLUENCE_TOKEN"], saved: [] })

      yield* jane.save("river", fixture.url, { JIRA_TOKEN: "jane-jira", CONFLUENCE_TOKEN: "jane-confluence" })
      expect(yield* jane.status("river")).toMatchObject({ status: "connected", auth: "values" })
      expect((yield* jane.mcp.tools()).map((item) => item.name)).toEqual(["lookup"])
      expect(fixture.requests.length).toBeGreaterThan(0)
      for (const request of fixture.requests)
        expect(request.headers).toMatchObject({
          jiratoken: "jane-jira",
          authorization: "Bearer jane-confluence",
          useremail: "jane@example.com",
          "x-shared": "team",
        })

      // Bob has no values: he is never connected and never borrows Jane's.
      expect(yield* bob.status("river")).toMatchObject({ status: "needs_auth" })
      expect(yield* bob.mcp.tools()).toEqual([])
      expect(fixture.requests.some((request) => request.headers.jiratoken !== "jane-jira")).toBe(false)

      // Saved names are projected; values never are.
      const saved = yield* jane.integration.get(IntegrationSchema.ID.make(Mcp.identity("river", fixture.url)))
      expect(saved?.methods.find((item) => item.type === "values")).toMatchObject({
        saved: ["JIRA_TOKEN", "CONFLUENCE_TOKEN"],
      })
      expect(JSON.stringify(saved)).not.toContain("jane-jira")
      expect(JSON.stringify(yield* jane.mcp.servers())).not.toContain("jane-jira")
    }),
  )

  it.effect("reports values the server rejects as failed and keeps them replaceable", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool, {
        reject: (_url, headers) => (headers.jiratoken === "wrong" ? 401 : undefined),
      })
      const jane = yield* member("jane")
      yield* jane.mcp.transform((editor) => editor.set("river", river(fixture.url)))
      yield* jane.save("river", fixture.url, { JIRA_TOKEN: "wrong", CONFLUENCE_TOKEN: "jane-confluence" })
      expect(yield* jane.status("river")).toMatchObject({
        status: "failed",
        error: "Server rejected your values",
        integrationID: Mcp.identity("river", fixture.url),
      })

      // Replacing one value keeps the other saved value.
      yield* jane.save("river", fixture.url, { JIRA_TOKEN: "right" })
      expect(yield* jane.status("river")).toMatchObject({ status: "connected" })
      expect(fixture.requests.at(-1)?.headers).toMatchObject({
        jiratoken: "right",
        authorization: "Bearer jane-confluence",
      })
    }),
  )

  it.effect("refuses invalid values without saving them", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool)
      const jane = yield* member("jane")
      yield* jane.mcp.transform((editor) => editor.set("river", river(fixture.url)))
      const integrationID = IntegrationSchema.ID.make(Mcp.identity("river", fixture.url))
      const attempt = (values: Record<string, string>) =>
        jane.integration.connection.values({ integrationID, values }).pipe(Effect.flip, Effect.map((error) => error.message))
      expect(yield* attempt({ OTHER: "x", JIRA_TOKEN: "a", CONFLUENCE_TOKEN: "b" })).toBe("Unknown value: OTHER")
      expect(yield* attempt({ JIRA_TOKEN: "a\r\nX-Injected: 1", CONFLUENCE_TOKEN: "b" })).toContain("line break")
      expect(yield* attempt({ JIRA_TOKEN: "a" })).toBe("Missing values: CONFLUENCE_TOKEN")
      expect(yield* attempt({ JIRA_TOKEN: "", CONFLUENCE_TOKEN: "b" })).toBe("Value for JIRA_TOKEN is empty")
      expect(yield* jane.status("river")).toMatchObject({ status: "needs_auth" })
      expect(fixture.requests).toHaveLength(0)
    }),
  )

  it.effect("never combines OAuth with member values", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool)
      const jane = yield* member("jane")
      yield* jane.mcp.transform((editor) =>
        editor.set("river", { type: "remote", url: fixture.url, headers: { JiraToken: "${JIRA_TOKEN}" } }),
      )
      expect(yield* jane.status("river")).toMatchObject({
        status: "failed",
        error: "A server cannot combine OAuth with member values; set oauth to false",
      })
      expect(fixture.requests).toHaveLength(0)
      const refused = yield* jane.mcp.authorize({ server: "river", elicit: () => Effect.die("unused") }).pipe(Effect.exit)
      expect(Exit.isFailure(refused)).toBe(true)
    }),
  )

  it.effect("fails without contacting the server when the member has no verified email", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool)
      const jane = yield* member("jane", null)
      yield* jane.mcp.transform((editor) =>
        editor.set("river", { type: "remote", url: fixture.url, oauth: false, headers: { UserEmail: "${member.email}" } }),
      )
      expect(yield* jane.status("river")).toMatchObject({
        status: "failed",
        error: "Your account has no verified email for ${member.email}",
      })
      expect(fixture.requests).toHaveLength(0)
    }),
  )

  it.effect("sends escaped literal header text unchanged and needs no member values", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool)
      const jane = yield* member("jane")
      yield* jane.mcp.transform((editor) =>
        editor.set("plain", { type: "remote", url: fixture.url, oauth: false, headers: { "X-Template": "$${literal}" } }),
      )
      expect(yield* jane.status("plain")).toMatchObject({ status: "connected" })
      expect((yield* jane.status("plain"))?.auth).toBeUndefined()
      expect(fixture.requests[0]?.headers["x-template"]).toBe("${literal}")
    }),
  )

  it.effect("tells the agent where to save member values instead of collecting them in a conversation", () =>
    Effect.gen(function* () {
      const fixture = yield* server(tool)
      const jane = yield* member("jane")
      yield* jane.mcp.transform((editor) => editor.set("river", river(fixture.url)))
      const error = yield* jane.mcp.authorize({ server: "river", elicit: () => Effect.die("unused") }).pipe(Effect.flip)
      // Members cannot open the Console, so the message names the palette path every member has.
      expect(error.message).toContain("Connect integration")
      expect(error.message).toContain('"river MCP"')
    }),
  )
})
