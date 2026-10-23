import {
  ByMorning,
  type BudgetStatusOutput,
  type ByMorningClient,
  type McpServersListOutput,
  type McpToolsListOutput,
  type ProjectFileNotFoundError as ClientProjectFileNotFoundError,
  type ServiceAccountListOutput,
  type UsageOverviewOutput,
  type UserListOutput,
  type WorkspaceEventItem,
} from "@bymorning/client"
import { Event } from "@bymorning/schema/event"
import { Project } from "@bymorning/schema/project"
import * as ServiceAccount from "@bymorning/schema/service-account"
import { User } from "@bymorning/schema/user"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { render, waitFor } from "@solidjs/testing-library"
import { createRoot, type JSX } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClientProvider } from "@tanstack/solid-query"
import type { SyncStorage } from "../runtime/persistence/storage"
import { useData, type Data } from "./data"
import { DataProvider } from "../test/data"
import { SDKProvider } from "./sdk"
import { WorkspaceScope } from "./workspace"
import { WorkspaceEventProvider } from "../test/workspace-event"
import { createQuery } from "../runtime/server/query"
import { ServerProvider } from "../runtime/server/runtime"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const firstProject = Project.Info.make({
  id: Project.ID.create(),
  name: "First",
  icon: { color: "red" },
  time_created: 1,
  time_updated: 1,
})
const values = new Map<string, string>()
const storage: SyncStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}
function mountData(
  client: ByMorningClient,
  current = workspace,
  _observe?: undefined,
  options: { readonly events?: boolean } = {},
) {
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  let data!: Data
  function Consumer(): JSX.Element {
    data = useData()
    return <div />
  }
  function Content(): JSX.Element {
    return (
      <DataProvider>
        <Consumer />
      </DataProvider>
    )
  }
  const view = render(() => (
    <SDKProvider>
      <WorkspaceScope list={[current]} current={current}>
        {options.events ? (
          <WorkspaceEventProvider>
            <Content />
          </WorkspaceEventProvider>
        ) : (
          <QueryClientProvider client={createQuery()}>
            <ServerProvider
              scope={{ origin: "http://localhost", identity: "test", workspace: current.id, api: client }}
            >
              <Content />
            </ServerProvider>
          </QueryClientProvider>
        )}
      </WorkspaceScope>
    </SDKProvider>
  ))
  return { data: () => data, unmount: view.unmount }
}
function clientWithEvents(
  client: ByMorningClient,
  events: (signal: AbortSignal) => AsyncIterable<WorkspaceEventItem>,
): ByMorningClient {
  return {
    ...client,
    event: {
      ...client.event,
      subscribe: (_scope, options) => {
        const signal = options?.signal ?? AbortSignal.abort()
        return (async function* () {
          yield { id: Event.ID.make(crypto.randomUUID()), type: "server.connected" as const, data: {} }
          yield* events(signal)
          if (signal.aborted) return
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })()
      },
    },
  }
}
beforeEach(() => vi.stubGlobal("localStorage", storage))
afterEach(() => {
  values.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("DataProvider Project Directory", () => {
  it("lists and reads Project Directory bytes with caller identity and cancellation", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const list = vi.fn().mockResolvedValue({ paths: ["README.md"] })
    const bytes = Uint8Array.from([0, 0xff, 1])
    const read = vi.fn().mockResolvedValue(bytes)
    const mounted = mountData({
      ...base,
      project: {
        ...base.project,
        list: vi.fn().mockResolvedValue([]),
        directory: { ...base.project.directory, list, read },
      },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const signal = new AbortController().signal
    expect(await mounted.data().projectDirectory.list(firstProject.id, signal)).toEqual(["README.md"])
    expect(await mounted.data().projectDirectory.read(firstProject.id, "assets/image.bin", signal)).toBe(bytes)
    expect(list).toHaveBeenCalledWith(
      { projectID: firstProject.id, workspace: workspace.id },
      { signal: expect.any(AbortSignal) },
    )
    expect(read).toHaveBeenCalledWith(
      { projectID: firstProject.id, path: "assets/image.bin", workspace: workspace.id },
      { signal: expect.any(AbortSignal) },
    )
    mounted.unmount()
  })
  it("preserves original generated Project File errors for presentation mapping", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const generated = {
      _tag: "ProjectFile.NotFoundError",
      path: "README.md",
      message: "Project file not found: README.md",
    } satisfies ClientProjectFileNotFoundError
    const other = new Error("offline")
    const read = vi.fn().mockRejectedValueOnce(generated).mockRejectedValueOnce(other)
    const mounted = mountData({
      ...base,
      project: { ...base.project, list: vi.fn().mockResolvedValue([]), directory: { ...base.project.directory, read } },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const signal = new AbortController().signal
    await expect(mounted.data().projectDirectory.read(firstProject.id, "README.md", signal)).rejects.toEqual(generated)
    await expect(mounted.data().projectDirectory.read(firstProject.id, "README.md", signal)).rejects.toBe(other)
    mounted.unmount()
  })
  it("writes browser files through the generated Project Directory binary call", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const write = vi.fn().mockResolvedValue(undefined)
    const mounted = mountData({
      ...base,
      project: {
        ...base.project,
        list: vi.fn().mockResolvedValue([]),
        directory: { ...base.project.directory, write },
      },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const file = Object.assign(new File([new Uint8Array([1, 2, 3])], "asset.bin", { type: "application/custom" }), {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })
    await mounted.data().projectDirectory.write(firstProject.id, file.name, file.type, file)
    expect(write).toHaveBeenCalledWith({
      projectID: firstProject.id,
      path: "asset.bin",
      contentType: "application/custom",
      payload: new Uint8Array([1, 2, 3]),
      workspace: workspace.id,
    })
    expect(mounted.data().projectDirectory.list(firstProject.id)).toEqual([])
    mounted.unmount()
  })

  it("synchronizes and searches Query paths locally while retaining failed refresh data", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const list = vi.fn().mockResolvedValue({
      paths: ["src/main.ts", "src/model.ts", "test/main.test.ts", "README.md"],
    })
    const mounted = mountData({
      ...base,
      project: { ...base.project, list: vi.fn().mockResolvedValue([]), directory: { ...base.project.directory, list } },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const abort = new AbortController()
    expect(mounted.data().projectDirectory.state(firstProject.id)).toEqual({ state: "idle" })
    expect(mounted.data().projectDirectory.list(firstProject.id)).toEqual([])
    const refresh = mounted.data().projectDirectory.sync(firstProject.id, abort.signal)
    expect(mounted.data().projectDirectory.list(firstProject.id)).toEqual([])
    await refresh
    expect(mounted.data().projectDirectory.state(firstProject.id)).toEqual({
      state: "ready",
      refreshedAt: expect.any(Number),
    })
    expect(mounted.data().projectDirectory.list(firstProject.id)).toEqual([
      "src/main.ts",
      "src/model.ts",
      "test/main.test.ts",
      "README.md",
    ])
    expect(list).toHaveBeenCalledWith(
      { projectID: firstProject.id, workspace: workspace.id },
      { signal: expect.any(AbortSignal) },
    )
    list.mockClear()
    expect(await mounted.data().projectDirectory.search(firstProject.id, "model", abort.signal)).toEqual([
      "src/model.ts",
    ])
    expect(await mounted.data().projectDirectory.search(firstProject.id, "README", abort.signal)).toEqual(["README.md"])
    expect(list).not.toHaveBeenCalled()

    list.mockRejectedValue(new Error("Files unavailable"))
    await mounted.data().projectDirectory.sync(firstProject.id, abort.signal)
    expect(mounted.data().projectDirectory.state(firstProject.id)).toMatchObject({
      state: "error",
      message: "Files unavailable",
    })
    expect(mounted.data().projectDirectory.list(firstProject.id)).toContain("src/model.ts")
    mounted.unmount()
  })
  it("deduplicates concurrent Project Directory synchronization", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const staleResponse = Promise.withResolvers<{ paths: string[] }>()
    const currentResponse = Promise.withResolvers<{ paths: string[] }>()
    const list = vi
      .fn()
      .mockImplementationOnce(() => staleResponse.promise)
      .mockImplementationOnce(() => currentResponse.promise)
    const mounted = mountData({
      ...base,
      project: { ...base.project, list: vi.fn().mockResolvedValue([]), directory: { ...base.project.directory, list } },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const stale = mounted.data().projectDirectory.sync(firstProject.id, new AbortController().signal)
    const current = mounted.data().projectDirectory.sync(firstProject.id, new AbortController().signal)
    staleResponse.resolve({ paths: ["current.ts"] })
    await Promise.all([stale, current])

    expect(mounted.data().projectDirectory.list(firstProject.id)).toEqual(["current.ts"])
    expect(list).toHaveBeenCalledOnce()
    mounted.unmount()
  })
  it("refreshes the cached listing and only the changed file on project.file.changed", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const list = vi
      .fn()
      .mockResolvedValueOnce({ paths: ["README.md", "notes.txt"] })
      .mockResolvedValue({ paths: ["README.md", "notes.txt", "report.md"] })
    const read = vi.fn(async (input: { readonly path: string }) =>
      new TextEncoder().encode(input.path === "notes.txt" && read.mock.calls.length > 2 ? "revised" : "original"),
    )
    let send: ((event: WorkspaceEventItem) => void) | undefined
    const mounted = mountData(
      clientWithEvents(
        {
          ...base,
          agent: { ...base.agent, list: vi.fn().mockResolvedValue([]) },
          provider: { ...base.provider, list: vi.fn().mockResolvedValue([]) },
          model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
          skill: { ...base.skill, list: vi.fn().mockResolvedValue([]) },
          project: {
            ...base.project,
            list: vi.fn().mockResolvedValue([]),
            directory: { ...base.project.directory, list, read },
          },
          session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
        },
        () => {
          const events: WorkspaceEventItem[] = []
          let notify: (() => void) | undefined
          send = (event) => {
            events.push(event)
            notify?.()
          }
          return (async function* () {
            for (;;) {
              const event = events.shift()
              if (event) {
                yield event
                continue
              }
              await new Promise<void>((resolve) => (notify = resolve))
            }
          })()
        },
      ),
      workspace,
      undefined,
      { events: true },
    )
    const directory = mounted.data().projectDirectory
    const signal = new AbortController().signal
    await directory.sync(firstProject.id, signal)
    expect(await directory.read(firstProject.id, "notes.txt", signal)).toEqual(new TextEncoder().encode("original"))
    expect(await directory.read(firstProject.id, "README.md", signal)).toEqual(new TextEncoder().encode("original"))
    expect(list).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(send).toBeDefined())

    send!({
      id: Event.ID.make("00000000-0000-4000-8000-000000000041"),
      type: "project.file.changed",
      created: 1,
      data: { projectID: firstProject.id, path: "notes.txt" },
    } as WorkspaceEventItem)
    await waitFor(() => expect(directory.list(firstProject.id)).toEqual(["README.md", "notes.txt", "report.md"]))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
    expect(read).toHaveBeenLastCalledWith(
      { projectID: firstProject.id, path: "notes.txt", workspace: workspace.id },
      { signal: expect.any(AbortSignal) },
    )
    expect(await directory.read(firstProject.id, "notes.txt", signal)).toEqual(new TextEncoder().encode("revised"))
    expect(await directory.read(firstProject.id, "README.md", signal)).toEqual(new TextEncoder().encode("original"))
    expect(list).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(3)

    // Another Project's change leaves this Project's cache untouched.
    send!({
      id: Event.ID.make("00000000-0000-4000-8000-000000000042"),
      type: "project.file.changed",
      created: 2,
      data: { projectID: Project.ID.create(), path: "notes.txt" },
    } as WorkspaceEventItem)
    send!({
      id: Event.ID.make("00000000-0000-4000-8000-000000000043"),
      type: "agent.created",
      created: 3,
      data: {},
    } as WorkspaceEventItem)
    await waitFor(() => expect(mounted.data().workspace.agent.state().state).not.toBe("idle"))
    expect(list).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(3)
    mounted.unmount()
  })
  it("abandons an aborted local search without cancelling the shared paths request", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const response = Promise.withResolvers<{ paths: string[] }>()
    const mounted = mountData({
      ...base,
      project: {
        ...base.project,
        list: vi.fn().mockResolvedValue([]),
        directory: { ...base.project.directory, list: vi.fn(() => response.promise) },
      },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const abort = new AbortController()
    const search = mounted.data().projectDirectory.search(firstProject.id, "stale", abort.signal)
    abort.abort()
    response.resolve({ paths: ["stale.ts"] })
    expect(await search).toEqual([])
    expect(mounted.data().projectDirectory.list(firstProject.id)).toEqual(["stale.ts"])
    mounted.unmount()
  })
})

const budgetStatus: BudgetStatusOutput = {
  period: { start: new Date(0), end: new Date(1) },
  standings: [
    {
      target: { type: "workspace" },
      holder: "workspace" as BudgetStatusOutput["standings"][number]["holder"],
      period: { start: new Date(0), end: new Date(1) },
      spent: 5,
      limit: 10,
    },
    {
      target: { type: "service_account", serviceAccountID: ServiceAccount.ID.create() },
      holder: "service-account" as BudgetStatusOutput["standings"][number]["holder"],
      period: { start: new Date(0), end: new Date(1) },
      spent: 2,
      limit: 8,
    },
  ],
}
const accounts: ServiceAccountListOutput = [
  {
    id: ServiceAccount.ID.create(),
    workspaceID: workspace.id,
    name: "Deploy bot",
    status: "active",
    policy: {},
    timeCreated: new Date(0),
    timeUpdated: new Date(0),
    keyCount: 1,
  },
]
const members: UserListOutput = {
  role: "admin",
  members: [
    {
      id: User.ID.make("usr_member"),
      email: "member@test.dev" as UserListOutput["members"][number]["email"],
      role: "member",
      status: "active",
    },
  ],
}
const servers: McpServersListOutput = [{ name: "one", enabled: true, status: "connected" }]
const mcpTools: McpToolsListOutput = [
  { server: "one", name: "search", action: "one_search", description: "Search remotely" },
]
const usageAggregate = {
  invocations: 1,
  cost: 1,
  costComplete: true,
  tokens: { total: 2, input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
}
const usageOverview = (days: 7 | 30 | 90): UsageOverviewOutput => ({
  days: days as UsageOverviewOutput["days"],
  from: new Date(0),
  to: new Date(1),
  total: usageAggregate,
  daily: [],
  users: [],
  models: [],
})
function queryRoot<T>(create: () => T) {
  return createRoot((dispose) => ({ value: create(), dispose }))
}

describe("workspace lists and gateway queries", () => {
  it("syncs each workspace list from its endpoint and retains the value across a failed refresh", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const accountList = vi.fn().mockResolvedValue(accounts)
    const budgetStatusRead = vi.fn().mockResolvedValue(budgetStatus)
    const serverList = vi.fn().mockResolvedValue(servers)
    const mcpToolList = vi.fn().mockResolvedValue(mcpTools)
    const memberList = vi.fn().mockResolvedValue(members)
    const mounted = mountData({
      ...base,
      serviceAccount: { ...base.serviceAccount, list: accountList },
      budget: { ...base.budget, status: budgetStatusRead },
      mcp: {
        ...base.mcp,
        servers: { ...base.mcp.servers, list: serverList },
        tools: { ...base.mcp.tools, list: mcpToolList },
      },
      user: { ...base.user, list: memberList },
      project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const data = mounted.data().workspace
    expect(data.serviceAccount.state()).toEqual({ state: "idle" })
    expect(data.budget.list()).toBeUndefined()
    await Promise.all([
      data.serviceAccount.sync(),
      data.budget.sync(),
      data.mcpServer.sync(),
      data.mcpTool.sync(),
      data.member.sync(),
    ])
    for (const list of [accountList, budgetStatusRead, serverList, mcpToolList, memberList])
      expect(list).toHaveBeenCalledWith({ workspace: workspace.id }, expect.anything())
    expect(data.serviceAccount.state()).toEqual({ state: "ready", refreshedAt: expect.any(Number) })
    expect(data.serviceAccount.list()).toEqual(accounts)
    expect(data.budget.list()).toEqual(budgetStatus)
    expect(data.mcpServer.list()).toEqual(servers)
    expect(data.mcpTool.list()).toEqual(mcpTools)
    expect(data.member.list()).toEqual(members)
    accountList.mockRejectedValue(new Error("Accounts unavailable"))
    data.serviceAccount.invalidate()
    await expect(data.serviceAccount.sync()).rejects.toThrow("Accounts unavailable")
    expect(data.serviceAccount.state()).toMatchObject({ state: "error", message: "Accounts unavailable" })
    expect(data.serviceAccount.list()).toEqual(accounts)
    mounted.unmount()
  })
  it("loads the usage overview by range through the gateway query and keeps entries per range", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const pendingSeven = Promise.withResolvers<UsageOverviewOutput>()
    const overview = vi
      .fn<ByMorningClient["usage"]["overview"]>()
      .mockResolvedValueOnce(usageOverview(30))
      .mockReturnValueOnce(pendingSeven.promise)
      .mockResolvedValue(usageOverview(7))
    const mounted = mountData({
      ...base,
      usage: { ...base.usage, overview },
      project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
      session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
    })
    const days = queryRoot(
      () =>
        [
          mounted.data().gateway.usage(() => ({ days: 30 })),
          mounted.data().gateway.usage(() => ({ days: 7 })),
        ] as const,
    )
    const [thirty, seven] = days.value
    expect(thirty.state()).toEqual({ state: "loading" })
    await waitFor(() =>
      expect(thirty.state()).toEqual({ state: "ready", refreshedAt: expect.any(Number), data: usageOverview(30) }),
    )
    expect(overview).toHaveBeenCalledWith({ workspace: workspace.id, days: 30 }, expect.anything())
    expect(seven.state()).toEqual({ state: "loading" })
    pendingSeven.resolve(usageOverview(7))
    await waitFor(() => expect(seven.state()).toMatchObject({ state: "ready", data: usageOverview(7) }))
    thirty.refetch()
    expect(thirty.state()).toEqual({ state: "loading", refreshedAt: expect.any(Number), data: usageOverview(30) })
    await waitFor(() => expect(thirty.state()).toMatchObject({ state: "ready", data: { days: 7 } }))
    expect(overview).toHaveBeenCalledTimes(3)
    days.dispose()
    mounted.unmount()
  })
  it("refreshes the catalog on plugin events", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const modelList = vi.fn().mockResolvedValue([])
    const release = Promise.withResolvers<void>()
    const mounted = mountData(
      clientWithEvents(
        {
          ...base,
          agent: { ...base.agent, list: vi.fn().mockResolvedValue([]) },
          provider: { ...base.provider, list: vi.fn().mockResolvedValue([]) },
          model: { ...base.model, list: modelList },
          skill: { ...base.skill, list: vi.fn().mockResolvedValue([]) },
          project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
          session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
        },
        () =>
          (async function* () {
            await release.promise
            yield {
              id: Event.ID.make("00000000-0000-4000-8000-000000000022"),
              type: "plugin.updated",
              created: 1,
              data: {},
            } as WorkspaceEventItem
          })(),
      ),
      workspace,
      undefined,
      { events: true },
    )
    await mounted.data().workspace.model.sync()
    expect(modelList).toHaveBeenCalledTimes(1)
    release.resolve()
    await waitFor(() => expect(modelList).toHaveBeenCalledTimes(2))
    mounted.unmount()
  })
  it("refreshes the scheduled task catalog on task events only once it has been loaded", async () => {
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const taskList = vi.fn().mockResolvedValue([])
    const agentList = vi.fn().mockResolvedValue([])
    let send: ((event: WorkspaceEventItem) => void) | undefined
    const mounted = mountData(
      clientWithEvents(
        {
          ...base,
          agent: { ...base.agent, list: agentList },
          provider: { ...base.provider, list: vi.fn().mockResolvedValue([]) },
          model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
          skill: { ...base.skill, list: vi.fn().mockResolvedValue([]) },
          project: { ...base.project, list: vi.fn().mockResolvedValue([]) },
          session: { ...base.session, list: vi.fn().mockResolvedValue({ data: [] }) },
          scheduledTask: { ...base.scheduledTask, list: taskList },
        },
        () => {
          const events: WorkspaceEventItem[] = []
          let notify: (() => void) | undefined
          send = (event) => {
            events.push(event)
            notify?.()
          }
          return (async function* () {
            for (;;) {
              const event = events.shift()
              if (event) {
                yield event
                continue
              }
              await new Promise<void>((resolve) => (notify = resolve))
            }
          })()
        },
      ),
      workspace,
      undefined,
      { events: true },
    )
    const catalog = mounted.data().workspace.scheduledTask
    expect(catalog.state()).toEqual({ state: "idle" })
    await waitFor(() => expect(send).toBeDefined())
    send!({
      id: Event.ID.make("00000000-0000-4000-8000-000000000031"),
      type: "scheduledTask.deleted",
      created: 1,
      data: { taskID: "tsk_00000000000000000000000000" },
    } as WorkspaceEventItem)
    // The feed delivers in order: once the trailing agent event is handled, the task event was skipped.
    send!({
      id: Event.ID.make("00000000-0000-4000-8000-000000000033"),
      type: "agent.created",
      created: 2,
      data: {},
    } as WorkspaceEventItem)
    await waitFor(() => expect(agentList).toHaveBeenCalled())
    expect(taskList).not.toHaveBeenCalled()
    expect(catalog.state()).toEqual({ state: "idle" })
    await catalog.sync()
    expect(taskList).toHaveBeenCalledTimes(1)
    send!({
      id: Event.ID.make("00000000-0000-4000-8000-000000000032"),
      type: "scheduledTask.updated",
      created: 3,
      data: { task: {} },
    } as WorkspaceEventItem)
    await waitFor(() => expect(taskList).toHaveBeenCalledTimes(2))
    mounted.unmount()
  })
})
