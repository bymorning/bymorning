import { describe, expect, it } from "vitest"
import { Agent } from "@bymorning/schema/agent"
import { SystemActor } from "@bymorning/schema/actor"
import { ConfigSchema } from "@bymorning/schema/config"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Stream } from "effect"
import { Config } from "../src/config.js"
import { registerPolicyTools } from "../src/plugin/internal/tool/toolkit-policy.js"
import { Tool } from "../src/tool.js"

/** Focused Toolkit policy tests act as a trusted internal caller: the system Actor. */
const system = new SystemActor({ type: "system", properties: { workspaceID: Workspace.ID.make("wrk_toolkit_policy_test") } })

const configInfo = ConfigSchema.Info.make({
  default_agent: Agent.ID.make("build"),
  default_model: { provider: Provider.Name.make("bymorning"), id: "gpt-5.6-luna" },
  permissions: [],
  compaction: { auto: true, buffer: 20_000, keep: { tokens: 15_000 } },
  model_policy: { disabled: [], seen: [], initialized: [] },
  gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
})

const permissions = [{ action: "config_get", resource: "*", effect: "allow" as const }]
const openai = Provider.Name.make("openai")
const anthropic = Provider.Name.make("anthropic")
const routingRule = {
  match: { model: { provider: openai, id: "gpt" } },
  to: { provider: anthropic, id: "opus" },
}
const otherRouting = {
  match: { tool: "bash" },
  to: { provider: openai, id: "o3" },
}

const context = (permission?: (request: Tool.PermissionRequest) => void): Tool.Context => ({
  caller: {
    type: "session",
    sessionID: Session.ID.make("00000000-0000-4000-8000-000000000801"),
    messageID: MessageID.make("00000000-0000-4000-8000-000000000802"),
    agent: Agent.ID.make("build"),
    projectID: Project.ID.make("prj_00000000000000000000000821"),
  },
  id: Tool.CallID.make("call"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: (request) => {
    permission?.(request)
    return Effect.void
  },
})

const policyTools = (initial: ConfigSchema.Info = configInfo) => {
  let info = initial
  const config = Config.Service.of({
    provider: { update: () => Effect.die("unused") },
    model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    get: Effect.sync(() => info),
    update: (stored) =>
      Effect.sync(() => {
        info = {
          ...info,
          ...(stored.gateway === undefined ? {} : { gateway: stored.gateway as typeof info.gateway }),
          ...(stored.permissions === undefined ? {} : { permissions: stored.permissions as typeof info.permissions }),
          ...(stored.providers === undefined ? {} : { providers: stored.providers as typeof info.providers }),
          ...(stored.routing === undefined ? {} : { routing: stored.routing as typeof info.routing }),
        }
        return info
      }),
    refresh: Effect.die(new Error("unused")),
    mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
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
  registerPolicyTools(
    {
      list: () => [],
      get: () => undefined,
      namespace: () => undefined,
      update: () => undefined,
      remove: () => undefined,
      add: (tool) => added.push(tool),
    },
    config,
    system,
  )
  const get = added.find((tool) => tool.name === "get" && tool.execute !== undefined)
  const update = added.find((tool) => tool.name === "update" && tool.execute !== undefined)
  if (get?.execute === undefined || update?.execute === undefined) throw new Error("policy tools missing")
  return { get: get.execute, update: update.execute }
}

describe("toolkit.policy", () => {
  it("reads and patches Workspace gateway caps", () =>
    Effect.gen(function* () {
      const { get, update } = policyTools()
      const listed = yield* get({}, context())
      expect(listed).toMatchObject({
        output: {
          gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
          permissions: [],
        },
      })
      const patched = yield* update({ gateway: { rpm: 10 } }, context())
      expect(patched).toMatchObject({
        output: {
          gateway: { limits: { rpm: 10, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
        },
      })
    }).pipe(Effect.runPromise))

  it("omits providers and routing from get when unset", () =>
    Effect.gen(function* () {
      const { get } = policyTools()
      const listed = yield* get({}, context())
      expect(listed.output).toEqual({
        gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
        permissions: [],
      })
    }).pipe(Effect.runPromise))

  it("round-trips Provider allow list and Routing rules", () =>
    Effect.gen(function* () {
      const { get } = policyTools(
        ConfigSchema.Info.make({
          ...configInfo,
          providers: { allow: [openai] },
          routing: [routingRule],
        }),
      )
      const listed = yield* get({}, context())
      expect(listed.output).toEqual({
        gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
        permissions: [],
        providers: { allow: [openai] },
        routing: [routingRule],
      })
    }).pipe(Effect.runPromise))

  it("patches providers only and leaves gateway, permissions, and routing", () =>
    Effect.gen(function* () {
      const { update } = policyTools(
        ConfigSchema.Info.make({
          ...configInfo,
          permissions,
          providers: { allow: [openai] },
          routing: [routingRule],
        }),
      )
      const patched = yield* update({ providers: { allow: [anthropic] } }, context())
      expect(patched.output).toEqual({
        gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
        permissions,
        providers: { allow: [anthropic] },
        routing: [routingRule],
      })
    }).pipe(Effect.runPromise))

  it("patches routing only and leaves providers", () =>
    Effect.gen(function* () {
      const { update } = policyTools(
        ConfigSchema.Info.make({
          ...configInfo,
          providers: { allow: [openai] },
          routing: [routingRule],
        }),
      )
      const patched = yield* update({ routing: [otherRouting] }, context())
      expect(patched.output).toEqual({
        gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
        permissions: [],
        providers: { allow: [openai] },
        routing: [otherRouting],
      })
    }).pipe(Effect.runPromise))

  it("replaces providers with an empty allow list, unrestricted object, or empty routing", () =>
    Effect.gen(function* () {
      const seeded = policyTools(
        ConfigSchema.Info.make({
          ...configInfo,
          providers: { allow: [openai] },
          routing: [routingRule],
        }),
      )
      expect((yield* seeded.update({ providers: { allow: [] } }, context())).output).toMatchObject({
        providers: { allow: [] },
        routing: [routingRule],
      })
      expect((yield* seeded.update({ providers: {} }, context())).output).toEqual({
        gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
        permissions: [],
        providers: {},
        routing: [routingRule],
      })
      expect((yield* seeded.update({ routing: [] }, context())).output).toEqual({
        gateway: { limits: { rpm: 300, tpm: 500_000 }, models: ["bymorning/gpt-5.6-luna"] },
        permissions: [],
        providers: {},
        routing: [],
      })
    }).pipe(Effect.runPromise))

  it("rejects an empty update", () =>
    Effect.gen(function* () {
      const { update } = policyTools()
      const error = yield* update({}, context()).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Tool.Error)
      expect(error).toMatchObject({ message: "Provide gateway, permissions, providers, or routing" })
    }).pipe(Effect.runPromise))

  it("requests providers and routing permission resources when those keys are present", () =>
    Effect.gen(function* () {
      const { get, update } = policyTools(
        ConfigSchema.Info.make({
          ...configInfo,
          providers: { allow: [openai] },
          routing: [routingRule],
        }),
      )
      const getRequests: Tool.PermissionRequest[] = []
      yield* get({}, context((request) => getRequests.push(request)))
      expect(getRequests).toEqual([
        { action: "config_get", resources: ["gateway", "permissions", "providers", "routing"] },
      ])
      const updateRequests: Tool.PermissionRequest[] = []
      yield* update({ providers: { allow: [] }, routing: [] }, context((request) => updateRequests.push(request)))
      expect(updateRequests).toEqual([{ action: "config_update", resources: ["providers", "routing"] }])
    }).pipe(Effect.runPromise))
})
