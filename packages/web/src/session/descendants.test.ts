import { ByMorning, type ByMorningClient, type SessionInfo, type WorkspaceEventItem } from "@bymorning/client"
import { Agent } from "@bymorning/schema/agent"
import { Event } from "@bymorning/schema/event"
import { Project } from "@bymorning/schema/project"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import * as Workspace from "@bymorning/schema/workspace"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { waitFor } from "@solidjs/testing-library"
import { expect, it, vi } from "vitest"
import { createDescendants } from "./descendants"

const root = Session.ID.make(crypto.randomUUID())
const workspace = Workspace.ID.create()
const child = (parentID: Session.ID, title = "Child"): SessionInfo => ({
  id: Session.ID.make(crypto.randomUUID()),
  parentID,
  projectID: Project.ID.create(),
  title,
  agent: Agent.DefaultID,
  model: { provider: Provider.Name.make("test"), id: "model" },
  createdAt: new Date(0),
  updatedAt: new Date(1),
})
type Unsent<T> = T extends unknown ? Omit<T, "id"> : never
const event = (value: Unsent<WorkspaceEventItem>) =>
  ({ id: Event.ID.make(crypto.randomUUID()), ...value }) as WorkspaceEventItem

function mount(list: ByMorningClient["session"]["list"], sessionID: () => Session.ID = () => root) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  let listener!: (event: WorkspaceEventItem) => void
  const off = vi.fn()
  const mounted = createRoot((dispose) => ({
    dispose,
    rows: createDescendants({
      client: { ...base, session: { ...base.session, list } },
      workspace,
      sessionID,
      connection: {
        listen: (callback) => {
          listener = callback
          return off
        },
      },
    }),
  }))
  return { ...mounted, off, send: (value: Unsent<WorkspaceEventItem>) => listener(event(value)) }
}

it("discovers paginated descendants by parent without fetching or copying the root inventory", async () => {
  const first = child(root)
  const second = child(root)
  const nested = child(first.id)
  const list = vi.fn<ByMorningClient["session"]["list"]>().mockImplementation(async (input) => {
    if (input?.parentID === root) return input.cursor ? { data: [second] } : { data: [first], cursor: "next" }
    if (input?.parentID === first.id) return { data: [nested] }
    return { data: [] }
  })
  const mounted = mount(list)
  await waitFor(() => expect(mounted.rows()?.map((row) => row.id)).toEqual([first.id, second.id, nested.id]))
  expect(list.mock.calls.every(([input]) => input?.parentID !== undefined && input.parentID !== null)).toBe(true)
  expect(list.mock.calls[1]?.[0]).toMatchObject({ parentID: root, cursor: "next" })
  list.mockResolvedValue({ data: [] })
  mounted.send({ type: "server.connected", data: {} })
  await waitFor(() => expect(mounted.rows()).toEqual([]))
  mounted.dispose()
  expect(mounted.off).toHaveBeenCalledOnce()
  expect(list.mock.lastCall?.[1]?.signal?.aborted).toBe(true)
})

it("lists every parent of one depth in a single round trip", async () => {
  const children = [child(root), child(root), child(root)]
  let open = 0
  let peak = 0
  const list = vi.fn<ByMorningClient["session"]["list"]>().mockImplementation(async (input) => {
    open++
    peak = Math.max(peak, open)
    await new Promise((resolve) => setTimeout(resolve, 5))
    open--
    return { data: input?.parentID === root ? children : [] }
  })
  const mounted = mount(list)
  await waitFor(() => expect(mounted.rows()).toHaveLength(3))
  expect(list).toHaveBeenCalledTimes(4)
  expect(peak).toBe(3)
  mounted.dispose()
})

it("applies Session events to the discovered subtree without new requests", async () => {
  const first = child(root, "First")
  const list = vi
    .fn<ByMorningClient["session"]["list"]>()
    .mockImplementation(async (input) => ({ data: input?.parentID === root ? [first] : [] }))
  const mounted = mount(list)
  await waitFor(() => expect(mounted.rows()?.map((row) => row.id)).toEqual([first.id]))
  const calls = list.mock.calls.length

  const created = child(root, "Second")
  mounted.send({ type: "session.created", created: 1, data: { sessionID: created.id, session: created } })
  const nested = child(created.id, "Nested")
  mounted.send({ type: "session.created", created: 2, data: { sessionID: nested.id, session: nested } })
  expect(mounted.rows()?.map((row) => row.id)).toEqual([first.id, created.id, nested.id])

  const unrelated = child(Session.ID.make(crypto.randomUUID()))
  mounted.send({ type: "session.created", created: 3, data: { sessionID: unrelated.id, session: unrelated } })
  const { parentID: _parent, ...self } = first
  mounted.send({ type: "session.updated", created: 4, data: { sessionID: root, session: { ...self, id: root } } })
  expect(mounted.rows()).toHaveLength(3)

  mounted.send({
    type: "session.updated",
    created: 5,
    data: { sessionID: first.id, session: { ...first, title: "Renamed" } },
  })
  expect(mounted.rows()?.find((row) => row.id === first.id)?.title).toBe("Renamed")

  mounted.send({
    type: "session.updated",
    created: 6,
    data: { sessionID: first.id, session: { ...first, archivedAt: new Date(7) } },
  })
  expect(mounted.rows()?.map((row) => row.id)).toEqual([created.id, nested.id])

  mounted.send({ type: "session.deleted", created: 8, data: { sessionID: created.id } })
  expect(mounted.rows()).toEqual([])
  expect(list).toHaveBeenCalledTimes(calls)
  mounted.dispose()
})

it("repeats discovery once when Session events arrive while it is in flight", async () => {
  const first = child(root)
  const gate = Promise.withResolvers<void>()
  let reads = 0
  const list = vi.fn<ByMorningClient["session"]["list"]>().mockImplementation(async (input) => {
    if (input?.parentID !== root) return { data: [] }
    if (reads++ === 0) await gate.promise
    return { data: [first] }
  })
  const mounted = mount(list)
  await waitFor(() => expect(reads).toBe(1))
  mounted.send({ type: "session.created", created: 1, data: { sessionID: first.id, session: first } })
  mounted.send({ type: "session.created", created: 2, data: { sessionID: first.id, session: first } })
  gate.resolve()
  await waitFor(() => expect(mounted.rows()?.map((row) => row.id)).toEqual([first.id]))
  expect(reads).toBe(2)
  mounted.dispose()
})

it("does not refetch when the same Session is supplied through a new identity", async () => {
  const list = vi.fn<ByMorningClient["session"]["list"]>().mockResolvedValue({ data: [] })
  const [source, setSource] = createStore({ session: { id: root } })
  const mounted = mount(list, () => source.session.id)
  await waitFor(() => expect(mounted.rows()).toEqual([]))
  setSource("session", { id: root })
  await Promise.resolve()
  expect(list).toHaveBeenCalledTimes(1)
  mounted.dispose()
})
