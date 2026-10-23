import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { Integration } from "@bymorning/schema/integration"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { WorkspaceScope } from "../context/workspace"
import { Toast, toaster } from "../ui/components/toast"
import { renderForm as render } from "../ui/form-query.test-support"
import { MCPValuesDialog } from "./values-dialog"

const workspace = WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "Test", status: "active", role: "member" })
const integrationID = Integration.ID.make("mcp-river")
const server = (status: Record<string, unknown>) => ({
  name: "river",
  url: "https://river.example/mcp",
  enabled: true,
  auth: "values",
  integrationID,
  ...status,
})

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

function mount(input: { readonly saved?: string[]; readonly after: Record<string, unknown> }) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  let saved = false
  const client = {
    ...base,
    integration: {
      ...base.integration,
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        id: integrationID,
        name: "river MCP",
        connectionPolicy: "member-only",
        methods: [{ type: "values", label: "Member values", fields: ["JIRA_TOKEN", "CONFLUENCE_TOKEN"], saved: input.saved ?? [] }],
        connections: [],
      }),
      connect: {
        ...base.integration.connect,
        values: vi.fn().mockImplementation(async () => {
          saved = true
        }),
      },
    },
    mcp: {
      ...base.mcp,
      servers: {
        ...base.mcp.servers,
        list: vi.fn().mockImplementation(async () => [saved ? server(input.after) : server({ status: "needs_auth" })]),
        connect: vi.fn().mockResolvedValue(undefined),
      },
      tools: { ...base.mcp.tools, list: vi.fn().mockResolvedValue([]) },
    },
  } as unknown as ByMorningClient
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  const onComplete = vi.fn()
  function Harness() {
    const dialog = useDialog()
    return (
      <button
        type="button"
        onClick={() =>
          dialog.show(() => <MCPValuesDialog name="river" integrationID={integrationID} onComplete={onComplete} />)
        }
      >
        Authenticate
      </button>
    )
  }
  render(() => (
    <>
      <Toast.Region />
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DialogProvider>
            <DataProvider>
              <Harness />
            </DataProvider>
          </DialogProvider>
        </WorkspaceScope>
      </SDKProvider>
    </>
  ))
  return { client, onComplete }
}

it("saves the member's own values as secrets, reconnects, and closes once the server accepts them", async () => {
  const { client, onComplete } = mount({ after: { status: "connected" } })
  await userEvent.click(screen.getByRole("button", { name: "Authenticate" }))
  const dialog = await screen.findByRole("dialog", { name: "Connect river" })
  const jira = await screen.findByLabelText(/^JIRA_TOKEN/)
  expect(jira).toHaveAttribute("type", "password")
  await userEvent.type(jira, "jira-secret")
  await userEvent.type(screen.getByLabelText(/^CONFLUENCE_TOKEN/), "confluence-secret")
  await userEvent.click(screen.getByRole("button", { name: "Save values" }))

  await waitFor(() => expect(onComplete).toHaveBeenCalled())
  expect(client.integration.connect.values).toHaveBeenCalledWith(
    { integrationID, values: { JIRA_TOKEN: "jira-secret", CONFLUENCE_TOKEN: "confluence-secret" }, workspace: workspace.id },
  )
  expect(client.mcp.servers.connect).toHaveBeenCalledWith({ server: "river", workspace: workspace.id })
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it("keeps saved values when their fields are left blank and reports values the server rejects", async () => {
  const { client } = mount({
    saved: ["JIRA_TOKEN", "CONFLUENCE_TOKEN"],
    after: { status: "failed", error: "Server rejected your values" },
  })
  await userEvent.click(screen.getByRole("button", { name: "Authenticate" }))
  const jira = await screen.findByLabelText(/^JIRA_TOKEN/)
  const dialog = screen.getByRole("dialog", { name: "Connect river" })
  // Saved values are never shown; the label says so and a blank field keeps them.
  expect(dialog.querySelectorAll('[data-slot="mcp-value-saved"]')).toHaveLength(2)
  expect(jira).toHaveAttribute("placeholder", expect.stringContaining("Leave blank to keep"))
  expect(jira).toHaveValue("")
  await userEvent.type(jira, "replacement")
  await userEvent.click(screen.getByRole("button", { name: "Replace values" }))

  const rejected = await screen.findByText("Server rejected your values")
  expect(rejected).toHaveAttribute("role", "alert")
  expect(client.integration.connect.values).toHaveBeenCalledWith(
    { integrationID, values: { JIRA_TOKEN: "replacement" }, workspace: workspace.id },
  )
  expect(screen.getByRole("dialog", { name: "Connect river" })).toBeInTheDocument()
})

it("requires every value that has not been saved before", async () => {
  const { client } = mount({ after: { status: "connected" } })
  await userEvent.click(screen.getByRole("button", { name: "Authenticate" }))
  await userEvent.type(await screen.findByLabelText(/^JIRA_TOKEN/), "only-one")
  await userEvent.click(screen.getByRole("button", { name: "Save values" }))
  expect(await screen.findByText("Enter CONFLUENCE_TOKEN")).toBeInTheDocument()
  expect(client.integration.connect.values).not.toHaveBeenCalled()
})

it("focuses the first value and marks the fields that are still missing", async () => {
  mount({ after: { status: "connected" } })
  await userEvent.click(screen.getByRole("button", { name: "Authenticate" }))
  const jira = await screen.findByLabelText(/^JIRA_TOKEN/)
  await waitFor(() => expect(jira).toHaveFocus())
  await userEvent.type(jira, "only-one")
  await userEvent.click(screen.getByRole("button", { name: "Save values" }))
  await screen.findByText("Enter CONFLUENCE_TOKEN")
  expect(screen.getByLabelText(/^CONFLUENCE_TOKEN/).closest('[data-component="text-input"]')).toHaveAttribute("data-invalid")
  expect(jira.closest('[data-component="text-input"]')).not.toHaveAttribute("data-invalid")
})
