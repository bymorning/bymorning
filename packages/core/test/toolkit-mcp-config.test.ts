import { describe, expect, it } from "vitest"
import { Agent } from "@bymorning/schema/agent"
import { ConfigSchema } from "@bymorning/schema/config"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Effect, Stream } from "effect"
import { Config } from "../src/config.js"
import { Mcp } from "../src/mcp.js"
import { registerMcpTools } from "../src/plugin/internal/tool/toolkit-mcp.js"
import { Tool } from "../src/tool.js"

const configInfo = ConfigSchema.Info.make({
  default_agent: Agent.ID.make("build"),
  default_model: { provider: Provider.Name.make("bymorning"), id: "gpt-5.6-luna" },
  permissions: [],
  compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
  model_policy: { disabled: [], seen: [], initialized: [] },
  mcp: {
    servers: {
      linear: { type: "remote", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer secret" } },
    },
  },
})

const context = (): Tool.Context => ({
  caller: {
    type: "session",
    sessionID: Session.ID.make("00000000-0000-4000-8000-000000000911"),
    messageID: MessageID.make("00000000-0000-4000-8000-000000000912"),
    agent: Agent.ID.make("build"),
    projectID: Project.ID.make("prj_00000000000000000000000931"),
  },
  id: Tool.CallID.make("call"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: () => Effect.void,
})

describe("toolkit.mcp configuration", () => {
  it("lists configured servers without secrets or configuration mutation tools", () =>
    Effect.gen(function* () {
      let info = configInfo
      const config = Config.Service.of({
        provider: { update: () => Effect.die("unused") },
        model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
        get: Effect.sync(() => info),
        update: () => Effect.die("unused"),
        refresh: Effect.die("unused"),
        mcp: {
          update: () => Effect.die("unused"),
          put: (name, server) =>
            Effect.sync(() => {
              info = {
                ...info,
                mcp: { ...info.mcp, servers: { ...info.mcp?.servers, [name]: server } },
              }
              return info
            }),
          remove: () => Effect.die("unused"),
        },
        modelPolicy: {
          reconcile: () => Effect.die("unused"),
          initialize: () => Effect.die("unused"),
          toggle: () => Effect.die("unused"),
          setDefault: () => Effect.die("unused"),
        },
        plugin: Config.pluginUnavailable,
        entries: () => Effect.succeed([{ type: "document" as const, info }]),
        changes: () => Stream.never,
      })
      const added: Tool.Registration[] = []
      registerMcpTools(
        {
          list: () => [],
          get: () => undefined,
          namespace: () => undefined,
          update: () => undefined,
          remove: () => undefined,
          add: (tool) => added.push(tool),
        },
        {
          mcp: Mcp.Service.of({
            servers: () => Effect.succeed([]),
            connect: () => Effect.die("unused"),
            disconnect: () => Effect.die("unused"),
            authorize: () => Effect.die("unused"),
          } as never),
          mcpTool: { flush: Effect.void, refresh: Effect.void },
          config,
        },
      )
      const list = added.find((tool) => tool.name === "list" && tool.execute !== undefined)
      if (list?.execute === undefined) throw new Error("mcp list tool missing")
      expect(added.some((tool) => tool.name === "put" || tool.name === "remove")).toBe(false)
      const listed = yield* list.execute({}, context())
      expect(listed).toMatchObject({
        output: { servers: [{ name: "linear", url: "https://mcp.linear.app/mcp" }] },
      })
      expect(JSON.stringify(listed)).not.toContain("secret")
    }).pipe(Effect.runPromise))
})
