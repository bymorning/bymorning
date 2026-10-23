import { ByMorning, type ByMorningClient, type WorkspaceEventItem } from "@bymorning/client"
import { Event } from "@bymorning/schema/event"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SDKProvider, useSDK } from "./sdk"
import { QueryClientProvider } from "@tanstack/solid-query"
import { createQuery } from "../runtime/server/query"
import { ServerProvider } from "../runtime/server/runtime"
import { WorkspaceScope } from "./workspace"
import { useWorkspaceEvent, WorkspaceEventProvider } from "./workspace-event"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const connected = () => ({
  id: Event.ID.make("00000000-0000-4000-8000-000000000001"),
  type: "server.connected" as const,
  data: {},
})

function provider(workspace: WorkspaceAccess.Info) {
  let events!: ReturnType<typeof useWorkspaceEvent>
  const view = render(() => (
    <SDKProvider>
      <WorkspaceScope list={[workspace]} current={workspace}>
        <QueryClientProvider client={createQuery()}>
          <ServerProvider
            scope={{ origin: useSDK().baseURL, identity: "test", workspace: workspace.id, api: useSDK().client }}
          >
            <WorkspaceEventProvider>{void (events = useWorkspaceEvent())}</WorkspaceEventProvider>
          </ServerProvider>
        </QueryClientProvider>
      </WorkspaceScope>
    </SDKProvider>
  ))
  return { events, view }
}

describe("WorkspaceEventProvider", () => {
  it("opens one Workspace subscription, recognizes server.connected, and multicasts subsequent items", async () => {
    const workspace = WorkspaceAccess.Info.make({
      id: Workspace.ID.create(),
      name: "Test",
      status: "active",
      role: "admin",
    })
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const requests: unknown[] = []
    const release = Promise.withResolvers<void>()
    const item: WorkspaceEventItem = {
      id: Event.ID.make("00000000-0000-4000-8000-000000000002"),
      type: "config.updated",
      created: 1,
      data: {},
    }
    const subscribe: ByMorningClient["event"]["subscribe"] = (input, options) =>
      (async function* () {
        requests.push(input)
        yield connected()
        await release.promise
        yield item
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
      })()
    vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, event: { subscribe } })
    const { events, view } = provider(workspace)

    await vi.waitFor(() => expect(events.status()).toBe("connected"))
    expect(events.current()).toBe(1)
    expect(requests).toEqual([{ workspace: workspace.id }])
    const first = new AbortController()
    const second = new AbortController()
    const readers = [events.subscribe({ signal: first.signal }), events.subscribe({ signal: second.signal })].map(
      (stream) => stream[Symbol.asyncIterator](),
    )
    await expect(Promise.all(readers.map((reader) => reader.next()))).resolves.toEqual([
      { done: false, value: connected() },
      { done: false, value: connected() },
    ])
    const reads = readers.map((reader) => reader.next())
    release.resolve()
    await expect(Promise.all(reads)).resolves.toEqual([
      { done: false, value: item },
      { done: false, value: item },
    ])
    first.abort()
    second.abort()
    view.unmount()
  })

  it("keeps generation and reconnect backoff under the one physical subscription", async () => {
    const workspace = WorkspaceAccess.Info.make({
      id: Workspace.ID.create(),
      name: "Test",
      status: "active",
      role: "admin",
    })
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    let opens = 0
    const subscribe: ByMorningClient["event"]["subscribe"] = (_input, options) =>
      (async function* () {
        opens += 1
        yield connected()
        if (opens === 1) return
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        )
      })()
    vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, event: { subscribe } })
    const { events, view } = provider(workspace)

    await vi.waitFor(() => expect(events.current()).toBe(2), { timeout: 3_000 })
    expect(events.status()).toBe("connected")
    expect(opens).toBe(2)
    view.unmount()
  })

  it("aborts the physical subscription when its provider is disposed", async () => {
    const workspace = WorkspaceAccess.Info.make({
      id: Workspace.ID.create(),
      name: "Test",
      status: "active",
      role: "admin",
    })
    const base = ByMorning.make({ baseUrl: "http://localhost" })
    const aborted = vi.fn()
    const subscribe: ByMorningClient["event"]["subscribe"] = (_input, options) =>
      (async function* () {
        yield connected()
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener(
            "abort",
            () => {
              aborted()
              resolve()
            },
            { once: true },
          ),
        )
      })()
    vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, event: { subscribe } })
    const { events, view } = provider(workspace)

    await vi.waitFor(() => expect(events.status()).toBe("connected"))
    view.unmount()
    await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce())
  })
})
