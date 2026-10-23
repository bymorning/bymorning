import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Integration } from "@bymorning/schema/integration"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../context/dialog"
import { IntegrationProvider } from "../context/integration"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { Toast, toaster } from "../ui/components/toast"
import { MCPAuthorizeDialog } from "./authorize-dialog"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const integrationID = Integration.ID.make("mcp-linear")

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

function client(): ByMorningClient {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  return {
    ...base,
    integration: {
      ...base.integration,
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(undefined),
      oauth: {
        ...base.integration.oauth,
        connect: vi.fn().mockResolvedValue(
          Integration.Attempt.make({
            attemptID: Integration.AttemptID.make("mcp-linear-attempt"),
            url: "https://linear.app/oauth/authorize",
            instructions: "Complete authorization in your browser.",
            mode: "auto",
            time: { created: 1, expires: 2 },
          }),
        ),
        status: vi.fn().mockResolvedValue({ status: "pending", time: { created: 1, expires: 2 } }),
        complete: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    },
    websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
  }
}

function mount(value: ByMorningClient, onComplete?: () => void) {
  vi.spyOn(ByMorning, "make").mockReturnValue(value)
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => (
            <MCPAuthorizeDialog
              name="linear"
              integrationID={integrationID}
              {...(onComplete ? { onComplete } : {})}
            />
          ))
        }
      >
        Authenticate
      </button>
    )
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <SDKProvider>
        <DialogProvider>
          <WorkspaceScope list={[workspace]} current={workspace}>
            <IntegrationProvider>
              <Harness />
            </IntegrationProvider>
          </WorkspaceScope>
        </DialogProvider>
        <Toast.Region />
      </SDKProvider>
    </QueryClientProvider>
  ))
}

it("starts member OAuth immediately and shows Authorize without a label form", async () => {
  const value = client()
  mount(value)
  await userEvent.click(screen.getByRole("button", { name: "Authenticate" }))

  expect(await screen.findByRole("dialog", { name: "Connect linear" })).toBeInTheDocument()
  expect(screen.queryByLabelText(/Label/)).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument()
  const authorize = await screen.findByRole("link", { name: /Authorize/ })
  expect(authorize).toHaveAttribute("href", "https://linear.app/oauth/authorize")
  expect(authorize).toHaveAttribute("target", "_blank")
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for authorization")
  expect(value.integration.oauth.connect).toHaveBeenCalledWith(
    {
      integrationID,
      methodID: Integration.MethodID.make("oauth"),
      scope: "member",
      workspace: workspace.id,
    },
    expect.objectContaining({ signal: expect.anything() }),
  )
  expect(value.integration.get).not.toHaveBeenCalled()
})

it("cancels the attempt when the dialog closes", async () => {
  const value = client()
  mount(value)
  await userEvent.click(screen.getByRole("button", { name: "Authenticate" }))
  await screen.findByRole("link", { name: /Authorize/ })
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() =>
    expect(value.integration.oauth.cancel).toHaveBeenCalledWith(
      {
        integrationID,
        attemptID: Integration.AttemptID.make("mcp-linear-attempt"),
        workspace: workspace.id,
      },
      expect.objectContaining({ signal: expect.anything() }),
    ),
  )
})

it("refreshes on completion without a second connect step", async () => {
  const value = client()
  vi.mocked(value.integration.oauth.status).mockResolvedValueOnce({
    status: "complete",
    time: { created: 1, expires: 2 },
  })
  const onComplete = vi.fn()
  mount(value, onComplete)
  await userEvent.click(screen.getByRole("button", { name: "Authenticate" }))
  await screen.findByRole("link", { name: /Authorize/ })
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce(), { timeout: 2000 })
  expect(await screen.findByText("Connected linear")).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})
