import {
  ByMorning,
  type AgentInfo,
  type ByMorningClient,
  type ModelInfo,
  type ModelListOutput,
  type SkillListOutput,
  type WorkspaceEventItem,
} from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Event } from "@bymorning/schema/event"
import { Plugin } from "@bymorning/schema/plugin"
import { Provider } from "@bymorning/schema/provider"
import { Skill } from "@bymorning/schema/skill"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { createEffect, type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DataProvider, useData, type Data } from "./data"
import { SDKProvider } from "./sdk"
import { WorkspaceScope } from "./workspace"
import { useOptionalWorkspaceEvent } from "./workspace-event"
import { WorkspaceEventProvider } from "../test/workspace-event"
import { QueryClientProvider } from "@tanstack/solid-query"
import { createQuery } from "../runtime/server/query"
import { ServerProvider } from "../runtime/server/runtime"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const enabledName = Provider.Name.make("enabled")
const agent: AgentInfo = {
  id: Agent.DefaultID,
  name: Agent.Name.make("Default"),
  instructions: "",
  model: { provider: enabledName, id: "alpha" },
  mode: "primary",
  hidden: false,
  steps: null,
  permissions: [],
}
const skill: SkillListOutput[number] = {
  id: Skill.ID.make("test-skill"),
  name: "test-skill",
  description: "Test skill",
  instructions: "Use the test skill",
}

function model(id: string, providerName: typeof enabledName): ModelInfo {
  return {
    id,
    provider: providerName,
    apiID: id,
    name: id,
    description: "",
    status: "active",
    releaseDate: "2026-01-01",
    lastUpdated: "2026-01-01",
    openWeights: false,
    capabilities: { temperature: true, reasoning: true, attachment: true, tools: true, input: [], output: [] },
    variants: [],
    limit: { context: 1, output: 1 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  }
}

function modelRow(
  info: ModelInfo,
  options: { readonly enabled?: boolean; readonly unavailableReason?: "provider-disabled" } = {},
): ModelListOutput[number] {
  return {
    info,
    enabled: options.enabled ?? true,
    isPreferredDefault: false,
    isEffectiveDefault: false,
    ...(options.unavailableReason ? { unavailableReason: options.unavailableReason } : {}),
  }
}

function deferred<A>() {
  const result = Promise.withResolvers<A>()
  return { promise: result.promise, resolve: result.resolve, reject: result.reject }
}

function clientWith(
  input: {
    readonly agents?: Promise<Array<AgentInfo>>
    readonly models?: Promise<ModelListOutput>
    readonly skills?: Promise<Array<SkillListOutput[number]>>
    readonly events?: (signal: AbortSignal) => AsyncIterable<WorkspaceEventItem>
  } = {},
) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    agent: { ...base.agent, list: vi.fn<ByMorningClient["agent"]["list"]>(() => input.agents ?? Promise.resolve([])) },
    model: { ...base.model, list: vi.fn<ByMorningClient["model"]["list"]>(() => input.models ?? Promise.resolve([])) },
    skill: { ...base.skill, list: vi.fn<ByMorningClient["skill"]["list"]>(() => input.skills ?? Promise.resolve([])) },
    project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
    session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    event: {
      ...base.event,
      subscribe: vi.fn<ByMorningClient["event"]["subscribe"]>((_scope, options) => {
        const signal = options?.signal ?? AbortSignal.abort()
        return (async function* () {
          yield {
            id: Event.ID.make("00000000-0000-4000-8000-000000000000"),
            type: "server.connected" as const,
            data: {},
          }
          if (input.events) yield* input.events(signal)
          if (signal.aborted) return
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      }),
    },
  } satisfies ByMorningClient
}

function mount(
  client: ByMorningClient,
  options: { readonly events?: boolean; readonly sync?: boolean; readonly workspace?: Workspace.ID } = {},
) {
  const current = { ...workspace, id: options.workspace ?? workspace.id }
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  let data!: Data
  function Consumer(): JSX.Element {
    data = useData()
    const events = useOptionalWorkspaceEvent()
    createEffect(() => {
      if (!options.sync || (events && events.status() !== "connected")) return
      void data.workspace.sync().catch(() => undefined)
    })
    return <div />
  }
  const content = () => (
    <DataProvider>
      <Consumer />
    </DataProvider>
  )
  const view = render(() => (
    <SDKProvider>
      <WorkspaceScope list={[current]} current={current}>
        {options.events ? (
          <WorkspaceEventProvider>{content()}</WorkspaceEventProvider>
        ) : (
          <QueryClientProvider client={createQuery()}>
            <ServerProvider
              scope={{ origin: "http://localhost", identity: "test", workspace: current.id, api: client }}
            >
              {content()}
            </ServerProvider>
          </QueryClientProvider>
        )}
      </WorkspaceScope>
    </SDKProvider>
  ))
  return { data: () => data, unmount: view.unmount }
}

describe("DataProvider direct resources", () => {
  it("does not request direct resources when mounted by a Home-style consumer", async () => {
    const client = clientWith()
    const mounted = mount(client)

    expect(mounted.data().workspace.agent.list()).toBeUndefined()
    expect(mounted.data().workspace.model.list()).toBeUndefined()
    expect(mounted.data().workspace.skill.list()).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(client.agent.list).not.toHaveBeenCalled()
    expect(client.model.list).not.toHaveBeenCalled()
    expect(client.skill.list).not.toHaveBeenCalled()
    mounted.unmount()
  })

  it("starts undefined and loads every resource in the selected Workspace", async () => {
    const agents = deferred<Array<AgentInfo>>()
    const models = deferred<ModelListOutput>()
    const skills = deferred<Array<SkillListOutput[number]>>()
    const client = clientWith({
      agents: agents.promise,
      models: models.promise,
      skills: skills.promise,
    })
    const mounted = mount(client, { sync: true })

    expect(mounted.data().workspace.agent.list()).toBeUndefined()
    expect(mounted.data().workspace.model.list()).toBeUndefined()
    expect(mounted.data().workspace.skill.list()).toBeUndefined()
    await waitFor(() => expect(client.agent.list).toHaveBeenCalledOnce())
    for (const list of [client.agent.list, client.model.list, client.skill.list]) {
      expect(vi.mocked(list).mock.calls[0]?.[0]).toEqual({ workspace: workspace.id })
    }
    agents.resolve([agent])
    models.resolve([modelRow(model("alpha", enabledName))])
    skills.resolve([skill])
    await waitFor(() => expect(mounted.data().workspace.skill.list()).toEqual([skill]))
    expect(mounted.data().workspace.agent.list()).toEqual([agent])
    expect(mounted.data().workspace.model.list()).toMatchObject([{ id: "alpha" }])
    mounted.unmount()
  })

  it("tracks Skill request state and retains cached items after a refresh failure", async () => {
    const skills = deferred<Array<SkillListOutput[number]>>()
    const client = clientWith({ skills: skills.promise })
    const mounted = mount(client)

    expect(mounted.data().workspace.skill.state()).toEqual({ state: "idle" })
    expect(mounted.data().workspace.skill.list()).toBeUndefined()

    const initial = mounted.data().workspace.skill.sync()
    expect(mounted.data().workspace.skill.state()).toEqual({ state: "loading" })
    expect(mounted.data().workspace.skill.list()).toBeUndefined()
    skills.resolve([skill])
    await initial

    expect(mounted.data().workspace.skill.state()).toEqual({ state: "ready", refreshedAt: expect.any(Number) })
    expect(mounted.data().workspace.skill.list()).toEqual([skill])

    vi.mocked(client.skill.list).mockRejectedValueOnce(new Error("Skills unavailable"))
    mounted.data().workspace.skill.invalidate()
    const refresh = mounted.data().workspace.skill.sync()
    expect(mounted.data().workspace.skill.state()).toEqual({ state: "loading", refreshedAt: expect.any(Number) })
    expect(mounted.data().workspace.skill.list()).toEqual([skill])
    await expect(refresh).rejects.toThrow("Skills unavailable")

    expect(mounted.data().workspace.skill.state()).toEqual({
      state: "error",
      refreshedAt: expect.any(Number),
      message: "Skills unavailable",
    })
    expect(mounted.data().workspace.skill.list()).toEqual([skill])
    mounted.unmount()
  })

  it("tracks Agent request state and retains cached items after a refresh failure", async () => {
    const agents = deferred<Array<AgentInfo>>()
    const client = clientWith({ agents: agents.promise })
    const mounted = mount(client)

    expect(mounted.data().workspace.agent.state()).toEqual({ state: "loading" })
    expect(mounted.data().workspace.agent.list()).toBeUndefined()

    const initial = mounted.data().workspace.agent.sync()
    expect(mounted.data().workspace.agent.state()).toEqual({ state: "loading" })
    expect(mounted.data().workspace.agent.list()).toBeUndefined()
    agents.resolve([agent])
    await initial

    expect(mounted.data().workspace.agent.state()).toEqual({ state: "ready", refreshedAt: expect.any(Number) })
    expect(mounted.data().workspace.agent.list()).toEqual([agent])

    vi.mocked(client.agent.list).mockRejectedValueOnce(new Error("Agents unavailable"))
    mounted.data().workspace.agent.invalidate()
    const refresh = mounted.data().workspace.agent.sync()
    expect(mounted.data().workspace.agent.state()).toEqual({ state: "loading", refreshedAt: expect.any(Number) })
    expect(mounted.data().workspace.agent.list()).toEqual([agent])
    await expect(refresh).rejects.toThrow("Agents unavailable")

    expect(mounted.data().workspace.agent.state()).toEqual({
      state: "error",
      refreshedAt: expect.any(Number),
      message: "Agents unavailable",
    })
    expect(mounted.data().workspace.agent.list()).toEqual([agent])
    mounted.unmount()
  })

  it("keeps Skill items undefined when the first sync fails", async () => {
    const client = clientWith()
    vi.mocked(client.skill.list).mockRejectedValueOnce(new Error("No skills"))
    const mounted = mount(client)

    await expect(mounted.data().workspace.skill.sync()).rejects.toThrow("No skills")

    expect(mounted.data().workspace.skill.state()).toEqual({ state: "error", message: "No skills" })
    expect(mounted.data().workspace.skill.list()).toBeUndefined()
    mounted.unmount()
  })

  it("keeps Agent items undefined when the first sync fails", async () => {
    const client = clientWith()
    vi.mocked(client.agent.list).mockRejectedValueOnce(new Error("No agents"))
    const mounted = mount(client)

    await expect(mounted.data().workspace.agent.sync()).rejects.toThrow("No agents")

    expect(mounted.data().workspace.agent.state()).toEqual({ state: "error", message: "No agents" })
    expect(mounted.data().workspace.agent.list()).toBeUndefined()
    mounted.unmount()
  })

  it("retains provider-disabled and policy-disabled model rows for feature projection", async () => {
    const client = clientWith({
      models: Promise.resolve([
        modelRow(model("enabled-model", enabledName)),
        modelRow(model("policy-disabled", enabledName), { enabled: false }),
        modelRow(model("disabled-provider", enabledName), { unavailableReason: "provider-disabled" }),
      ]),
    })
    const mounted = mount(client, { sync: true })
    await waitFor(() => expect(mounted.data().workspace.model.list()).toBeDefined())
    expect(mounted.data().workspace.model.list()).toMatchObject([{ id: "enabled-model" }])
    expect(mounted.data().workspace.model.rows()).toHaveLength(3)
    mounted.unmount()
  })

  it("isolates shared resources by Workspace lifetime", async () => {
    const second = Workspace.ID.create()
    const secondAgent = { ...agent, instructions: "second" }
    const client = clientWith()
    vi.mocked(client.agent.list).mockImplementation((input) =>
      Promise.resolve(input?.workspace === second ? [secondAgent] : [agent]),
    )
    const mounted = mount(client)
    const other = mount(client, { workspace: second })

    await mounted.data().workspace.agent.sync()
    await other.data().workspace.agent.sync()

    expect(mounted.data().workspace.agent.list()).toEqual([agent])
    expect(other.data().workspace.agent.list()).toEqual([secondAgent])
    mounted.unmount()
    other.unmount()
  })

  it.each(["agent.created", "agent.updated", "agent.deleted"] as const)(
    "refreshes Agents on %s",
    async (variant) => {
      const releaseAgent = Promise.withResolvers<void>()
      const refreshedAgent = { ...agent, instructions: variant }
      const client = clientWith({
        events: () =>
          (async function* () {
            await releaseAgent.promise
            yield {
              id: Event.ID.make("00000000-0000-4000-8000-000000000001"),
              type: variant,
              created: 1,
              data: { workspaceID: workspace.id, id: agent.id },
            }
          })(),
      })
      vi.mocked(client.agent.list).mockResolvedValueOnce([agent]).mockResolvedValue([refreshedAgent])
      const mounted = mount(client, { events: true, sync: true })

      await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([agent]))
      releaseAgent.resolve()
      await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([refreshedAgent]))
      mounted.unmount()
    },
  )

  it.each(["plugin.added", "plugin.updated"] as const)(
    "refreshes all plugin-derived resources on %s",
    async (variant) => {
      const release = Promise.withResolvers<void>()
      const pluginAgent = { ...agent, instructions: variant }
      const client = clientWith({
        events: () =>
          (async function* () {
            await release.promise
            if (variant === "plugin.added") {
              yield {
                id: Event.ID.make("00000000-0000-4000-8000-000000000002"),
                type: variant,
                created: 1,
                data: { id: Plugin.ID.make("test-plugin") },
              }
              return
            }
            yield {
              id: Event.ID.make("00000000-0000-4000-8000-000000000003"),
              type: variant,
              created: 1,
              data: {},
            }
          })(),
      })
      vi.mocked(client.agent.list).mockResolvedValueOnce([agent]).mockResolvedValue([pluginAgent])
      vi.mocked(client.model.list)
        .mockResolvedValueOnce([])
        .mockResolvedValue([modelRow(model(variant, enabledName))])
      vi.mocked(client.skill.list).mockResolvedValueOnce([]).mockResolvedValue([skill])
      const mounted = mount(client, { events: true, sync: true })

      await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([agent]))
      release.resolve()
      await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([pluginAgent]))
      await waitFor(() => expect(mounted.data().workspace.model.list()).toMatchObject([{ id: variant }]))
      await waitFor(() => expect(mounted.data().workspace.skill.list()).toEqual([skill]))
        mounted.unmount()
    },
  )

  it("leaves Integration events to mounted provider features and ignores them otherwise", async () => {
    const release = Promise.withResolvers<void>()
    const client = clientWith({
      events: () =>
        (async function* () {
          await release.promise
          yield {
            id: Event.ID.make("00000000-0000-4000-8000-000000000004"),
            type: "integration.updated",
            created: 1,
            data: {},
          }
        })(),
    })
    vi.mocked(client.model.list).mockResolvedValue([modelRow(model("stable", enabledName))])
    const mounted = mount(client, { events: true, sync: true })
    await waitFor(() => expect(mounted.data().workspace.model.list()).toMatchObject([{ id: "stable" }]))

    release.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(client.model.list).toHaveBeenCalledOnce()
    expect(mounted.data().workspace.model.list()).toMatchObject([{ id: "stable" }])
    mounted.unmount()
  })

  it("refreshes Agents, Models, and Skills after stream reconnect", async () => {
    const disconnect = Promise.withResolvers<void>()
    const refreshedAgent = { ...agent, instructions: "reconnected" }
    const refreshedModel = model("reconnected", enabledName)
    const refreshedSkill = { ...skill, description: "reconnected" }
    const client = clientWith()
    let opens = 0
    vi.mocked(client.event.subscribe).mockImplementation((_input, options) =>
      (async function* () {
        opens++
        yield {
          id: Event.ID.make("00000000-0000-4000-8000-000000000000"),
          type: "server.connected" as const,
          data: {},
        }
        if (opens === 1) {
          await disconnect.promise
          return
        }
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
      })(),
    )
    vi.mocked(client.agent.list).mockResolvedValueOnce([agent]).mockResolvedValueOnce([refreshedAgent])
    vi.mocked(client.model.list)
      .mockResolvedValueOnce([modelRow(model("alpha", enabledName))])
      .mockResolvedValueOnce([modelRow(refreshedModel)])
    vi.mocked(client.skill.list).mockResolvedValueOnce([skill]).mockResolvedValueOnce([refreshedSkill])
    const mounted = mount(client, { events: true, sync: true })
    await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([agent]))
    disconnect.resolve()
    await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([refreshedAgent]), { timeout: 3_000 })
    await waitFor(() => expect(mounted.data().workspace.model.list()).toMatchObject([{ id: "reconnected" }]))
    await waitFor(() => expect(mounted.data().workspace.skill.list()).toEqual([refreshedSkill]))
    mounted.unmount()
  })

  it("revalidates a request that settles while the stream reconnects", async () => {
    const disconnect = Promise.withResolvers<void>()
    const initial = deferred<Array<AgentInfo>>()
    const refreshed = { ...agent, instructions: "after reconnect" }
    const client = clientWith({ agents: initial.promise })
    let opens = 0
    vi.mocked(client.event.subscribe).mockImplementation((_input, options) =>
      (async function* () {
        opens++
        yield {
          id: Event.ID.make("00000000-0000-4000-8000-000000000000"),
          type: "server.connected" as const,
          data: {},
        }
        if (opens === 1) {
          await disconnect.promise
          return
        }
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
      })(),
    )
    vi.mocked(client.agent.list).mockReturnValueOnce(initial.promise).mockResolvedValue([refreshed])
    const mounted = mount(client, { events: true, sync: true })
    await waitFor(() => expect(client.agent.list).toHaveBeenCalledOnce())

    disconnect.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    initial.resolve([agent])
    await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([agent]))

    await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([refreshed]), { timeout: 3_000 })
    expect(client.agent.list).toHaveBeenCalledTimes(2)
    mounted.unmount()
  })

  it("deduplicates Agent syncs until invalidated", async () => {
    const agents = deferred<Array<AgentInfo>>()
    const client = clientWith({ agents: agents.promise })
    const mounted = mount(client)

    const first = mounted.data().workspace.agent.sync()
    const second = mounted.data().workspace.agent.sync()
    expect(client.agent.list).toHaveBeenCalledOnce()
    agents.resolve([agent])
    await Promise.all([first, second])
    await mounted.data().workspace.agent.sync()

    expect(client.agent.list).toHaveBeenCalledOnce()
    mounted.unmount()
  })

  it("serializes an invalidated sync behind the active request", async () => {
    const stale = deferred<Array<AgentInfo>>()
    const current = { ...agent, instructions: "current" }
    const client = clientWith({ agents: stale.promise })
    vi.mocked(client.agent.list).mockReturnValueOnce(stale.promise).mockResolvedValueOnce([current])
    const mounted = mount(client, { sync: true })
    await waitFor(() => expect(client.agent.list).toHaveBeenCalledOnce())

    mounted.data().workspace.agent.invalidate()
    const refresh = mounted.data().workspace.agent.sync()
    expect(client.agent.list).toHaveBeenCalledOnce()
    stale.resolve([agent])
    await refresh

    expect(client.agent.list).toHaveBeenCalledTimes(2)
    expect(mounted.data().workspace.agent.list()).toEqual([current])
    mounted.unmount()
  })

  it("commits an older successful response when a newer sync rejects", async () => {
    const older = deferred<Array<AgentInfo>>()
    const client = clientWith({ agents: older.promise })
    const mounted = mount(client, { sync: true })
    await waitFor(() => expect(client.agent.list).toHaveBeenCalledOnce())
    vi.mocked(client.agent.list).mockRejectedValueOnce(new Error("Newer sync failed"))

    mounted.data().workspace.agent.invalidate()
    const refresh = mounted.data().workspace.agent.sync()
    expect(mounted.data().workspace.agent.list()).toBeUndefined()
    older.resolve([agent])
    await expect(refresh).rejects.toThrow("Newer sync failed")
    expect(mounted.data().workspace.agent.list()).toEqual([agent])
    mounted.unmount()
  })

  it("aborts resource requests on cleanup and ignores their completion", async () => {
    const agents = deferred<Array<AgentInfo>>()
    const client = clientWith({ agents: agents.promise })
    const mounted = mount(client, { sync: true })
    await waitFor(() => expect(client.agent.list).toHaveBeenCalledOnce())
    const signal = vi.mocked(client.agent.list).mock.calls[0]?.[1]?.signal
    mounted.unmount()
    await waitFor(() => expect(signal?.aborted).toBe(true))
    agents.resolve([agent])
    await agents.promise
    await Promise.resolve()
    expect(mounted.data().workspace.agent.list()).toBeUndefined()
  })

  it("retains successful data when an explicit sync rejects", async () => {
    const client = clientWith({ agents: Promise.resolve([agent]) })
    const mounted = mount(client, { sync: true })
    await waitFor(() => expect(mounted.data().workspace.agent.list()).toEqual([agent]))
    vi.mocked(client.agent.list).mockRejectedValueOnce(new Error("Agents unavailable"))

    mounted.data().workspace.agent.invalidate()
    await expect(mounted.data().workspace.agent.sync()).rejects.toThrow("Agents unavailable")
    expect(mounted.data().workspace.agent.list()).toEqual([agent])
    mounted.unmount()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
