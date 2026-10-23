import { ByMorning } from "@bymorning/client"
import { Event } from "@bymorning/schema/event"
import { Session } from "@bymorning/schema/session"
import { render, waitFor } from "@solidjs/testing-library"
import { Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { afterEach, expect, expectTypeOf, it, vi } from "vitest"
import { TestTransport, ids, json, message } from "../../../../client/test/solid/fixture"
import { SDKProvider } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { TestDataProvider } from "../../context/test-data-provider"
import { useServer } from "../../runtime/server/runtime"
import type { ServerSync } from "../../runtime/server/sync"
import { SessionUIProvider, useSessionUI, type SessionUI } from "./session-context"

afterEach(() => vi.restoreAllMocks())

function mount() {
  const http = new TestTransport()
  http.when((r) => r.url.pathname === "/api/models", json([]))
  vi.spyOn(ByMorning, "make").mockReturnValue(http.api)
  const [route, setRoute] = createStore({ id: ids.session })
  let session!: SessionUI.Interface
  let server!: ServerSync
  function Consumer() {
    session = useSessionUI()
    return <div data-testid="readiness">{session.data.transcript().state}</div>
  }
  function Selected(props: { id: Session.ID }) {
    server = useServer()
    void server.bootstrap()
    void server.select(props.id)
    onCleanup(() => {
      server.release(props.id)
    })
    return (
      <SessionUIProvider sessionID={props.id}>
        <Consumer />
      </SessionUIProvider>
    )
  }
  const workspace = { id: ids.workspace, name: "Test", status: "active" as const, role: "admin" as const }
  const view = render(() => (
    <SDKProvider>
      <WorkspaceScope list={[workspace]} current={workspace}>
        <TestDataProvider>
          <Show keyed when={route.id}>
            {(id) => <Selected id={id} />}
          </Show>
        </TestDataProvider>
      </WorkspaceScope>
    </SDKProvider>
  ))
  const connected = new Promise<void>((resolve) => server.connection.on("server.connected", () => resolve()))
  void http
    .receipt("/api/event")
    .then(() => http.event({ id: Event.ID.make(crypto.randomUUID()), type: "server.connected", data: {} }))
  return {
    http,
    view,
    connected,
    session: () => session,
    server: () => server,
    select: (id: Session.ID) => setRoute("id", id),
  }
}

it("accepts only route-decoded Session identities", () => {
  expectTypeOf<SessionUI.ProviderProps["sessionID"]>().toEqualTypeOf<Session.ID>()
})

it("derives UI readiness from the shared selected history", async () => {
  const mounted = mount()
  await waitFor(() => expect(mounted.view.getByTestId("readiness").textContent).toBe("ready"))
  expect(mounted.session().data.detail()).toMatchObject({ state: "ready", data: { id: ids.session } })
  mounted.view.unmount()
})

it("disposes routed selection while retaining the workspace stream", async () => {
  const mounted = mount()
  await waitFor(() => expect(mounted.session().data.transcript().state).toBe("ready"))
  const stream = await mounted.http.receipt("/api/event")
  mounted.select(ids.other)
  await waitFor(() => expect(mounted.session().data.detail()).toMatchObject({ data: { id: ids.other } }))
  expect(mounted.server().data.session.message.list(ids.session)).toEqual([])
  expect(stream.init.signal?.aborted).toBe(false)
  expect(mounted.http.count("/api/event")).toBe(1)
  mounted.view.unmount()
  await waitFor(() => expect(stream.init.signal?.aborted).toBe(true))
})

it("projects shared history refreshes into the mounted UI", async () => {
  const mounted = mount()
  await waitFor(() => expect(mounted.session().data.transcript().state).toBe("ready"))
  mounted.http.when((r) => r.url.pathname.endsWith("/message"), json({ data: [message()], cursor: {} }))
  mounted.server().data.session.message.invalidate(ids.session)
  await mounted.server().data.session.message.sync(ids.session)
  expect(mounted.session().data.transcript()).toMatchObject({ state: "ready", data: [{ message: { text: "hello" } }] })
  mounted.view.unmount()
})

it("projects the workspace live stream into a ready selected transcript", async () => {
  const mounted = mount()
  await mounted.connected
  await waitFor(() => expect(mounted.session().data.transcript().state).toBe("ready"))
  await mounted.http.receipt("/api/event")
  mounted.http.event({
    id: Event.ID.make(crypto.randomUUID()),
    type: "session.input.promoted",
    created: 1,
    data: { sessionID: ids.session, inboxID: ids.message, message: { ...message(), type: "user" } },
  })
  await waitFor(() =>
    expect(mounted.session().data.transcript()).toMatchObject({
      state: "ready",
      data: [{ message: { text: "hello" } }],
    }),
  )
  expect(mounted.view.getByTestId("readiness").textContent).toBe("ready")
  mounted.view.unmount()
})
