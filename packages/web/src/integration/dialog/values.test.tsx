import { ByMorning, type ByMorningClient, type IntegrationInfo } from "@bymorning/client"
import { Integration } from "@bymorning/schema/integration"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider, useDialog } from "../../context/dialog"
import { IntegrationProvider } from "../../context/integration"
import { SDKProvider } from "../../context/sdk"
import { TestDataProvider as DataProvider } from "../../context/test-data-provider"
import { WorkspaceScope } from "../../context/workspace"
import { Toast, toaster } from "../../ui/components/toast"
import { renderForm as render } from "../../ui/form-query.test-support"
import { IntegrationDialog } from "./dialog"

const member = WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "Test", status: "active", role: "member" })
const riverID = Integration.ID.make("mcp-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const river: IntegrationInfo = {
  id: riverID,
  name: "river MCP",
  connectionPolicy: "member-only",
  methods: [{ type: "values", label: "Member values", fields: ["JIRA_TOKEN"], saved: [] }],
  connections: [],
}
const linear: IntegrationInfo = {
  id: Integration.ID.make("mcp-fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"),
  name: "linear MCP",
  connectionPolicy: "member-only",
  methods: [{ id: Integration.MethodID.make("oauth"), type: "oauth", label: "OAuth" }],
  connections: [],
}
const anthropic: IntegrationInfo = {
  id: Integration.ID.make("anthropic"),
  name: "Anthropic",
  methods: [{ type: "key", label: "API key" }],
  connections: [],
}

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

function mount() {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const client = {
    ...base,
    integration: {
      ...base.integration,
      list: vi.fn().mockResolvedValue([anthropic, linear, river]),
      get: vi.fn().mockImplementation(({ integrationID }) =>
        Promise.resolve([anthropic, linear, river].find((item) => item.id === integrationID)),
      ),
      connect: { ...base.integration.connect, values: vi.fn().mockResolvedValue(undefined) },
    },
    mcp: {
      ...base.mcp,
      servers: {
        ...base.mcp.servers,
        list: vi.fn().mockResolvedValue([
          { name: "river", url: "https://river.example/mcp", enabled: true, status: "connected", auth: "values", integrationID: riverID },
        ]),
        connect: vi.fn().mockResolvedValue(undefined),
      },
      tools: { ...base.mcp.tools, list: vi.fn().mockResolvedValue([]) },
    },
    websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([]) },
  } as unknown as ByMorningClient
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  function Harness() {
    const dialog = useDialog()
    return (
      <button type="button" onClick={() => dialog.show(() => <IntegrationDialog />)}>
        Connect integration
      </button>
    )
  }
  render(() => (
    <>
      <Toast.Region />
      <SDKProvider>
        <WorkspaceScope list={[member]} current={member}>
          <DialogProvider>
            <DataProvider>
              <IntegrationProvider>
                <Harness />
              </IntegrationProvider>
            </DataProvider>
          </DialogProvider>
        </WorkspaceScope>
      </SDKProvider>
    </>
  ))
  return client
}

it("lists MCP servers first with a plain description, never their integration identity", async () => {
  mount()
  await userEvent.click(screen.getByRole("button", { name: "Connect integration" }))
  const options = await screen.findAllByRole("option")
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining("linear MCP"),
    expect.stringContaining("river MCP"),
    expect.stringContaining("Anthropic"),
  ])
  expect(options[0]).toHaveTextContent("Sign in with your account")
  expect(options[1]).toHaveTextContent("Enter your own values")
  expect(screen.getByText("MCP servers")).toBeInTheDocument()
  expect(document.body).not.toHaveTextContent("mcp-0123456789abcdef")
  expect(options[2]).toHaveTextContent("anthropic")
})

it("opens the member's own values form for a values server and saves through the member endpoint", async () => {
  const client = mount()
  await userEvent.click(screen.getByRole("button", { name: "Connect integration" }))
  await userEvent.click(await screen.findByRole("option", { name: /river MCP/ }))

  // The server is found from its integration, so the member never needs to know its name.
  const dialog = await screen.findByRole("dialog", { name: "Connect river" })
  const token = await within(dialog).findByLabelText(/^JIRA_TOKEN/)
  expect(token).toHaveAttribute("type", "password")
  await userEvent.type(token, "member-secret")
  await userEvent.click(within(dialog).getByRole("button", { name: "Save values" }))

  await waitFor(() =>
    expect(client.integration.connect.values).toHaveBeenCalledWith({
      integrationID: riverID,
      values: { JIRA_TOKEN: "member-secret" },
      workspace: member.id,
    }),
  )
  expect(client.mcp.servers.connect).toHaveBeenCalledWith({ server: "river", workspace: member.id })
})
