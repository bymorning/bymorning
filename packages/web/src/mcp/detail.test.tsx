import {
  ByMorning,
  type ByMorningClient,
  type McpToolsListOutput,
  type PermissionToolsListOutput,
} from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createStore } from "solid-js/store"
import { afterEach, expect, it, vi } from "vitest"

import { SDKProvider } from "../context/sdk"
import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { DialogProvider } from "../context/dialog"
import { WorkspaceScope } from "../context/workspace"
import { Toast, toaster } from "../ui/components/toast"
import { renderForm as render } from "../ui/form-query.test-support"
import { MCPDetail } from "./detail"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const clipboardProperty = Object.getOwnPropertyDescriptor(navigator, "clipboard")

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  toaster.dismiss()
  if (clipboardProperty) Object.defineProperty(navigator, "clipboard", clipboardProperty)
  else Reflect.deleteProperty(navigator, "clipboard")
})

function mount(
  input: {
    readonly status?: "connected" | "needs_auth"
    readonly tools?: McpToolsListOutput
    readonly role?: "admin" | "member"
    readonly auth?: "oauth" | "values"
  } = {},
) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const client = {
    ...base,
    mcp: {
      ...base.mcp,
      servers: {
        ...base.mcp.servers,
        list: vi.fn<ByMorningClient["mcp"]["servers"]["list"]>().mockResolvedValue(
          input.status === "needs_auth"
            ? [{ name: "atlassian", url: "https://mcp.atlassian.com/v2/mcp", enabled: true, status: "needs_auth", integrationID: "mcp-atlassian", ...(input.auth ? { auth: input.auth } : {}) }]
            : [{ name: "atlassian", url: "https://mcp.atlassian.com/v2/mcp", enabled: true, status: "connected", ...(input.auth ? { auth: input.auth } : {}) }],
        ),
        members: vi.fn<ByMorningClient["mcp"]["servers"]["members"]>().mockResolvedValue([
          { userID: "usr_a", email: "ana@example.com", connected: true, updated: "2026-10-21T12:00:00.000Z" },
          { userID: "usr_b", email: "bo@example.com", connected: false },
        ]),
        update: vi.fn<ByMorningClient["mcp"]["servers"]["update"]>().mockImplementation(async (request) => ({
          name: request.server,
          url: "https://mcp.atlassian.com/v2/mcp",
          enabled: request.enabled,
          status: request.enabled ? "connected" : "disabled",
        })),
      },
      tools: {
        ...base.mcp.tools,
        list: vi.fn<ByMorningClient["mcp"]["tools"]["list"]>().mockResolvedValue(
          input.tools ?? [
            { server: "atlassian", name: "search", action: "atlassian_search", description: "Search Atlassian content" },
            { server: "other", name: "hidden", action: "other_hidden", description: "Belongs to another server" },
          ],
        ),
      },
    },
    permission: {
      ...base.permission,
      tools: {
        ...base.permission.tools,
        list: vi.fn<ByMorningClient["permission"]["tools"]["list"]>().mockResolvedValue([
          { name: "atlassian_search", action: "atlassian_search", description: "Search Atlassian content", effect: "ask" },
        ]),
        update: vi.fn<ByMorningClient["permission"]["tools"]["update"]>().mockImplementation(async (request) =>
          request.tools.map((tool) => ({ name: tool.action, action: tool.action, description: "", effect: tool.effect })),
        ),
      },
    },
  } as ByMorningClient
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  const current = WorkspaceAccess.Info.make({ ...workspace, role: input.role ?? "admin" })
  const [scope, setScope] = createStore({ current })
  const history = createMemoryHistory()
  history.set({ value: `/w/${workspace.id}/mcp/atlassian`, scroll: false })
  render(() => (
    <>
      <Toast.Region />
      <SDKProvider>
        <WorkspaceScope list={[scope.current]} current={scope.current}>
          <DialogProvider>
            <DataProvider>
              <MemoryRouter history={history}>
                <Route path="/w/:workspaceID/mcp/:server" component={MCPDetail} />
              </MemoryRouter>
            </DataProvider>
          </DialogProvider>
        </WorkspaceScope>
      </SDKProvider>
    </>
  ))
  return { client, history, setWorkspace: (next: typeof current) => setScope("current", next) }
}

it("shows and searches only the selected MCP server's discovered Tools", async () => {
  const { client, history } = mount()

  expect(await screen.findByRole("heading", { name: "Integrations atlassian" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", `/w/${workspace.id}/mcp`)
  expect(screen.getByRole("button", { name: "Actions for atlassian" })).toBeInTheDocument()
  expect(screen.getByText("Search Atlassian content")).toBeInTheDocument()
  expect(screen.queryByText("Belongs to another server")).not.toBeInTheDocument()
  expect(screen.getByText("https://mcp.atlassian.com/v2/mcp · 1 tool")).toBeInTheDocument()
  expect(client.mcp.tools.list).toHaveBeenCalledWith({ workspace: workspace.id }, expect.any(Object))

  await userEvent.type(screen.getByRole("searchbox", { name: "Search tools" }), "missing")
  expect(screen.getByText("No matching tools.")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("link", { name: "Integrations" }))
  expect(history.get()).toBe(`/w/${workspace.id}/mcp`)
})

it("explains why an unauthenticated MCP server has no discovered Tools", async () => {
  mount({ status: "needs_auth", tools: [] })

  expect(await screen.findByText("Authenticate this integration to discover its tools.")).toBeInTheDocument()
})

it("uses the shared plain empty state when a connected server has no Tools", async () => {
  mount({ tools: [] })

  const empty = await screen.findByText("No tools yet.")
  expect(empty).toHaveAttribute("data-component", "empty")
  expect(empty).toHaveAttribute("data-variant", "plain")
})

it("renders and copies the authoritative Permission ID", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  mount({
    tools: [
      {
        server: "atlassian",
        name: "getAccessibleAtlassianResources",
        action: "atlassian_getAccessibleAtlassianResources",
        description: "List accessible resources",
      },
    ],
  })

  expect(await screen.findByText("Permission ID")).toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Permission ID for getAccessibleAtlassianResources" })).toHaveValue(
    "atlassian_getAccessibleAtlassianResources",
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Copy Permission ID for getAccessibleAtlassianResources" }),
  )
  expect(writeText).toHaveBeenCalledWith("atlassian_getAccessibleAtlassianResources")
})

it("optimistically toggles activation through the shared mutation pattern without confirmation", async () => {
  const { client } = mount()
  const gate = Promise.withResolvers<Awaited<ReturnType<ByMorningClient["mcp"]["servers"]["update"]>>>()
  vi.mocked(client.mcp.servers.update).mockReturnValue(gate.promise)
  const activation = await screen.findByRole("switch", { name: "Enabled atlassian" })

  await userEvent.click(activation)

  expect(activation).not.toBeChecked()
  expect(activation).toBeEnabled()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(client.mcp.servers.update).toHaveBeenCalledTimes(1)
  expect(client.mcp.servers.update).toHaveBeenCalledWith({
    workspace: workspace.id,
    server: "atlassian",
    enabled: false,
  })

  vi.mocked(client.mcp.servers.list).mockResolvedValue([
    { name: "atlassian", url: "https://mcp.atlassian.com/v2/mcp", enabled: false, status: "disabled" },
  ])
  gate.resolve({
    name: "atlassian",
    url: "https://mcp.atlassian.com/v2/mcp",
    enabled: false,
    status: "disabled",
  })
  await waitFor(() => expect(client.mcp.servers.list).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(activation).not.toBeChecked())
})

it("rolls activation back to server state and exposes the mutation failure", async () => {
  const { client } = mount()
  const gate = Promise.withResolvers<Awaited<ReturnType<ByMorningClient["mcp"]["servers"]["update"]>>>()
  vi.mocked(client.mcp.servers.update).mockReturnValue(gate.promise)
  const activation = await screen.findByRole("switch", { name: "Enabled atlassian" })

  await userEvent.click(activation)
  expect(activation).not.toBeChecked()
  gate.reject(new Error("Activation rejected"))

  await waitFor(() => expect(activation).toBeChecked())
  expect(screen.getByRole("alert")).toHaveTextContent("Activation rejected")
})

it("serializes rapid activation intents and keeps the latest optimistic value", async () => {
  const { client } = mount()
  const first = Promise.withResolvers<Awaited<ReturnType<ByMorningClient["mcp"]["servers"]["update"]>>>()
  vi.mocked(client.mcp.servers.update)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({
      name: "atlassian",
      url: "https://mcp.atlassian.com/v2/mcp",
      enabled: true,
      status: "connected",
    })
  const activation = await screen.findByRole("switch", { name: "Enabled atlassian" })

  await userEvent.click(activation)
  await userEvent.click(activation)

  expect(activation).toBeChecked()
  expect(client.mcp.servers.update).toHaveBeenCalledTimes(1)
  first.resolve({
    name: "atlassian",
    url: "https://mcp.atlassian.com/v2/mcp",
    enabled: false,
    status: "disabled",
  })
  await waitFor(() => expect(client.mcp.servers.update).toHaveBeenCalledTimes(2))
  expect(client.mcp.servers.update).toHaveBeenNthCalledWith(2, {
    workspace: workspace.id,
    server: "atlassian",
    enabled: true,
  })
  await waitFor(() => expect(client.mcp.servers.list).toHaveBeenCalledTimes(3))
  await waitFor(() => expect(activation).toBeChecked())
})

it("keeps queued activation bound to its original workspace and suppresses stale success", async () => {
  const { client, setWorkspace } = mount()
  const first = Promise.withResolvers<Awaited<ReturnType<ByMorningClient["mcp"]["servers"]["update"]>>>()
  const second = Promise.withResolvers<Awaited<ReturnType<ByMorningClient["mcp"]["servers"]["update"]>>>()
  let secondCompleted = false
  vi.mocked(client.mcp.servers.update)
    .mockReturnValueOnce(first.promise)
    .mockImplementationOnce(() =>
      second.promise.then((result) => {
        secondCompleted = true
        return result
      }),
    )
  const activation = await screen.findByRole("switch", { name: "Enabled atlassian" })

  await userEvent.click(activation)
  await userEvent.click(activation)
  const replacement = WorkspaceAccess.Info.make({
    ...workspace,
    id: Workspace.ID.create(),
    name: "Replacement",
    role: "member",
  })
  setWorkspace(replacement)

  expect(activation).toBeChecked()
  expect(activation).toBeDisabled()
  first.resolve({
    name: "atlassian",
    url: "https://mcp.atlassian.com/v2/mcp",
    enabled: false,
    status: "disabled",
  })
  await waitFor(() => expect(client.mcp.servers.update).toHaveBeenCalledTimes(2))
  expect(client.mcp.servers.update).toHaveBeenNthCalledWith(2, {
    workspace: workspace.id,
    server: "atlassian",
    enabled: true,
  })
  second.resolve({
    name: "atlassian",
    url: "https://mcp.atlassian.com/v2/mcp",
    enabled: true,
    status: "connected",
  })
  await waitFor(() => expect(secondCompleted).toBe(true))
  await Promise.resolve()

  expect(screen.queryByText("atlassian enabled.")).not.toBeInTheDocument()
  expect(screen.queryByText("atlassian disabled.")).not.toBeInTheDocument()
  expect(client.mcp.servers.list).toHaveBeenCalledTimes(1)
})

it("optimistically updates only the selected permission and rolls it back on failure", async () => {
  const { client } = mount()
  const gate = Promise.withResolvers<PermissionToolsListOutput>()
  vi.mocked(client.permission.tools.update).mockReturnValue(gate.promise)
  const permission = await permissionTrigger("search")
  expect(permission).toHaveTextContent("Ask")

  await choosePermission(permission, "Denied")
  expect(permission).toHaveTextContent("Denied")
  expect(permission).toHaveAttribute("aria-disabled", "true")
  gate.reject(new Error("Save failed"))

  await waitFor(() => expect(permission).toHaveTextContent("Ask"))
  expect(permission).not.toHaveAttribute("aria-disabled", "true")
  expect(client.permission.tools.update).toHaveBeenCalledWith({
    workspace: workspace.id,
    tools: [{ action: "atlassian_search", effect: "deny" }],
  })
})

it("keeps the successful permission response and sends the exact action without confirmation", async () => {
  const { client } = mount()
  const gate = Promise.withResolvers<PermissionToolsListOutput>()
  vi.mocked(client.permission.tools.update).mockReturnValue(gate.promise)
  const permission = await permissionTrigger("search")

  await choosePermission(permission, "Denied")
  expect(permission).toHaveTextContent("Denied")
  expect(permission).toHaveAttribute("aria-disabled", "true")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(client.permission.tools.update).toHaveBeenCalledWith({
    workspace: workspace.id,
    tools: [{ action: "atlassian_search", effect: "deny" }],
  })

  gate.resolve([
    { name: "search", action: "atlassian_search", description: "Search Atlassian content", effect: "deny" },
  ])
  await waitFor(() => expect(permission).not.toHaveAttribute("aria-disabled", "true"))
  expect(permission).toHaveTextContent("Denied")
})

it("uses accessible read-only controls for members", async () => {
  mount({ role: "member" })

  expect(await screen.findByRole("switch", { name: "Enabled atlassian" })).toBeDisabled()
  expect(screen.queryByRole("group", { name: "Permission for search" })).not.toBeInTheDocument()
  expect(screen.getByText("Ask")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Copy Permission ID for search" })).toBeEnabled()
})

/** The shared Select names its group; the trigger inside is labelled by the current value. */
async function permissionTrigger(tool: string) {
  return within(await screen.findByRole("group", { name: `Permission for ${tool}` })).getByRole("button")
}

async function choosePermission(trigger: HTMLElement, option: "Allowed" | "Ask" | "Denied") {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole("option", { name: option }))
}

it("shows administrators which members have saved their own values, never the values", async () => {
  const { client } = mount({ auth: "values" })

  const members = await screen.findByRole("region", { name: "Members" })
  expect(await within(members).findByText("1 of 2 members have saved their own values.")).toBeInTheDocument()
  const rows = within(members).getAllByRole("listitem")
  expect(rows[0]).toHaveTextContent("ana@example.com")
  // "Values saved" says only that the member supplied values, not that the server accepts them.
  expect(rows[0]).toHaveTextContent("Values saved")
  expect(rows[0]).toHaveTextContent("Updated")
  expect(rows[1]).toHaveTextContent("bo@example.com")
  expect(rows[1]).toHaveTextContent("No values")
  expect(client.mcp.servers.members).toHaveBeenCalledWith({ server: "atlassian", workspace: workspace.id })
})

it("does not offer the member list for OAuth servers", async () => {
  const { client } = mount({ auth: "oauth" })
  await screen.findByText("Search Atlassian content")
  expect(screen.queryByRole("region", { name: "Members" })).not.toBeInTheDocument()
  expect(client.mcp.servers.members).not.toHaveBeenCalled()
})
