import { createConnection } from "@bymorning/client/solid"
import { describe, expect, test, vi } from "vitest"

import { TestTransport, ids, owner, until } from "./fixture.js"

describe("Connection", () => {
  test("uses one generated SDK stream, requires its handshake, and disposes its request", async () => {
    const transport = new TestTransport()
    const scoped = owner(() => createConnection({ api: transport.api, workspace: ids.workspace }))
    await transport.receipt("/api/event")
    expect(scoped.value.state()).toEqual({ state: "connecting" })
    transport.event({ id: "00000000-0000-4000-8000-000000000031" as never, type: "server.connected", data: {} })
    await until(scoped.value.state, (state) => state.state === "connected")
    expect(transport.count("/api/event")).toBe(1)
    scoped.dispose()
    expect(transport.requests[0]?.init.signal?.aborted).toBe(true)
    expect(scoped.value.state()).toEqual({ state: "disposed" })
  })

  test("schedules one generated-stream retry after EOF and disposal cancels it", async () => {
    vi.useFakeTimers()
    const transport = new TestTransport()
    const scoped = owner(() => createConnection({ api: transport.api, workspace: ids.workspace }))
    await transport.receipt("/api/event")
    transport.event({ id: "00000000-0000-4000-8000-000000000032" as never, type: "server.connected", data: {} })
    await until(scoped.value.state, (state) => state.state === "connected")
    transport.close()
    await until(scoped.value.state, (state) => state.state === "reconnecting")
    const before = transport.requests.length
    scoped.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.requests).toHaveLength(before)
    vi.useRealTimers()
  })
})
