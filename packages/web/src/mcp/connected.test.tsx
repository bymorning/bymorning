import { ByMorning, type ByMorningClient, type IntegrationInfo, type ProviderDirectoryEntry } from "@bymorning/client"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { DialogProvider } from "../context/dialog"
import { IntegrationProvider } from "../context/integration"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { Toast, toaster } from "../ui/components/toast"
import { renderForm as render } from "../ui/form-query.test-support"
import { ConnectedSection } from "./connected"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

const openai: IntegrationInfo = {
  id: Integration.ID.make("openai"),
  name: "OpenAI",
  methods: [{ type: "key", label: "API key" }],
  connections: [{ type: "credential", id: Credential.ID.make("cred_openai"), label: "Production" }],
}
const gmail: IntegrationInfo = {
  id: Integration.ID.make("google-gmail"),
  name: "Gmail",
  connectionPolicy: "member-only",
  methods: [{ type: "oauth", label: "Sign in with Google", client: { configured: true, fields: [] } } as never],
  connections: [{ type: "credential", id: Credential.ID.make("cred_gmail"), label: "john@example.com" }],
}
const linear: IntegrationInfo = {
  id: Integration.ID.make("linear"),
  name: "Linear",
  methods: [{ type: "key", label: "API key" }],
  connections: [],
}
const exa: IntegrationInfo = {
  id: Integration.ID.make("exa"),
  name: "Exa",
  methods: [{ type: "key", label: "API key" }],
  connections: [],
}
const slack: IntegrationInfo = {
  id: Integration.ID.make("slack"),
  name: "Slack",
  connectionPolicy: "member-only",
  methods: [{ type: "oauth", label: "Sign in with Slack", client: { configured: false, fields: [] } } as never],
  connections: [],
}
const providerEntry: ProviderDirectoryEntry = {
  info: {
    name: Provider.OpenAI,
    displayName: "OpenAI",
    api: Provider.API.make("https://api.openai.com/v1"),
    format: "openai",
    status: "auto",
  },
  integration: openai,
  connected: true,
  active: true,
  connectionCount: 1,
  modelCount: 3,
}

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

let mounted: ByMorningClient | undefined

function mount(input: { readonly role?: "admin" | "member" } = {}) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const client = {
    ...base,
    integration: {
      ...base.integration,
      list: vi.fn().mockResolvedValue([openai, gmail, linear, exa, slack]),
      get: vi
        .fn()
        .mockImplementation(({ integrationID }) =>
          Promise.resolve([openai, gmail, linear, exa, slack].find((item) => item.id === integrationID)),
        ),
    },
    websearch: { ...base.websearch, providers: vi.fn().mockResolvedValue([{ id: "exa", name: "Exa" }]) },
    provider: { ...base.provider, list: vi.fn().mockResolvedValue([providerEntry]) },
    mcp: {
      ...base.mcp,
      servers: {
        ...base.mcp.servers,
        list: vi
          .fn()
          .mockResolvedValue([
            { name: "atlassian", url: "https://mcp.atlassian.com/v2/mcp", enabled: true, status: "connected" },
          ]),
        put: vi.fn().mockResolvedValue(undefined),
      },
    },
  } as unknown as ByMorningClient
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  mounted = client
  const current = WorkspaceAccess.Info.make({ ...workspace, role: input.role ?? "admin" })
  const history = createMemoryHistory()
  history.set({ value: `/w/${workspace.id}/mcp`, scroll: false })
  render(() => (
    <>
      <Toast.Region />
      <SDKProvider>
        <WorkspaceScope list={[current]} current={current}>
          <DialogProvider>
            <DataProvider>
              <IntegrationProvider>
                <MemoryRouter history={history}>
                  <Route path="/w/:workspaceID/mcp" component={ConnectedSection} />
                  <Route path="/w/:workspaceID/elsewhere" component={() => <p>Elsewhere</p>} />
                </MemoryRouter>
              </IntegrationProvider>
            </DataProvider>
          </DialogProvider>
        </WorkspaceScope>
      </SDKProvider>
    </>
  ))
  return { client, history }
}

it("lists only connected services, web search providers, and MCP servers, never model Providers", async () => {
  mount()
  const list = await screen.findByRole("list", { name: "Connected integrations" })
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2))
  expect(within(list).getByText("Gmail")).toBeInTheDocument()
  expect(within(list).getByText("1 connection · OAuth client configured")).toBeInTheDocument()
  expect(within(list).getByText("atlassian")).toBeInTheDocument()
  expect(within(list).getByText("Connected")).toBeInTheDocument()
  expect(within(list).getByText("Service")).toBeInTheDocument()
  expect(within(list).getByText("MCP server")).toBeInTheDocument()
  // OpenAI is a model Provider (Models page); Linear and Exa are not connected.
  expect(within(list).queryByText("OpenAI")).not.toBeInTheDocument()
  expect(within(list).queryByText("Linear")).not.toBeInTheDocument()
  expect(within(list).queryByText("Exa")).not.toBeInTheDocument()
})

it("renders when remounted with cached rows, so the initial sort already has two or more", async () => {
  const { history } = mount()
  const first = await screen.findByRole("list", { name: "Connected integrations" })
  await waitFor(() => expect(within(first).getAllByRole("listitem")).toHaveLength(2))

  // Leaving and returning remounts the section while the shared Integration and MCP data stay resolved,
  // so its `connected` memo sorts both rows during its very first computation.
  history.set({ value: `/w/${workspace.id}/elsewhere`, scroll: false })
  await screen.findByText("Elsewhere")
  history.set({ value: `/w/${workspace.id}/mcp`, scroll: false })

  const list = await screen.findByRole("list", { name: "Connected integrations" })
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2))
  expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument()
  expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("atlassian")
  expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("Gmail")
})

it("offers unconnected presets by kind and a custom MCP server from one Add integration picker", async () => {
  mount()
  await userEvent.click(await screen.findByRole("button", { name: "Add integration" }))
  const dialog = await screen.findByRole("dialog", { name: "Add integration" })
  expect(within(dialog).getByText("Linear")).toBeInTheDocument()
  expect(within(dialog).getByText("Exa")).toBeInTheDocument()
  expect(within(dialog).getByText("Web search")).toBeInTheDocument()
  expect(within(dialog).getByText("MCP server")).toBeInTheDocument()
  expect(within(dialog).getByText("Custom")).toBeInTheDocument()
  expect(within(dialog).queryByText("OpenAI")).not.toBeInTheDocument()
  expect(within(dialog).queryByText("Gmail")).not.toBeInTheDocument()
  expect(within(dialog).getByText("Slack")).toBeInTheDocument()

  await userEvent.click(within(dialog).getByText("MCP server"))
  expect(await screen.findByRole("dialog", { name: "Add MCP server" })).toBeInTheDocument()
})

it("lets a member add only integrations they may connect, not custom MCP servers", async () => {
  mount({ role: "member" })
  await userEvent.click(await screen.findByRole("button", { name: "Add integration" }))
  const dialog = await screen.findByRole("dialog", { name: "Add integration" })
  expect(within(dialog).getByText("Slack")).toBeInTheDocument()
  expect(within(dialog).queryByText("Linear")).not.toBeInTheDocument()
  expect(within(dialog).queryByText("Custom")).not.toBeInTheDocument()
})

it("adds a server whose headers ask each member for their own values, with OAuth off", async () => {
  mount()
  await userEvent.click(await screen.findByRole("button", { name: "Add integration" }))
  await userEvent.click(within(await screen.findByRole("dialog", { name: "Add integration" })).getByText("MCP server"))
  const dialog = await screen.findByRole("dialog", { name: "Add MCP server" })
  await userEvent.type(within(dialog).getByLabelText("Name"), "river")
  await userEvent.type(within(dialog).getByLabelText("URL"), "https://river.example/mcp")
  const headers = within(dialog).getByLabelText("Headers (optional)")
  await userEvent.click(headers)
  await userEvent.paste("JiraToken: ${JIRA_TOKEN}\nUserEmail: ${member.email}\nX-Team: shared")

  expect(within(dialog).getByRole("status")).toHaveTextContent("Each member will be asked for: JIRA_TOKEN")
  expect(within(dialog).getByRole("radio", { name: /OAuth/ })).toBeDisabled()
  expect(within(dialog).getByRole("radio", { name: /Member values/ })).toBeChecked()
  await userEvent.click(within(dialog).getByRole("button", { name: "Add MCP server" }))

  await waitFor(() =>
    expect(mounted?.mcp.servers.put).toHaveBeenCalledWith({
      server: "river",
      url: "https://river.example/mcp",
      headers: { JiraToken: "${JIRA_TOKEN}", UserEmail: "${member.email}", "X-Team": "shared" },
      oauth: false,
      workspace: workspace.id,
    }),
  )
})

it("refuses malformed header lines before saving", async () => {
  mount()
  await userEvent.click(await screen.findByRole("button", { name: "Add integration" }))
  await userEvent.click(within(await screen.findByRole("dialog", { name: "Add integration" })).getByText("MCP server"))
  const dialog = await screen.findByRole("dialog", { name: "Add MCP server" })
  await userEvent.type(within(dialog).getByLabelText("Name"), "river")
  await userEvent.type(within(dialog).getByLabelText("URL"), "https://river.example/mcp")
  await userEvent.click(within(dialog).getByLabelText("Headers (optional)"))
  await userEvent.paste("no colon here")
  await userEvent.click(within(dialog).getByRole("button", { name: "Add MCP server" }))
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Header line 1 must look like Name: value")
  expect(mounted?.mcp.servers.put).not.toHaveBeenCalled()
})
