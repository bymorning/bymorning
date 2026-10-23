import {
  ByMorning,
  type AgentInfo,
  type ByMorningClient,
  type ModelInfo,
  type ModelListOutput,
  type ProviderDirectoryEntry,
  type SessionInfo,
} from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Event } from "@bymorning/schema/event"
import { Integration } from "@bymorning/schema/integration"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { MemoryRouter, Route, useLocation, useNavigate } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { createSignal, onMount, Show, type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DataProvider } from "../context/data"
import { DialogProvider } from "../context/dialog"
import { PromptProvider, usePrompt } from "../context/prompt"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { WorkspaceEventProvider } from "../context/workspace-event"
import { useWorkspaceRuntime, WorkspaceRuntimeProvider } from "../context/workspace-runtime"
import { createNewSessionDraftController, type NewSessionDraftController } from "./controller"
import { ServerProvider, useServer } from "../runtime/server/runtime"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const projectID = Project.ID.create()
const secondProjectID = Project.ID.create()
const enabledName = Provider.Name.make("enabled")

const buildAgent: AgentInfo = {
  id: Agent.DefaultID,
  name: Agent.Name.make("Default"),
  instructions: "",
  model: { provider: enabledName, id: "alpha" },
  mode: "primary",
  hidden: false,
  steps: null,
  permissions: [],
}
const planAgent: AgentInfo = {
  id: Agent.ID.make("plan"),
  name: Agent.Name.make("Plan"),
  instructions: "",
  mode: "primary",
  hidden: false,
  steps: null,
  permissions: [],
}
const createdSession: SessionInfo = {
  id: Session.ID.make("00000000-0000-4000-8000-000000000009"),
  projectID,
  title: "Created session",
  agent: Agent.DefaultID,
  model: { id: "alpha", provider: enabledName },
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

function modelRow(id: string, variants: ReadonlyArray<string>): ModelListOutput[number] {
  return {
    info: modelInfo(id, variants),
    enabled: true,
    isPreferredDefault: false,
    isEffectiveDefault: false,
  }
}

function modelInfo(id: string, variants: ReadonlyArray<string>): ModelInfo {
  return {
    id,
    provider: enabledName,
    apiID: id,
    name: id === "alpha" ? "Alpha" : "Beta",
    description: "",
    status: "active",
    releaseDate: "2026-01-01",
    lastUpdated: "2026-01-01",
    openWeights: false,
    capabilities: { temperature: true, reasoning: true, attachment: true, tools: true, input: [], output: [] },
    variants: [...variants],
    limit: { context: 1, output: 1 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  }
}

const providerEntry: ProviderDirectoryEntry = {
  info: {
    name: enabledName,
    displayName: "Enabled",
    api: Provider.API.make("https://example.com"),
    format: "openai",
    status: "enabled",
  },
  integration: {
    id: Integration.ID.make(enabledName),
    name: "Enabled",
    methods: [],
    connections: [],
  },
  connected: true,
  active: true,
  connectionCount: 1,
  modelCount: 2,
}

function clientWith(
  input: {
    readonly agents?: Promise<AgentInfo[]>
    readonly providers?: Promise<ProviderDirectoryEntry[]>
    readonly models?: Promise<ModelListOutput>
    readonly createSession?: () => Promise<SessionInfo>
  } = {},
) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    agent: { ...base.agent, list: vi.fn(() => input.agents ?? Promise.resolve([buildAgent, planAgent])) },
    provider: { ...base.provider, list: vi.fn(() => input.providers ?? Promise.resolve([providerEntry])) },
    model: {
      ...base.model,
      list: vi.fn(() => input.models ?? Promise.resolve([modelRow("alpha", ["thinking"]), modelRow("beta", [])])),
    },
    skill: { ...base.skill, list: vi.fn().mockResolvedValue([]) },
    project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
    session: {
      ...base.session,
      list: vi.fn().mockResolvedValue({ data: [] }),
      active: vi.fn().mockResolvedValue({}),
      create: input.createSession ?? vi.fn().mockResolvedValue(createdSession),
      prompt: vi.fn().mockResolvedValue(undefined),
    },
    event: {
      ...base.event,
      subscribe: vi.fn(((_input, options) =>
        (async function* () {
          yield { id: Event.ID.make(crypto.randomUUID()), type: "server.connected" as const, data: {} }
          const signal = options?.signal ?? AbortSignal.abort()
          if (signal.aborted) return
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()) as typeof base.event.subscribe),
    },
  } satisfies ByMorningClient
}

function mountController(client: ByMorningClient) {
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  let bootstrapRuntime!: ReturnType<typeof useWorkspaceRuntime>
  function Bootstrap(): JSX.Element {
    bootstrapRuntime = useWorkspaceRuntime()
    return <div />
  }
  const bootstrap = render(() => (
    <SDKProvider>
      <WorkspaceRuntimeProvider>
        <Bootstrap />
      </WorkspaceRuntimeProvider>
    </SDKProvider>
  ))
  const draft = bootstrapRuntime.draft.create(workspace.id, projectID)
  bootstrap.unmount()

  let runtime!: ReturnType<typeof useWorkspaceRuntime>
  let prompt!: ReturnType<typeof usePrompt>
  let controller!: NewSessionDraftController
  let location!: ReturnType<typeof useLocation>
  let navigate!: ReturnType<typeof useNavigate>
  const [visible, setVisible] = createSignal(true)
  function Harness(): JSX.Element {
    // The real shell bootstraps ServerSync on connection; the facade's project sync no longer exists.
    onMount(() => {
      const server = useServer()
      server.connection.on("server.connected", () => {
        void server.bootstrap().catch(() => undefined)
      })
    })
    runtime = useWorkspaceRuntime()
    prompt = usePrompt()
    controller = createNewSessionDraftController({ draftID: draft.id })
    location = useLocation()
    navigate = useNavigate()
    return <div />
  }
  const query = new QueryClient()
  const view = render(() => (
    <QueryClientProvider client={query}>
      <ServerProvider scope={{ origin: "http://localhost", identity: "test", workspace: workspace.id, api: client }}>
        <SDKProvider>
          <MemoryRouter>
            <Route
              path="*"
              component={() => (
                <WorkspaceRuntimeProvider>
                  <WorkspaceScope list={[workspace]} current={workspace}>
                    <WorkspaceEventProvider>
                      <DataProvider>
                        <DialogProvider>
                          <PromptProvider scope={{ draftID: draft.id }}>
                            <Show when={visible()}>
                              <Harness />
                            </Show>
                          </PromptProvider>
                        </DialogProvider>
                      </DataProvider>
                    </WorkspaceEventProvider>
                  </WorkspaceScope>
                </WorkspaceRuntimeProvider>
              )}
            />
          </MemoryRouter>
        </SDKProvider>
      </ServerProvider>
    </QueryClientProvider>
  ))
  return {
    get controller() {
      return controller
    },
    prompt,
    pathname: () => location.pathname,
    go: (path: string) => navigate(path),
    runtime,
    draft,
    unmount: view.unmount,
    remount: () => {
      setVisible(false)
      setVisible(true)
    },
  }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  cleanup()
})

describe("createNewSessionDraftController", () => {
  it("waits for the connected status, then syncs each catalog exactly once", async () => {
    const agents = Promise.withResolvers<AgentInfo[]>()
    const client = clientWith({ agents: agents.promise })
    const mounted = mountController(client)

    expect(client.agent.list).not.toHaveBeenCalled()
    expect(mounted.controller.composer.selection.agent.pending()).toBe(true)

    agents.resolve([buildAgent, planAgent])
    await waitFor(() => expect(client.agent.list).toHaveBeenCalledOnce())
    expect(client.provider.list).toHaveBeenCalledOnce()
    expect(client.model.list).toHaveBeenCalledOnce()
    expect(client.skill.list).toHaveBeenCalledOnce()
    await waitFor(() => expect(mounted.controller.composer.selection.agent.pending()).toBe(false))
    expect(mounted.controller.composer.selection.agent.options()).toEqual([
      { key: Agent.DefaultID, label: Agent.Name.make("Default") },
      { key: "plan", label: "Plan" },
    ])
    mounted.unmount()
  })

  it("resolves the fallback agent and the agent's default model once ready", async () => {
    const mounted = mountController(clientWith())

    await waitFor(() => expect(mounted.controller.composer.selection.agent.pending()).toBe(false))
    await waitFor(() => expect(mounted.controller.composer.selection.model.pending()).toBe(false))
    expect(mounted.controller.composer.selection.agent.current()).toBe(Agent.DefaultID)
    expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha")
    expect(mounted.controller.composer.selection.model.options()).toEqual([
      { key: "enabled:alpha", label: "Alpha", group: "Enabled", hidden: true },
      { key: "enabled:beta", label: "Beta", group: "Enabled", hidden: true },
    ])
    expect(mounted.controller.composer.selection.variant.current()).toBe("default")
    expect(mounted.controller.composer.selection.variant.options()).toEqual([
      { key: "default", label: "Default" },
      { key: "thinking", label: "thinking" },
    ])
    mounted.unmount()
  })

  it("falls back to the Workspace's configured default Model when the selected Agent has none pinned", async () => {
    const { model: _unused, ...agentWithoutModel } = buildAgent
    const client = clientWith({
      agents: Promise.resolve([agentWithoutModel as AgentInfo, planAgent]),
      models: Promise.resolve([
        modelRow("alpha", ["thinking"]),
        { ...modelRow("beta", []), isPreferredDefault: true, isEffectiveDefault: true },
      ]),
    })
    const mounted = mountController(client)

    await waitFor(() => expect(mounted.controller.composer.selection.model.pending()).toBe(false))
    expect(mounted.controller.composer.selection.agent.current()).toBe(Agent.DefaultID)
    // "beta" is the Workspace default, not the first catalog entry ("alpha") —
    // proving the choice is deliberate rather than an accident of list order.
    expect(mounted.controller.composer.selection.model.current()).toBe("enabled:beta")
    mounted.unmount()
  })

  it("prefers the selected Agent's pinned Model over the Workspace default", async () => {
    const client = clientWith({
      // buildAgent pins "alpha"; the Workspace default below is "beta".
      models: Promise.resolve([
        modelRow("alpha", ["thinking"]),
        { ...modelRow("beta", []), isPreferredDefault: true, isEffectiveDefault: true },
      ]),
    })
    const mounted = mountController(client)

    await waitFor(() => expect(mounted.controller.composer.selection.model.pending()).toBe(false))
    expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha")
    mounted.unmount()
  })

  it("blocks submission while Provider and Model readiness is unknown", async () => {
    const providers = Promise.withResolvers<ProviderDirectoryEntry[]>()
    const models = Promise.withResolvers<ModelListOutput>()
    const client = clientWith({ providers: providers.promise, models: models.promise })
    const mounted = mountController(client)
    mounted.prompt.set("Keep this draft")

    await waitFor(() => expect(client.provider.list).toHaveBeenCalledOnce())
    expect(mounted.controller.composer.pending()).toBe(true)
    await mounted.controller.composer.submit()
    expect(client.session.create).not.toHaveBeenCalled()
    expect(mounted.prompt.current()).toBe("Keep this draft")

    providers.resolve([providerEntry])
    models.resolve([modelRow("alpha", ["thinking"])])
    await waitFor(() => expect(mounted.controller.composer.pending()).toBe(false))
    await mounted.controller.composer.submit()
    expect(client.session.create).toHaveBeenCalledOnce()
    mounted.unmount()
  })

  it("lists enabled models from every connected enabled provider", async () => {
    const fireworks: ProviderDirectoryEntry = {
      ...providerEntry,
      info: { ...providerEntry.info, name: Provider.Fireworks, displayName: "Fireworks" },
      integration: {
        methods: [],
        connections: [],
        ...providerEntry.integration,
        id: Integration.ID.make(Provider.Fireworks),
        name: "Fireworks",
      },
    }
    const bedrock: ProviderDirectoryEntry = {
      ...providerEntry,
      info: { ...providerEntry.info, name: Provider.AmazonBedrock, displayName: "Amazon Bedrock" },
      integration: {
        methods: [],
        connections: [],
        ...providerEntry.integration,
        id: Integration.ID.make(Provider.AmazonBedrock),
        name: "Amazon Bedrock",
      },
    }
    const client = clientWith({
      models: Promise.resolve([
        {
          ...modelRow("kimi-k3", []),
          info: { ...modelInfo("kimi-k3", []), provider: Provider.Fireworks, name: "Kimi K3" },
        },
        {
          ...modelRow("claude", []),
          info: { ...modelInfo("claude", []), provider: Provider.AmazonBedrock, name: "Claude" },
        },
      ]),
    })
    client.provider.list = vi.fn().mockResolvedValue([fireworks, bedrock])
    const mounted = mountController(client)
    await waitFor(() => expect(mounted.controller.composer.selection.model.pending()).toBe(false))
    expect(mounted.controller.composer.selection.model.options()).toEqual([
      { key: "fireworks:kimi-k3", label: "Kimi K3", group: "Fireworks", hidden: true },
      { key: "amazon-bedrock:claude", label: "Claude", group: "Amazon Bedrock", hidden: true },
    ])
    mounted.unmount()
  })

  it("reports agent sync failures through the selection error", async () => {
    const agents = Promise.withResolvers<AgentInfo[]>()
    const client = clientWith({ agents: agents.promise })
    const mounted = mountController(client)
    await waitFor(() => expect(client.agent.list).toHaveBeenCalledOnce())

    agents.reject(new Error("Agent list offline"))

    await waitFor(() => expect(mounted.controller.composer.selection.error()).toBe("Agent list offline"))
    expect(mounted.controller.composer.selection.agent.pending()).toBe(false)
    expect(mounted.controller.composer.selection.agent.options()).toEqual([])
    mounted.unmount()
  })

  it("reports model sync failures through the selection error", async () => {
    const models = Promise.withResolvers<ModelListOutput>()
    const client = clientWith({ models: models.promise })
    const mounted = mountController(client)
    await waitFor(() => expect(client.model.list).toHaveBeenCalledOnce())

    models.reject(new Error("Models offline"))

    await waitFor(() => expect(mounted.controller.composer.selection.error()).toBe("Models offline"))
    expect(mounted.controller.composer.selection.model.pending()).toBe(false)
    mounted.unmount()
  })

  it("applies agent, model, and variant selection changes to the prompt", async () => {
    const mounted = mountController(clientWith())
    await waitFor(() => expect(mounted.controller.composer.selection.agent.current()).toBe(Agent.DefaultID))
    await waitFor(() => expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha"))
    const selection = mounted.controller.composer.selection

    selection.agent.select("plan")
    expect(mounted.prompt.agent.current()).toBe("plan")
    expect(selection.agent.current()).toBe("plan")
    expect(selection.model.current()).toBe("enabled:alpha")

    selection.model.select("enabled:beta")
    expect(selection.model.current()).toBe("enabled:beta")
    expect(selection.variant.current()).toBe("default")

    selection.model.select("enabled:alpha")
    selection.variant.select("thinking")
    expect(selection.variant.current()).toBe("thinking")

    selection.variant.select("default")
    expect(selection.variant.current()).toBe("default")
    mounted.unmount()
  })

  it("updates the draft project and confirms the server project source", async () => {
    const mounted = mountController(clientWith())
    expect(mounted.controller.project.current()).toEqual(mounted.draft)
    expect(mounted.controller.project.confirmed()).toBe(false)

    mounted.controller.project.select(secondProjectID)

    expect(mounted.controller.project.current()?.projectID).toBe(secondProjectID)
    expect(mounted.runtime.draft.get(mounted.draft.id)?.projectID).toBe(secondProjectID)
    await waitFor(() => expect(mounted.controller.project.confirmed()).toBe(true))
    mounted.unmount()
  })

  it("creates the session, queues the prompt on it, and navigates to its route", async () => {
    const client = clientWith()
    const mounted = mountController(client)
    await waitFor(() => expect(mounted.controller.composer.selection.agent.current()).toBe(Agent.DefaultID))
    await waitFor(() => expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha"))

    mounted.prompt.set("Build the thing", 16)
    await mounted.controller.composer.submit()

    expect(client.session.create).toHaveBeenCalledWith(
      {
        projectID,
        agent: Agent.DefaultID,
        model: { provider: enabledName, id: "alpha" },
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(client.session.prompt).toHaveBeenCalledWith(
      {
        sessionID: createdSession.id,
        id: expect.any(String),
        text: "Build the thing",
        agents: [],
        delivery: "steer",
      },
      { signal: expect.any(AbortSignal) },
    )
    await waitFor(() => expect(mounted.pathname()).toBe(`/w/${workspace.id}/session/${createdSession.id}`))
    expect(mounted.runtime.draft.get(mounted.draft.id)).toBeUndefined()
    const sessionPrompt = mounted.runtime.prompt({
      workspaceID: workspace.id,
      projectID,
      sessionID: createdSession.id,
    })
    expect(sessionPrompt.selection.current()).toEqual({
      agent: Agent.DefaultID,
      model: { provider: enabledName, id: "alpha" },
    })
    mounted.unmount()
  })

  it("surfaces session creation failures on the composer without navigation", async () => {
    const client = clientWith({ createSession: vi.fn().mockRejectedValue(new Error("Gateway unavailable")) })
    const mounted = mountController(client)
    await waitFor(() => expect(mounted.controller.composer.selection.agent.current()).toBe(Agent.DefaultID))
    await waitFor(() => expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha"))

    mounted.prompt.set("Build the thing", 16)
    await mounted.controller.composer.submit()

    expect(mounted.controller.composer.error()).toBe("Gateway unavailable")
    expect(mounted.controller.composer.pending()).toBe(false)
    expect(mounted.pathname()).toBe("/")
    expect(mounted.runtime.draft.get(mounted.draft.id)).toEqual(mounted.draft)
    expect(client.session.prompt).not.toHaveBeenCalled()
    mounted.unmount()
  })

  it("preserves newer draft edits and suppresses duplicate creation across a controller remount", async () => {
    const created = Promise.withResolvers<SessionInfo>()
    const client = clientWith({ createSession: vi.fn(() => created.promise) })
    const mounted = mountController(client)
    await waitFor(() => expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha"))
    mounted.prompt.set("Original")
    const pending = mounted.controller.composer.submit()
    await waitFor(() => expect(client.session.create).toHaveBeenCalledOnce())
    mounted.remount()
    expect(mounted.controller.composer.pending()).toBe(true)
    mounted.prompt.set("New draft", 3)
    await mounted.controller.composer.submit()
    expect(client.session.create).toHaveBeenCalledOnce()
    created.resolve(createdSession)
    await pending
    expect(client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Original", delivery: "steer" }),
      expect.anything(),
    )
    expect(mounted.prompt.current()).toBe("New draft")
    expect(mounted.prompt.cursor()).toBe(3)
    expect(mounted.runtime.draft.get(mounted.draft.id)).toEqual(mounted.draft)
    expect(mounted.pathname()).toBe("/")
    mounted.unmount()
  })

  it("does not navigate away from a newer route when delayed creation completes", async () => {
    const created = Promise.withResolvers<SessionInfo>()
    const client = clientWith({ createSession: vi.fn(() => created.promise) })
    const mounted = mountController(client)
    await waitFor(() => expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha"))
    mounted.prompt.set("Original")
    const pending = mounted.controller.composer.submit()
    await waitFor(() => expect(client.session.create).toHaveBeenCalledOnce())
    mounted.go("/another-draft")
    created.resolve(createdSession)
    await pending
    expect(mounted.pathname()).toBe("/another-draft")
    expect(client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: createdSession.id, text: "Original" }),
      expect.anything(),
    )
    mounted.unmount()
  })

  it("navigates after creation and restores an unconfirmed prompt on the created session", async () => {
    const client = clientWith()
    client.session.prompt.mockRejectedValue(new Error("admission offline"))
    const mounted = mountController(client)
    await waitFor(() => expect(mounted.controller.composer.selection.model.current()).toBe("enabled:alpha"))
    mounted.prompt.set("Original")
    await mounted.controller.composer.submit()
    expect(mounted.pathname()).toBe(`/w/${workspace.id}/session/${createdSession.id}`)
    const prompt = mounted.runtime.prompt({ workspaceID: workspace.id, projectID, sessionID: createdSession.id })
    expect(prompt.current()).toBe("Original")
    expect(mounted.runtime.draft.get(mounted.draft.id)).toBeUndefined()
    mounted.unmount()
  })
})
