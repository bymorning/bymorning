import { describe, expect, it } from "vitest"
import type { Context } from "@bymorning/plugin/effect/plugin"
import { Agent } from "@bymorning/schema/agent"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { ID as MessageID } from "@bymorning/schema/message"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Project } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import { Session } from "@bymorning/schema/session"
import { Effect } from "effect"
import { registerIntegrationTools } from "../src/plugin/internal/tool/toolkit-integration.js"
import { registerPluginTools } from "../src/plugin/internal/tool/toolkit-plugin.js"
import { Tool } from "../src/tool.js"

const projectID = Project.ID.make("prj_00000000000000000000000921")

const context = (permissions: Array<{ action: string; resources: readonly string[] }> = []): Tool.Context => ({
  caller: {
    type: "session",
    sessionID: Session.ID.make("00000000-0000-4000-8000-000000000901"),
    messageID: MessageID.make("00000000-0000-4000-8000-000000000902"),
    agent: Agent.ID.make("build"),
    projectID,
  },
  id: Tool.CallID.make("call"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: (request) =>
    Effect.sync(() => {
      permissions.push({ action: request.action, resources: request.resources })
    }),
})

const editor = (added: Tool.Registration[]) => ({
  list: () => [],
  get: () => undefined,
  namespace: () => undefined,
  update: () => undefined,
  remove: () => undefined,
  add: (tool: Tool.Registration) => added.push(tool),
})

const inventory: PluginSchema.Info[] = [
  { id: PluginSchema.ID.make("bymorning.toolkit"), source: { type: "builtin" }, status: "active", tui: false },
  {
    id: PluginSchema.ID.make("project.probe"),
    source: { type: "project", projectID, path: ProjectDirectory.Path.make("plugin/probe.ts") },
    status: "active",
    tui: false,
    tools: ["probe_echo"],
    integrations: [Integration.ID.make("example")],
  },
  {
    source: { type: "project", projectID, path: ProjectDirectory.Path.make("plugin/broken.ts") },
    status: "failed",
    error: "Plugin failed to load",
    ref: "err_12345678",
    tui: false,
  },
  {
    id: PluginSchema.ID.make("local.secret"),
    source: { type: "local", path: "/srv/bymorning/plugins/secret.ts" },
    status: "active",
    tui: false,
  },
  {
    id: PluginSchema.ID.make("google.gmail.openapi"),
    source: { type: "package", package: "@bymorning/plugin-google", version: "1.2.3" },
    status: "active",
    tui: false,
  },
]

describe("toolkit.plugin", () => {
  it("lists the inventory with status, redacted error, and Project-relative paths only", () =>
    Effect.gen(function* () {
      const added: Tool.Registration[] = []
      registerPluginTools(editor(added), { plugin: { list: () => Effect.succeed(inventory) } })
      const list = added.find((tool) => tool.name === "list" && tool.execute !== undefined)
      if (list?.execute === undefined) throw new Error("plugin list tool missing")
      expect(list.options).toMatchObject({ namespace: "toolkit.plugin", permission: "plugin_list" })

      const permissions: Array<{ action: string; resources: readonly string[] }> = []
      const listed = yield* list.execute({}, context(permissions))
      expect(permissions).toEqual([{ action: "plugin_list", resources: ["plugin"] }])
      expect(listed.output).toEqual({
        plugins: [
          { id: "bymorning.toolkit", source: { type: "builtin" }, status: "active" },
          {
            id: "project.probe",
            source: { type: "project", projectID, path: "plugin/probe.ts" },
            status: "active",
            tools: ["probe_echo"],
            integrations: ["example"],
          },
          {
            source: { type: "project", projectID, path: "plugin/broken.ts" },
            status: "failed",
            error: "Plugin failed to load",
            ref: "err_12345678",
          },
          { id: "local.secret", source: { type: "local" }, status: "active" },
          {
            id: "google.gmail.openapi",
            source: { type: "package", package: "@bymorning/plugin-google", version: "1.2.3" },
            status: "active",
          },
        ],
      })
      expect(JSON.stringify(listed.output)).not.toContain("/srv/")

      const failed = yield* list.execute({ status: "failed" }, context())
      expect(failed.output).toMatchObject({ plugins: [{ status: "failed", source: { path: "plugin/broken.ts" } }] })
      const project = yield* list.execute({ source: "project" }, context())
      expect((project.output as { plugins: unknown[] }).plugins).toHaveLength(2)
    }).pipe(Effect.runPromise))
})

const infos: Integration.Info[] = [
  {
    id: Integration.ID.make("google-gmail"),
    name: "Google Gmail",
    connectionPolicy: "member-only",
    methods: [
      {
        id: Integration.MethodID.make("oauth"),
        type: "oauth",
        label: "Google OAuth web app",
        client: {
          fields: [{ key: "client_id", type: "string", title: "OAuth client ID", required: true }],
          configured: false,
        },
      },
    ],
    connections: [],
  },
  {
    id: Integration.ID.make("example"),
    name: "Example",
    methods: [
      { type: "key", label: "API key" },
      { type: "env", names: ["EXAMPLE_API_KEY"] },
    ],
    connections: [{ type: "credential", id: Credential.ID.make("cred_1"), label: "owner", scope: "member", active: true }],
  },
]

describe("toolkit.integration.list", () => {
  it("lists Integrations with method readiness and the member's connection state, without client fields or secrets", () =>
    Effect.gen(function* () {
      const added: Tool.Registration[] = []
      const integration = {
        list: () => Effect.succeed(infos),
        connection: {
          active: (integrationID: string) =>
            Effect.succeed(infos.find((info) => info.id === integrationID)?.connections.find((c) => "active" in c && c.active)),
        },
      } as unknown as Context["integration"]
      registerIntegrationTools(editor(added), { integration })
      const list = added.find((tool) => tool.name === "list" && tool.execute !== undefined)
      if (list?.execute === undefined) throw new Error("integration list tool missing")
      expect(list.options).toMatchObject({ namespace: "toolkit.integration", permission: "integration_list" })

      const permissions: Array<{ action: string; resources: readonly string[] }> = []
      const listed = yield* list.execute({}, context(permissions))
      expect(permissions).toEqual([{ action: "integration_list", resources: ["integration"] }])
      expect(listed.output).toEqual({
        integrations: [
          {
            id: "google-gmail",
            name: "Google Gmail",
            connectionPolicy: "member-only",
            methods: [{ id: "oauth", type: "oauth", label: "Google OAuth web app", configured: false }],
            connected: false,
          },
          {
            id: "example",
            name: "Example",
            methods: [{ type: "key", label: "API key" }, { type: "env" }],
            connected: true,
          },
        ],
      })
      expect(JSON.stringify(listed.output)).not.toContain("client_id")
      expect(JSON.stringify(listed.output)).not.toContain("EXAMPLE_API_KEY")
    }).pipe(Effect.runPromise))
})
