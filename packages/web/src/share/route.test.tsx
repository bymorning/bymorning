import { ByMorning, type ByMorningClient, type ShareView } from "@bymorning/client"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SDKProvider } from "../context/sdk"
import { shareFixture } from "./fixture"
import { ShareRoute } from "./route"

function clientWith(get: (input: { workspaceID: string; token: string }) => Promise<ShareView>) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    "server.share": {
      get: vi.fn(get) as unknown as ByMorningClient["server.share"]["get"],
    },
  } satisfies ByMorningClient
}

function mount(client: ByMorningClient, path: string) {
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  const history = createMemoryHistory()
  history.set({ value: path })
  const view = render(() => (
    <SDKProvider>
      <MemoryRouter history={history}>
        <Route path="/s/:workspaceID/:token" component={ShareRoute} />
      </MemoryRouter>
    </SDKProvider>
  ))
  return { unmount: view.unmount }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("ShareRoute", () => {
  it("shows Loading… copy while the public Share view is in flight", async () => {
    const view = shareFixture()
    const deferred = Promise.withResolvers<ShareView>()
    const client = clientWith(() => deferred.promise)
    const mounted = mount(client, `/s/${view.workspaceID}/${view.token}`)

    expect(screen.getByRole("status")).toHaveTextContent("Loading…")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Message" })).not.toBeInTheDocument()
    expect(document.querySelector("[data-component='message-timeline'][data-loading]")).not.toBeInTheDocument()

    deferred.resolve(view)
    await waitFor(() => expect(screen.getByRole("heading", { name: "Shared conversation" })).toBeInTheDocument())
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    mounted.unmount()
  })

  it("renders the Session workspace for a mocked Share view", async () => {
    const view = shareFixture()
    const client = clientWith(async () => view)
    const mounted = mount(client, `/s/${view.workspaceID}/${view.token}`)

    await waitFor(() => expect(screen.getByRole("heading", { name: "Shared conversation" })).toBeInTheDocument())
    expect(document.querySelector("[data-component='shell']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='shell-content']")).toBeInTheDocument()
    expect(document.querySelector("[data-component='session-workspace']")).toBeInTheDocument()
    expect(document.querySelector("[data-component='session-timeline']")).toBeInTheDocument()
    expect(document.querySelector("[data-component='session-header']")).toBeInTheDocument()
    expect(screen.getByText("Share this conversation")).toBeInTheDocument()
    expect(document.querySelector("[data-component='session-timeline']")?.textContent).toContain("gpt-5.6-sol")
    expect(screen.queryByRole("combobox", { name: "Message" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
    mounted.unmount()
  })

  it("keeps invalid and missing grants as alerts without a composer", async () => {
    const view = shareFixture()
    const client = clientWith(async () => {
      throw { _tag: "Share.NotFoundError", workspaceID: view.workspaceID, token: view.token, message: "Share not found" }
    })
    const invalid = mount(client, `/s/${view.workspaceID}/not-a-uuid`)
    expect(screen.getByRole("alert")).toHaveTextContent("This share link is not valid")
    expect(screen.queryByRole("combobox", { name: "Message" })).not.toBeInTheDocument()
    invalid.unmount()

    const missing = mount(client, `/s/${view.workspaceID}/${view.token}`)
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This link no longer points to a shared conversation"),
    )
    missing.unmount()
  })
})
