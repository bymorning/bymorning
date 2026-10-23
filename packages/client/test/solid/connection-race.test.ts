import { createConnection } from "@bymorning/client/solid"
import type * as SDK from "@bymorning/client"
import { describe, expect, test, vi } from "vitest"

import { TestTransport, ids, owner, until } from "./fixture.js"

const eventID = "00000000-0000-4000-8000-000000000097" as SDK.WorkspaceEventItem["id"]

describe("Connection event/retry timers", () => {
  test("disposal in the first listener stops the remaining listeners and drained events", async () => {
    vi.useFakeTimers()
    const transport = new TestTransport()
    const scoped = owner(() => createConnection({ api: transport.api, workspace: ids.workspace }))
    const received: string[] = []
    scoped.value.listen((event) => { received.push(event.type); scoped.value.dispose() })
    scoped.value.listen(() => received.push("late listener"))
    await transport.receipt("/api/event")
    transport.event({ id: eventID, type: "server.connected", data: {} })
    await until(scoped.value.state, (state) => state.state === "connected")
    transport.event({ id: crypto.randomUUID() as SDK.WorkspaceEventItem["id"], type: "agent.created", created: 1, data: { workspaceID: ids.workspace, id: "agent" as SDK.SessionInfo["agent"] } })
    await vi.advanceTimersByTimeAsync(16)
    expect(received).toEqual(["server.connected"])
    expect(scoped.value.state()).toEqual({ state: "disposed" })
    scoped.dispose()
    vi.useRealTimers()
  })

  test("flushes a queued wire event and still reconnects after EOF", async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
    const transport = new TestTransport()
    const scoped = owner(() => createConnection({ api: transport.api, workspace: ids.workspace }))
    const received: SDK.WorkspaceEventItem[] = []
    scoped.value.listen((event) => received.push(event))
    await transport.receipt("/api/event")
    transport.event({ id: eventID, type: "server.connected", data: {} })
    await until(scoped.value.state, (state) => state.state === "connected")
    const queued: Extract<SDK.WorkspaceEventItem, { type: "agent.created" }> = { id: eventID, type: "agent.created", created: 1, data: { workspaceID: ids.workspace, id: "agent" as SDK.SessionInfo["agent"] } }
    transport.event(queued)
    transport.close()
    await until(scoped.value.state, (state) => state.state === "reconnecting")
    await vi.advanceTimersByTimeAsync(16)
    expect(received).toContainEqual(queued)
    await vi.advanceTimersByTimeAsync(1_000)
    await transport.receiptAfter(1, "/api/event")
    expect(transport.count("/api/event")).toBe(2)
    scoped.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
})
