import { ByMorning, type ByMorningClient, type FormInfo } from "@bymorning/client"
import { Form } from "@bymorning/schema/form"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import { afterEach, expect, it, vi } from "vitest"
import { QueryClientProvider } from "@tanstack/solid-query"
import { createQuery } from "../runtime/server/query"

import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { FormRoute } from "./route"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

function mountForm(fetch: typeof globalThis.fetch, first: FormInfo) {
  const api = ByMorning.make({ baseUrl: "http://localhost", fetch })
  vi.spyOn(ByMorning, "make").mockReturnValue(api)
  const query = createQuery()
  const history = createMemoryHistory()
  history.set({ value: `/w/${workspace.id}/form/${first.id}` })
  const view = render(() => (
    <QueryClientProvider client={query}>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <MemoryRouter history={history}>
            <Route path="/w/:workspaceID/form/:formID?" component={FormRoute} />
          </MemoryRouter>
        </WorkspaceScope>
      </SDKProvider>
    </QueryClientProvider>
  ))
  return { query, history, ...view }
}

const first: FormInfo = {
  id: Form.ID.create(),
  title: "First request",
  fields: [{ key: "name", type: "string", title: "Name" }],
}
const second: FormInfo = { ...first, id: Form.ID.create(), title: "Second request" }

it("retains cancellation rejection in the native mutation and admits a retry without a duplicate same-tick write", async () => {
  const gate = Promise.withResolvers<Response>()
  const writes = vi
    .fn()
    .mockReturnValueOnce(gate.promise)
    .mockResolvedValue(new Response(null, { status: 204 }))
  const fetch: typeof globalThis.fetch = async (url, init) =>
    init?.method === "POST" ? writes(url) : Response.json(String(url).includes(first.id) ? first : [])
  const { query } = mountForm(fetch, first)
  const cancel = await screen.findByRole("button", { name: "Cancel" })
  fireEvent.click(cancel)
  fireEvent.click(cancel)
  await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
  expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled()
  gate.reject(new Error("Connection lost"))
  await screen.findByRole("alert")
  expect(query.getMutationCache().getAll().at(-1)?.state.status).toBe("error")
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await screen.findByRole("heading", { name: "Forms" })
  expect(writes).toHaveBeenCalledTimes(2)
})

it("does not navigate the new route when an old cancellation or poll completes", async () => {
  const write = Promise.withResolvers<Response>()
  const secondWrite = Promise.withResolvers<Response>()
  const poll = Promise.withResolvers<Response>()
  let tick: (() => void) | undefined
  const interval = globalThis.setInterval.bind(globalThis)
  vi.spyOn(window, "setInterval").mockImplementation((handler, delay) => {
    const timer = interval(handler, delay)
    if (delay === 2_000) {
      tick = handler as () => void
      clearInterval(timer)
    }
    return timer
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (init?.method === "POST") return String(url).includes(first.id) ? write.promise : secondWrite.promise
    if (String(url).includes("/state")) return poll.promise
    return Response.json(String(url).includes(first.id) ? first : second)
  })
  const { history, query } = mountForm(fetch, first)
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true))
  tick!()
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/state"))).toBe(true))
  history.set({ value: `/w/${workspace.id}/form/${second.id}` })
  await screen.findByRole("heading", { name: "Second request" })
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2))
  write.resolve(new Response(null, { status: 204 }))
  poll.resolve(Response.json({ status: "cancelled" }))
  await waitFor(() => expect(query.getMutationCache().getAll()[0]?.state.status).toBe("success"))
  expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled()
  secondWrite.reject(new Error("Second cancellation failed"))
  await screen.findByRole("alert")
  expect(screen.getByRole("heading", { name: "Second request" })).toBeInTheDocument()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("aborts an in-flight form query when the route is disposed", () => {
  let signal: AbortSignal | undefined
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const list = vi.fn<ByMorningClient["form"]["caller"]["list"]>((_, options) => {
    signal = options?.signal
    return new Promise(() => undefined)
  })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    form: { ...base.form, caller: { ...base.form.caller, list } },
  })

  const view = render(() => (
    <SDKProvider>
      <QueryClientProvider client={createQuery()}>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <MemoryRouter>
            <Route path="/" component={FormRoute} />
          </MemoryRouter>
        </WorkspaceScope>
      </QueryClientProvider>
    </SDKProvider>
  ))

  expect(screen.getByRole("status")).toHaveTextContent("Loading form…")
  expect(signal?.aborted).toBe(false)
  view.unmount()
  expect(signal?.aborted).toBe(true)
})
