import { layer as storageLayer } from "./fixture/storage.js"
import { NodeCrypto } from "@effect/platform-node"
import { Database } from "../src/database.js"
import * as Binding from "../src/plugin/internal/tool/binding.js"
import { Skill } from "../src/skill.js"
import { WebSearch } from "../src/websearch.js"
import { Form } from "../src/form.js"
import { CodeInterpreter } from "../src/code-interpreter.js"
import { describe, expect, it } from "@effect/vitest"
import { Agent } from "@bymorning/schema/agent"
import { Account } from "@bymorning/schema/account"
import { ConfigSchema } from "@bymorning/schema/config"
import { Event } from "@bymorning/schema/event"
import { Provider } from "@bymorning/schema/provider"
import { Project } from "@bymorning/schema/project"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { readFile } from "node:fs/promises"
import { Bus } from "../src/bus.js"
import { Actor } from "../src/actor.js"
import { Config } from "../src/config.js"
import { Plugin } from "../src/plugin.js"
import type { PluginHost } from "../src/plugin/host.js"
import { PluginInternal } from "../src/plugin/internal.js"
import { PluginRuntime } from "../src/plugin/runtime.js"
import { BymorningSkill } from "../src/plugin/internal/skill/bymorning.js"
import { PermissionEvaluation } from "../src/permission/evaluation.js"
import { ProjectDirectory } from "../src/project-directory.js"
import { Project as WorkspaceProject } from "../src/project.js"
import { InstructionDiscovery } from "../src/instruction-discovery.js"
import { Storage } from "../src/storage.js"
import { State } from "../src/state.js"
import { Tool } from "../src/tool.js"
import { ToolOutput } from "../src/tool-output.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Mcp } from "../src/mcp.js"
import { McpTool } from "../src/tool/mcp.js"
import { Agent as AgentService } from "../src/agent.js"

const configInfo = ConfigSchema.Info.make({
  default_agent: Agent.ID.make("configured"),
  default_model: { provider: Provider.Name.make("bymorning"), id: "minimax-m2.7" },
  permissions: [],
  compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
  model_policy: { disabled: [], seen: [], initialized: [] },
  gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
})
const config = Config.Service.of({
  provider: { update: () => Effect.die("unused") },
  model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
  get: Effect.succeed(configInfo),
  update: () => Effect.die(new Error("unused")),
  refresh: Effect.die(new Error("unused")),
  mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
  modelPolicy: {
    reconcile: () => Effect.die("unused"),
    initialize: () => Effect.die("unused"),
    toggle: () => Effect.die("unused"),
    setDefault: () => Effect.die("unused"),
  },
  plugin: Config.pluginUnavailable,
  entries: () => Effect.succeed([{ type: "document", info: configInfo }]),
  changes: () => Stream.never,
})
const toolOutput = ToolOutput.Service.of({
  truncate: (_sessionID, result) => Effect.succeed(result),
  read: () => Effect.fail(new ToolOutput.UnavailableError({})),
  readForTool: () => Effect.fail(new ToolOutput.UnavailableError({})),
})
const busLayer = Layer.succeed(
  Bus.Service,
  Bus.Service.of({
    publish: ((definition: Event.Definition, data: unknown) =>
      Effect.succeed({
        id: Event.ID.make(crypto.randomUUID()),
        created: Date.now(),
        type: definition.type,
        data,
      } as Event.Payload<typeof definition>)) as Bus.Interface["publish"],
    subscribe: () => Effect.succeed(Stream.empty),
  }),
)
const runtime = { session: {}, job: {} } as PluginRuntime.Interface
const projectLayer = Layer.mock(WorkspaceProject.Service, { list: () => Effect.succeed([]) })
const instructionLayer = InstructionDiscovery.layer().pipe(Layer.provide(busLayer))
const http = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response("unused", { status: 500 }))),
)
// Bun interprets @effect/vitest's one-argument wrapper as callback-style once an Effect yields asynchronously.
const testEffect = <A, E>(
  name: string,
  effect: () => Effect.Effect<
    A,
    E,
    | Scope.Scope
    | HttpClient.HttpClient
    | Bus.Service
    | WorkspaceProject.Service
    | InstructionDiscovery.Service
    | Storage.Service
    | Tool.Service
    | AgentService.Service
    | Mcp.Service
    | McpTool.Service
    | Database.Service
    | import("effect").Crypto.Crypto
    | Binding.Service
    | Actor.Binding.Service
    | Skill.Service
    | WebSearch.Service
    | Form.Service
    | CodeInterpreter.Service
  >,
) =>
  it(name, () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.suspend(effect).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeCrypto.layer,
              Layer.mock(Database.Service, {}),
              Layer.mock(Skill.Service, {}),
              Layer.mock(WebSearch.Service, {}),
              Layer.mock(Form.Service, {}),
              CodeInterpreter.unavailable,
              Layer.succeed(
                Binding.Service,
                Binding.Service.of({
                  workspaceID: Workspace.ID.make("wrk_plugin_internal_test"),
                  provide: () => Effect.die("This catalog-only fixture does not execute builtins"),
                }),
              ),
              Layer.succeed(Actor.Binding.Service, {
                workspaceID: Workspace.ID.make("wrk_plugin_internal_test"),
                accountID: Account.ID.make("acc_plugin_internal_test"),
                userID: User.ID.make("usr_plugin_internal_test"),
                role: "admin",
              }),
              Layer.succeed(HttpClient.HttpClient, http),
              busLayer,
              projectLayer,
              instructionLayer,
              storageLayer,
              Tool.layer.pipe(Layer.provide(PluginHooks.layer)),
              Layer.mock(AgentService.Service, {}),
              Layer.mock(Mcp.Service, {}),
              Layer.succeed(McpTool.Service, McpTool.Service.of({ flush: Effect.void, refresh: Effect.void })),
            ),
          ),
        ),
      ),
    ),
  )

describe("PluginInternal", () => {
  it.effect("keeps the Bymorning Skill's code templates identical to the typechecked server fixtures", () =>
    Effect.gen(function* () {
      const templates = Array.from(BymorningSkill.instructions.matchAll(/```ts\n([\s\S]*?)```/g), (match) => match[1])
      expect(templates).toEqual(
        yield* Effect.forEach(["plugin", "agent", "skill", "tool"], (name) =>
          Effect.promise(() =>
            readFile(new URL(`../../server/test/fixtures/bymorning-${name}.ts`, import.meta.url), "utf8"),
          ),
        ),
      )
    }),
  )

  testEffect("installs every builtin product and scopes web search providers independently from its Tool", () =>
    Effect.gen(function* () {
      const root = yield* Scope.make()
      const tools = Context.get(
        yield* Layer.buildWithScope(Tool.layer.pipe(Layer.provide(PluginHooks.layer)), root),
        Tool.Service,
      )
      const agents = State.create({ initial: () => new Map<string, AgentEditor>(), editor: mapEditor })
      const skills = State.create({ initial: () => new Map<string, { id: string; name: string }>(), editor: skillEditor })
      const integrations = State.create({ initial: integrationInitial, editor: integrationEditor })
      const hooksContext = yield* Layer.build(PluginHooks.layer)
      const shellHooks = Context.get(hooksContext, PluginHooks.Service)
      const storage = yield* Storage.Service
      const internal = yield* PluginInternal.list(Effect.succeed({ all: [], available: [] }))
      // Dropping one of these silently disables project instructions, web-search config, or the MCP codemode exclusion.
      expect(internal.post.map((plugin) => plugin.id)).toEqual([
        "bymorning.config.instruction",
        "bymorning.config.agent",
        "bymorning.config.websearch",
        "bymorning.config.code-interpreter",
        "bymorning.config.mcp",
        "bymorning.mcp.codemode.exclusion",
      ])
      const plugins = Context.get(
        yield* Layer.buildWithScope(
          Plugin.layer(pluginHost(tools, agents, skills, integrations, shellHooks, storage)).pipe(Layer.provide(busLayer)),
          root,
        ),
        Plugin.Service,
      )

      yield* plugins.activate(internal.pre.map((plugin) => ({ ...plugin, revision: "internal" })))

      const snapshot = yield* tools.snapshot()
      expect(snapshot.definitions.map((tool) => tool.name)).toEqual([
        "add",
        "edit",
        "question",
        "read",
        "run",
        "shell",
        "sidebar",
        "skill",
        "subagent",
        "tool_output",
        "webfetch",
        "websearch",
        "write",
        "execute",
      ])
      expect(snapshot.codeModeCatalog?.tools.map((tool) => tool.name)).toEqual(["glob", "grep", "mcp_connect", "toolkit"])
      expect(JSON.stringify(snapshot.codeModeCatalog)).toContain("toolkit.mcp.connect")
      expect((yield* plugins.list()).find((plugin) => plugin.id === "bymorning.toolkit")).toMatchObject({
        status: "active",
        tools: expect.arrayContaining([
          "toolkit.integration.connect",
          "toolkit.integration.list",
          "toolkit.integration.status",
          "toolkit.plugin.list",
          "toolkit.mcp.connect",
          "toolkit.mcp.disconnect",
          "toolkit.mcp.status",
          "toolkit.mcp.list",
          "toolkit.policy.get",
          "toolkit.policy.update",
          "toolkit.skill.list",
          "toolkit.skill.get",
          "toolkit.skill.create",
          "toolkit.skill.update",
          "toolkit.skill.delete",
        ]),
      })
      expect(Array.from(agents.get().keys())).toEqual(["default", "general", "explore"])
      for (const name of ["default"]) {
        expect(agents.get().get(name)).toMatchObject({
          mode: "primary",
          hidden: false,
          steps: null,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })
      }
      expect(agents.get().get("general")).toMatchObject({
        name: "General",
        description:
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
        mode: "subagent",
        hidden: false,
        steps: null,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "question", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
        ],
      })
      expect(agents.get().get("general")).not.toHaveProperty("model")
      expect(agents.get().get("explore")).toMatchObject({
        name: "Explore",
        description:
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
        mode: "subagent",
        hidden: false,
        steps: null,
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          { action: "execute", resource: "*", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "subagent", resource: "*", effect: "deny" },
          { action: "external_directory", resource: "*", effect: "ask" },
        ],
      })
      expect(agents.get().get("explore")).not.toHaveProperty("model")
      const projectID = Project.ID.make("prj_00000000000000sessiontools")
      const outcomes = (id: "general" | "explore") => {
        const permissions = agents.get().get(id)?.permissions ?? []
        const effect = (action: string, path: ProjectDirectory.Path) =>
          PermissionEvaluation.evaluate(action, ProjectDirectory.resource(projectID, path), permissions).effect
        return {
          ordinary: effect("read", ProjectDirectory.Path.make("src/config.ts")),
          rootEnv: effect("read", ProjectDirectory.Path.make(".env")),
          nestedEnv: effect("read", ProjectDirectory.Path.make("config/.env")),
          localEnv: effect("read", ProjectDirectory.Path.make(".env.local")),
          exampleEnv: effect("read", ProjectDirectory.Path.make(".env.example")),
          shell: effect("shell", ProjectDirectory.Path.make("src/config.ts")),
        }
      }
      expect(outcomes("general")).toEqual({
        ordinary: "allow",
        rootEnv: "ask",
        nestedEnv: "ask",
        localEnv: "ask",
        exampleEnv: "allow",
        shell: "allow",
      })
      expect(outcomes("explore")).toEqual({
        ordinary: "allow",
        rootEnv: "ask",
        nestedEnv: "ask",
        localEnv: "ask",
        exampleEnv: "allow",
        shell: "deny",
      })
      expect(Array.from(skills.get().keys())).toEqual(["bymorning", "scheduled-task"])
      expect(skills.get().get("bymorning")).toMatchObject({
        name: "Bymorning",
        description:
          "Use when the user asks to create or update an Integration, Plugin, custom Agent, Skill, or Tool. Not for recurring schedules; those are Scheduled Tasks.",
      })
      expect(Array.from(integrations.get().keys())).toEqual([
        "openai",
        "anthropic",
        "google",
        "opencode",
        "fireworks",
        "amazon-bedrock",
        "groq",
        "cerebras",
        "deepinfra",
        "togetherai",
        "mistral",
        "deepseek",
        "baseten",
        "openrouter",
        "xai",
        "exa",
        "firecrawl",
        "parallel",
        "tavily",
      ])
      expect(integrations.get().get("amazon-bedrock")?.methods).toMatchObject([
        { type: "key", label: "Bedrock API key", form: [{ key: "region", required: true }] },
        { id: "bedrock-sigv4", type: "aws-sigv4", region: { key: "region", required: true } },
        {
          id: "bedrock-bearer-env",
          type: "env-group",
          required: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
        },
        {
          id: "bedrock-sigv4-env",
          type: "env-group",
          required: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
          optional: ["AWS_SESSION_TOKEN"],
        },
      ])

      yield* plugins.activate(
        internal.pre
          .filter((plugin) => plugin.id !== "core.provider.anthropic")
          .map((plugin) => ({ ...plugin, revision: "internal" })),
      )
      expect(Array.from(integrations.get().keys())).not.toContain("anthropic")
      expect(Array.from(integrations.get().keys())).toContain("openai")

      yield* plugins.activate(
        internal.pre
          .filter((plugin) => plugin.id !== "core.tool.web-search")
          .map((plugin) => ({ ...plugin, revision: "internal" })),
      )
      expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "websearch")).toBe(false)
      expect(Array.from(integrations.get().keys())).toEqual([
        "openai",
        "anthropic",
        "google",
        "opencode",
        "fireworks",
        "amazon-bedrock",
        "groq",
        "cerebras",
        "deepinfra",
        "togetherai",
        "mistral",
        "deepseek",
        "baseten",
        "openrouter",
        "xai",
        "exa",
        "firecrawl",
        "parallel",
        "tavily",
      ])
      expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "add")).toBe(true)
      yield* plugins.activate(
        internal.pre
          .filter((plugin) => !plugin.id.startsWith("core.provider."))
          .map((plugin) => ({ ...plugin, revision: "internal" })),
      )
      expect(Array.from(integrations.get().keys())).toEqual(["exa", "firecrawl", "parallel", "tavily"])
      expect((yield* tools.snapshot()).definitions.some((tool) => tool.name === "add")).toBe(true)
      yield* plugins.activate(
        internal.pre
          .filter((plugin) => plugin.id !== "bymorning.toolkit")
          .map((plugin) => ({ ...plugin, revision: "internal" })),
      )
      expect(JSON.stringify((yield* tools.snapshot()).codeModeCatalog)).not.toContain("toolkit.mcp.connect")
      yield* Scope.close(root, Exit.void)
    }).pipe(
      Effect.provideService(Config.Service, config),
      Effect.provideService(ToolOutput.Service, toolOutput),
      Effect.provideService(PluginRuntime.Service, runtime),
    ),
  )
})

type AgentEditor = { name: string; steps?: Agent.Info["steps"]; permissions?: Agent.Info["permissions"] }

const mapEditor = (items: Map<string, AgentEditor>) => ({
  // A built-in Agent plugin reads `get` to yield to a saved Workspace record.
  get: (name: string) => items.get(name),
  update: (name: string, update: (item: AgentEditor) => void) => {
    const item = items.get(name) ?? { name }
    items.set(name, item)
    update(item)
  },
})

const skillEditor = (items: Map<string, { id: string; name: string }>) => ({
  add: (item: { id: string; name: string }) => items.set(item.id, item),
})

const integrationInitial = () => new Map<string, { name: string; methods: unknown[] }>()
const integrationEditor = (items: ReturnType<typeof integrationInitial>) => ({
  update: (id: string, update: (item: { name: string }) => void) => {
    const item = items.get(id) ?? { name: id, methods: [] }
    items.set(id, item)
    update(item)
  },
  method: {
    update: (input: { integrationID: string; method: unknown }) =>
      items.get(input.integrationID)?.methods.push(input.method),
  },
})

function pluginHost(
  tools: Tool.Interface,
  agents: ReturnType<typeof State.create<Map<string, AgentEditor>, ReturnType<typeof mapEditor>>>,
  skills: ReturnType<typeof State.create<Map<string, { id: string; name: string }>, ReturnType<typeof skillEditor>>>,
  integrations: ReturnType<
    typeof State.create<ReturnType<typeof integrationInitial>, ReturnType<typeof integrationEditor>>
  >,
  shellHooks: PluginHooks.Interface,
  storage: Storage.Interface,
) {
  const providers = State.create({
    initial: () => new Map<string, { id: string; name: string }>(),
    editor: (items) => ({
      add: (provider: { id: string; name: string }) => items.set(provider.id, provider),
      default: { get: () => "random", set: () => undefined },
    }),
  })
  return {
    workspaceID: Workspace.ID.make("wrk_plugin_internal_test"),
    app: { name: "ByMorning", revision: "test", channel: "test" },
    agent: { transform: agents.transform },
    aisdk: {},
    catalog: {},
    command: {},
    integration: { transform: integrations.transform },
    instruction: {
      list: () => Effect.succeed([]),
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
    },
    mcp: {
      servers: () => Effect.succeed([]),
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
    },
    mcpGatewayTools: tools,
    reference: {},
    runtime: { session: {} },
    shellHooks,
    skill: { transform: skills.transform },
    storage,
    tool: tools,
    websearch: { transform: providers.transform },
  } as unknown as Omit<PluginHost.HostServices, "bus" | "plugin">
}
