import type { PermissionRequest } from "@bymorning/client"
import { Permission } from "@bymorning/schema/permission"
import { Session } from "@bymorning/schema/session"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import { createStore } from "solid-js/store"
import { afterEach, describe, expect, it } from "vitest"
import { createController } from "./permission-controller"
import { SessionPermission } from "./ui/session-permission"

const parentID = Session.ID.make("00000000-0000-4000-8000-000000000001")
const childID = Session.ID.make("00000000-0000-4000-8000-000000000002")
const grandchildID = Session.ID.make("00000000-0000-4000-8000-000000000003")
const otherID = Session.ID.make("00000000-0000-4000-8000-000000000004")
const request = (sessionID = childID): PermissionRequest => ({
  id: Permission.ID.create(),
  sessionID,
  action: "websearch",
  resources: ["cats"],
})

function mount(list: (signal: AbortSignal) => Promise<ReadonlyArray<PermissionRequest>>) {
  const [state, setState] = createStore({
    revision: 0,
    connected: true,
    sessions: [
      { id: childID, parentID, title: "Research" },
      { id: grandchildID, parentID: childID, title: "Nested research" },
    ],
  })
  const replies: Array<{ request: PermissionRequest; reply: Permission.Reply }> = []
  let model!: SessionPermission.Model
  const view = render(() => {
    model = createController({
      data: { permissions: () => [], transcript: () => ({ state: "idle" }) },
      permission: {
        pending: () => false,
        error: () => undefined,
        reply: async (request, reply) => {
          replies.push({ request, reply })
        },
      },
      children: {
        sessionID: parentID,
        sessions: () => state.sessions,
        revision: () => state.revision,
        connected: () => state.connected,
        list,
      },
    })
    return <SessionPermission model={model} primary={() => {}} />
  })
  return { model, setState, replies, unmount: view.unmount }
}

afterEach(cleanup)

describe("child permission presentation", () => {
  it.each(["once", "reject"] as const)("answers %s in the parent using the original child request", async (reply) => {
    const child = request()
    let pending = [child, request(otherID)]
    const ui = mount(async () => pending)
    expect(await screen.findByText("Research · websearch")).toBeInTheDocument()
    pending = []
    screen.getByRole("button", { name: { once: "Once", always: "Always", reject: "Reject" }[reply] }).click()
    await waitFor(() => expect(ui.replies).toHaveLength(1))
    expect(ui.replies[0]).toMatchObject({ request: child, reply })
    await waitFor(() => expect(ui.model.item()).toBeUndefined())
  })

  it("refreshes repeated attention and reconnects, including nested children", async () => {
    let pending: ReadonlyArray<PermissionRequest> = []
    const ui = mount(async () => pending)
    const child = request()
    pending = [child]
    ui.setState("revision", 1)
    await waitFor(() => expect(ui.model.item()?.id).toBe(child.id))
    const nested = request(grandchildID)
    pending = [nested]
    ui.setState("revision", 2)
    expect(await screen.findByText("Nested research · websearch")).toBeInTheDocument()
    ui.setState("connected", false)
    pending = []
    ui.setState("connected", true)
    await waitFor(() => expect(ui.model.item()).toBeUndefined())
  })

  it("does not let an old snapshot resurrect a settled child request", async () => {
    const child = request()
    const stale = Promise.withResolvers<ReadonlyArray<PermissionRequest>>()
    let calls = 0
    const ui = mount(async () => {
      calls++
      return calls === 1 ? [child] : calls === 2 ? stale.promise : []
    })
    await waitFor(() => expect(ui.model.item()?.id).toBe(child.id))
    ui.setState("revision", 1)
    await waitFor(() => expect(calls).toBe(2))
    await ui.model.reply("once")
    stale.resolve([child])
    await stale.promise
    await waitFor(() => expect(ui.model.item()).toBeUndefined())
  })

  it("removes detached children and aborts pending reads when the parent closes", async () => {
    const child = request()
    const delayed = Promise.withResolvers<ReadonlyArray<PermissionRequest>>()
    const signals: AbortSignal[] = []
    const ui = mount(async (signal) => {
      signals.push(signal)
      return signals.length === 1 ? [child] : delayed.promise
    })
    await waitFor(() => expect(ui.model.item()?.id).toBe(child.id))
    ui.setState("sessions", [])
    expect(ui.model.item()).toBeUndefined()
    ui.setState("sessions", [{ id: childID, parentID, title: "Research" }])
    await waitFor(() => expect(signals).toHaveLength(2))
    ui.unmount()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    delayed.resolve([child])
    await delayed.promise
    expect(screen.queryByText("Permission required")).not.toBeInTheDocument()
  })

  it("shows a load failure and recovers on reconnect", async () => {
    let failed = true
    const ui = mount(async () => {
      if (failed) throw new Error("Permission service unavailable")
      return [request()]
    })
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission service unavailable")
    ui.setState("connected", false)
    failed = false
    ui.setState("connected", true)
    expect(await screen.findByText("Research · websearch")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
