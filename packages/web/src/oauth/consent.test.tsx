import {
  ByMorning,
  type ApiOauthApproveInput,
  type ApiOauthRequestGetInput,
  type ApiOauthRequestGetOutput,
  type ByMorningClient,
  type WorkspaceListOutput,
} from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { SDKProvider } from "../context/sdk"
import { OAuthConsent } from "./consent"

const requestID = "oau_test" as ApiOauthRequestGetInput["id"]
const workspaces: WorkspaceListOutput = [
  WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "Test", status: "active", role: "admin" }),
  WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "Production", status: "active", role: "admin" }),
]

function mount(input: {
  readonly get: ByMorningClient["api.oauth"]["request"]["get"]
  readonly approve?: ByMorningClient["api.oauth"]["approve"]
  readonly deny?: ByMorningClient["api.oauth"]["deny"]
}) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const approve = input.approve ?? vi.fn()
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    workspace: { ...base.workspace, list: vi.fn().mockResolvedValue(workspaces) },
    "api.oauth": {
      ...base["api.oauth"],
      request: { ...base["api.oauth"].request, get: input.get },
      approve,
      deny: input.deny ?? base["api.oauth"].deny,
    },
  })
  const history = createMemoryHistory()
  history.set({ value: `/oauth/consent?request=${requestID}` })
  const view = render(() => (
    <SDKProvider>
      <MemoryRouter history={history}>
        <Route path="/oauth/consent" component={OAuthConsent} />
      </MemoryRouter>
    </SDKProvider>
  ))
  return { ...view, approve, history }
}

afterEach(() => {
  cleanup()
  window.location.hash = ""
  vi.restoreAllMocks()
})

it("renders the client and workspaces and approves the selected workspace", async () => {
  const get = vi.fn().mockResolvedValue({
    clientName: "Example MCP",
    clientID: "ocl_test" as ApiOauthRequestGetOutput["clientID"],
  })
  const approve = vi.fn().mockResolvedValue({ url: "#approved" })
  mount({ get, approve })

  expect(await screen.findByRole("heading", { name: "Example MCP wants access to a workspace" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Test" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Production" })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Production" }))

  await waitFor(() =>
    expect(approve).toHaveBeenCalledWith({
      requestID,
      workspaceID: workspaces[1]!.id,
    } satisfies ApiOauthApproveInput),
  )
  await waitFor(() => expect(window.location.hash).toBe("#approved"))
})

it("renders an unavailable state when the authorization request is not found", async () => {
  mount({
    get: vi.fn().mockRejectedValue({
      _tag: "OAuth.RequestNotFoundError",
      requestID,
      message: "Authorization request not found",
    }),
  })

  expect(await screen.findByRole("heading", { name: "Authorization request unavailable" })).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("missing, invalid, or has expired")
  expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument()
})

it("re-enables denial after a rejected request and redirects only after a successful retry", async () => {
  const deny = vi.fn().mockRejectedValueOnce(new Error("Cancellation failed")).mockResolvedValue({ url: "#denied" })
  mount({ get: vi.fn().mockResolvedValue({ clientName: "Example", clientID: "ocl_test" }), deny })
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Cancellation failed")
  expect(window.location.hash).toBe("")
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(window.location.hash).toBe("#denied"))
  expect(deny).toHaveBeenCalledTimes(2)
  expect(deny).toHaveBeenLastCalledWith({ requestID })
})

it("does not redirect a newer request when the old approval completes", async () => {
  const gate = Promise.withResolvers<{ url: string }>()
  const approve = vi.fn(() => gate.promise)
  const deny = vi.fn().mockResolvedValue({ url: "#new-request" })
  const { history } = mount({
    get: vi.fn().mockResolvedValue({ clientName: "Example", clientID: "ocl_test" }),
    approve,
    deny,
  })
  await userEvent.click(await screen.findByRole("button", { name: "Production" }))
  expect(screen.getByRole("button", { name: "Test" })).toBeDisabled()
  history.set({ value: "/oauth/consent?request=oau_other" })
  await waitFor(() => expect(screen.getByRole("button", { name: "Test" })).toBeEnabled())
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(window.location.hash).toBe("#new-request"))
  expect(deny).toHaveBeenCalledWith({ requestID: "oau_other" })
  gate.resolve({ url: "#obsolete" })
  await gate.promise
  expect(window.location.hash).toBe("#new-request")
})
