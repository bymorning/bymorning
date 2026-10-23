import { ByMorning, type ByMorningClient, type IntegrationInfo, type ProviderDirectoryEntry } from "@bymorning/client"
import { Credential } from "@bymorning/schema/credential"
import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import type { JSX } from "solid-js"

import { DialogProvider } from "../../context/dialog"
import { TestDataProvider as DataProvider } from "../../context/test-data-provider"
import { IntegrationProvider } from "../../context/integration"
import { SDKProvider } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { useServer } from "../../runtime/server/runtime"
import { AddProviderButton, ProviderCatalog } from "./view"
import { createProviderCatalog, type ProviderCatalog as ProviderCatalogResource } from "./model"
import { providerIcons } from "../provider-icons.generated"
import { Toast, toaster } from "../../ui/components/toast"

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
  connections: [
    { type: "credential", id: Credential.ID.make("cred_active"), label: "Production" },
    { type: "credential", id: Credential.ID.make("cred_backup"), label: "Backup" },
  ],
}
const anthropic: IntegrationInfo = {
  id: Integration.ID.make("anthropic"),
  name: "Anthropic",
  methods: [{ type: "key", label: "API key" }],
  connections: [],
}
const google: IntegrationInfo = {
  id: Integration.ID.make("google"),
  name: "Google",
  methods: [{ type: "key", label: "API key" }],
  connections: [],
}

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

it("shows connected Providers without connection counts and manages them from row actions", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const entry: ProviderDirectoryEntry = {
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
    connectionCount: 2,
    modelCount: 3,
  }
  const disconnected: ProviderDirectoryEntry = {
    info: {
      name: Provider.Anthropic,
      displayName: "Anthropic",
      api: Provider.API.make("https://api.anthropic.com/v1"),
      format: "anthropic",
      status: "auto",
    },
    integration: anthropic,
    connected: false,
    active: false,
    connectionCount: 0,
    modelCount: 2,
  }
  const connectedWithoutConnections: ProviderDirectoryEntry = {
    info: {
      name: Provider.Google,
      displayName: "Google",
      api: Provider.API.make("https://generativelanguage.googleapis.com/v1beta"),
      format: "google",
      status: "auto",
    },
    integration: google,
    connected: true,
    active: true,
    connectionCount: 0,
    modelCount: 1,
  }
  const list = vi.fn().mockResolvedValue([entry, connectedWithoutConnections, disconnected])
  const modelList = vi.fn().mockResolvedValue([])
  const connectKey = vi.fn().mockResolvedValue(undefined)
  const integrationList = vi
    .fn()
    .mockResolvedValue([
      openai,
      { id: Integration.ID.make("context7"), name: "Context7", methods: [], connections: [] },
    ])
  const client = {
    ...base,
    provider: { list },
    model: { ...base.model, list: modelList },
    integration: {
      ...base.integration,
      list: integrationList,
      get: vi
        .fn()
        .mockImplementation(({ integrationID }) =>
          Promise.resolve(integrationID === openai.id ? openai : integrationID === google.id ? google : anthropic),
        ),
      connect: { ...base.integration.connect, key: connectKey },
    },
  } as unknown as ByMorningClient
  vi.spyOn(ByMorning, "make").mockReturnValue(client)
  render(() => (
    <SDKProvider>
      <DialogProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DataProvider>
            <ProviderCatalogHarness />
          </DataProvider>
        </WorkspaceScope>
      </DialogProvider>
      <Toast.Region />
    </SDKProvider>
  ))

  const connected = await screen.findByRole("list", { name: "Providers" })
  expect(connected.querySelector(`img[src="${providerIcons.openai.url}"]`)).toBeInTheDocument()
  expect(within(connected).queryByText("Anthropic")).not.toBeInTheDocument()
  expect(screen.queryByText("Context7")).not.toBeInTheDocument()
  expect(screen.queryByText("Connected")).not.toBeInTheDocument()
  expect(screen.queryByText("Available")).not.toBeInTheDocument()
  expect(screen.queryByText(/One Integration/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Add multiple Connections/)).not.toBeInTheDocument()
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
  const header = document.querySelector('[data-slot="provider-list-header"]')!
  expect(header).toHaveTextContent("ProviderActions")
  expect(within(header as HTMLElement).getByText("Actions")).toHaveClass("sr-only")
  expect(screen.queryByText("Connections")).not.toBeInTheDocument()
  expect(screen.queryByText(/3 models/)).not.toBeInTheDocument()
  expect(screen.queryByText("1 provider")).not.toBeInTheDocument()
  const openAIRow = screen.getByText("OpenAI", { selector: "strong" }).closest("li") as HTMLElement
  expect(within(openAIRow).getByRole("switch", { name: "Enabled OpenAI" })).toBeChecked()
  expect(openAIRow.querySelector('[data-slot="switch-label"]')).toHaveClass("sr-only")
  expect(within(openAIRow).queryByText("Automatic · Active")).not.toBeInTheDocument()
  expect(list).toHaveBeenCalledWith({ workspace: workspace.id }, expect.anything())
  expect(integrationList).not.toHaveBeenCalled()

  expect(document.querySelector('[data-slot="provider-connection-count"]')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Actions for OpenAI" }))
  await userEvent.click(
    screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Manage connections")!,
  )
  expect(await screen.findByText("Production")).toBeInTheDocument()
  expect(screen.getByText("Backup")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(document.querySelector("[data-dialog-layer]")).not.toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: "Actions for Google" }))
  await userEvent.click(
    screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Manage connections")!,
  )
  expect(await screen.findByRole("button", { name: "Add connection" })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(document.querySelector("[data-dialog-layer]")).not.toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: "Actions for OpenAI" }))
  await userEvent.click(
    screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Manage connections")!,
  )
  expect(await screen.findByText("Production")).toBeInTheDocument()
  expect(integrationList).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(document.querySelector("[data-dialog-layer]")).not.toBeInTheDocument())

  const add = screen.getByRole("button", { name: "Add provider" })
  add.focus()
  await userEvent.keyboard("{Enter}")
  const directory = await screen.findByRole("dialog", { name: "Add provider" })
  expect(screen.getByRole("combobox", { name: "Search providers" })).toHaveFocus()
  expect(screen.getByRole("option", { name: "Anthropic" })).toHaveTextContent("2 models")
  expect(screen.getByRole("option", { name: "Anthropic" })).not.toHaveTextContent("Not connected")
  expect(screen.queryByText("Connect a provider to register its models with this workspace.")).not.toBeInTheDocument()
  expect(within(directory).getByRole("option", { name: "OpenAI" })).toHaveTextContent("Connected · 3 models")
  expect(
    within(directory).getByRole("option", { name: "OpenAI" }).querySelector(`img[src="${providerIcons.openai.url}"]`),
  ).toBeInTheDocument()
  expect(within(directory).getByRole("option", { name: "Google" })).toHaveTextContent("Connected · 1 model")
  await userEvent.type(screen.getByRole("combobox", { name: "Search providers" }), "missing")
  expect(screen.getByText("No providers match your search.")).toBeInTheDocument()
  await userEvent.clear(screen.getByRole("combobox", { name: "Search providers" }))
  await userEvent.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add provider" })).not.toBeInTheDocument())
  expect(add).toHaveFocus()
  await userEvent.click(add)
  expect(screen.getByRole("combobox", { name: "Search providers" })).toHaveFocus()
  await userEvent.click(screen.getByRole("option", { name: "OpenAI" }))
  expect(await screen.findByText("Production")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => expect(document.querySelector("[data-dialog-layer]")).not.toBeInTheDocument())
  await userEvent.click(add)
  await userEvent.click(screen.getByRole("option", { name: "Anthropic" }))
  expect(await screen.findByRole("heading", { name: "Connect Anthropic" })).toBeInTheDocument()
  expect(screen.queryByRole("combobox", { name: "Connection access" })).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Label/)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText("API key")).toHaveFocus())
  await userEvent.type(screen.getByLabelText("API key"), "secret")
  await userEvent.click(screen.getByRole("button", { name: "Connect" }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  expect(modelList).toHaveBeenCalled()
  expect(connectKey).toHaveBeenCalledWith({
    scope: "workspace",
    integrationID: anthropic.id,
    key: "secret",
    workspace: workspace.id,
  })
})

it("shows the provider empty state with its primary action", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    provider: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as ByMorningClient)

  render(() => (
    <SDKProvider>
      <DialogProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DataProvider>
            <ProviderCatalogHarness />
          </DataProvider>
        </WorkspaceScope>
      </DialogProvider>
    </SDKProvider>
  ))

  expect(await screen.findByText("No providers activated.")).toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: "Add provider" })).toHaveLength(2)
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

it("treats idle and initial loading as loading and focuses directory search", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const list = vi.fn(() => new Promise<Array<ProviderDirectoryEntry>>(() => undefined))
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, provider: { list } } as unknown as ByMorningClient)
  renderProviderCatalog()

  expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Loading providers…")
  await userEvent.click(screen.getByRole("button", { name: "Add provider" }))
  expect(screen.getByRole("combobox", { name: "Search providers" })).toHaveFocus()
  expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("Loading providers…")
})

it("confirms only the latest provider intent after serialized server mutations succeed", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  let entry = providerEntry(0, true)
  const list = vi.fn().mockImplementation(() => Promise.resolve([entry]))
  const update = vi
    .fn()
    .mockImplementationOnce(async () => {
      await first.promise
      entry = { ...entry, active: false }
    })
    .mockImplementationOnce(async () => {
      await second.promise
      entry = { ...entry, active: true }
    })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    provider: { list, update },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
  } as unknown as ByMorningClient)
  renderProviderCatalog()

  const name = entry.info.displayName!
  const activation = await screen.findByRole("switch", { name: `Enabled ${name}` })
  await userEvent.click(activation)
  expect(update).toHaveBeenCalledWith({ workspace: workspace.id, provider: entry.info.name, status: "disabled" })
  expect(screen.queryByText(`${name} provider disabled`)).not.toBeInTheDocument()
  await userEvent.click(activation)
  expect(activation).toBeChecked()
  expect(update).toHaveBeenCalledTimes(1)

  first.resolve()
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update).toHaveBeenLastCalledWith({ workspace: workspace.id, provider: entry.info.name, status: "enabled" })
  expect(screen.queryByText(`${name} provider disabled`)).not.toBeInTheDocument()

  second.resolve()
  expect(await screen.findByText(`${name} provider enabled`)).toBeInTheDocument()
  expect(activation).toBeChecked()
})

it("shows the provider error message and retries from the directory", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const list = vi.fn().mockRejectedValueOnce(new Error("Provider service unavailable")).mockResolvedValue([])
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, provider: { list } } as unknown as ByMorningClient)
  renderProviderCatalog()

  expect(await screen.findByText("Provider service unavailable")).toBeInTheDocument()
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole("button", { name: "Add provider" })[0]!)
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
  expect(await within(dialog).findByText("No providers are available.")).toBeInTheDocument()
  fireEvent.click(screen.getByText("Try loading providers again"))
  expect(await within(dialog).findByText("No providers are available.")).toBeInTheDocument()
  expect(list).toHaveBeenCalledTimes(2)
})

it("preserves populated provider entries during refresh errors", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const entries = [providerEntry(0, true), providerEntry(1, false)]
  const list = vi.fn().mockResolvedValueOnce(entries).mockRejectedValueOnce(new Error("Refresh unavailable"))
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, provider: { list } } as unknown as ByMorningClient)
  renderProviderCatalog(providerRefreshFixture)

  expect(
    (await screen.findByText("Provider 0 with an intentionally long name", { selector: "strong" })).closest("li"),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Refresh fixture" }))
  expect(await screen.findByText("Refresh unavailable")).toBeInTheDocument()
  expect(
    screen.getByText("Provider 0 with an intentionally long name", { selector: "strong" }).closest("li"),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Add provider" }))
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
  expect(within(dialog).getByRole("option", { name: /Provider 1/ })).toBeInTheDocument()
})

it("keeps a successful empty directory visible while refreshing", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const list = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockImplementation(() => new Promise(() => undefined))
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, provider: { list } } as unknown as ByMorningClient)
  renderProviderCatalog(providerRefreshFixture)

  expect(await screen.findByText("No providers activated.")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Refresh fixture" }))
  expect(screen.getByText("No providers activated.")).toBeInTheDocument()
  expect(screen.queryByText("Refreshing providers…")).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole("button", { name: "Add provider" })[0]!)
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).queryByText("Refreshing providers…")).not.toBeInTheDocument()
  expect(within(dialog).getByText("No providers are available.")).toBeInTheDocument()
})

it("keeps a successful empty directory visible after a stale refresh error", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const list = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Empty refresh unavailable"))
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, provider: { list } } as unknown as ByMorningClient)
  renderProviderCatalog(providerRefreshFixture)

  expect(await screen.findByText("No providers activated.")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Refresh fixture" }))
  expect(await screen.findByText("Empty refresh unavailable")).toBeInTheDocument()
  expect(screen.getByText("No providers activated.")).toBeInTheDocument()
  await userEvent.click(screen.getAllByRole("button", { name: "Add provider" })[0]!)
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
  expect(within(dialog).getByText("No providers are available.")).toBeInTheDocument()
})

it("filters a long provider command list and selects it from the keyboard", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const entries = Array.from({ length: 24 }, (_, index) => providerEntry(index, index === 0))
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    provider: { list: vi.fn().mockResolvedValue(entries) },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
    integration: {
      ...base.integration,
      get: vi.fn(({ integrationID }) =>
        Promise.resolve(entries.find((entry) => entry.integration?.id === integrationID)?.integration),
      ),
    },
  } as unknown as ByMorningClient)
  renderProviderCatalog()

  await screen.findByText("Provider 0 with an intentionally long name", { selector: "strong" })
  await userEvent.click(screen.getByRole("button", { name: "Add provider" }))
  const search = screen.getByRole("combobox", { name: "Search providers" })
  expect(screen.getAllByRole("option")).toHaveLength(24)
  const last = screen.getByRole("option", { name: "Provider 23 with an intentionally long name" })
  expect(last).toHaveAttribute("aria-selected", "false")
  expect(last.querySelector('[data-provider-icon-kind="generic"]')).toHaveAttribute("aria-hidden", "true")
  await userEvent.type(search, "Provider 23")
  expect(screen.getByRole("option", { name: "Provider 23 with an intentionally long name" })).toHaveTextContent(
    "23 models",
  )
  await userEvent.keyboard("{Enter}")
  expect(
    await screen.findByRole("heading", { name: "Connect Provider 23 with an intentionally long name" }),
  ).toBeInTheDocument()
})

it("hides source-only providers from interactive connection", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const source = providerEntry(0, false)
  const sourceOnly: ProviderDirectoryEntry = {
    info: source.info,
    connected: source.connected,
    active: source.active,
    connectionCount: source.connectionCount,
    modelCount: source.modelCount,
  }
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    provider: { list: vi.fn().mockResolvedValue([sourceOnly]) },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
  } as unknown as ByMorningClient)
  renderProviderCatalog()

  await userEvent.click(screen.getByRole("button", { name: "Add provider" }))
  const directory = await screen.findByRole("dialog", { name: "Add provider" })
  expect(within(directory).queryByRole("option", { name: sourceOnly.info.displayName! })).not.toBeInTheDocument()
  expect(within(directory).getByText("No providers are available.")).toBeInTheDocument()
})

it("offers Bedrock connection methods and deployment activation directly", async () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const update = vi.fn().mockResolvedValue(undefined)
  const bedrockEntry: ProviderDirectoryEntry = {
    info: {
      name: Provider.AmazonBedrock,
      displayName: "Amazon Bedrock",
      api: Provider.API.make("https://bedrock-runtime.us-east-1.amazonaws.com"),
      format: "bedrock-converse",
      status: "auto",
    },
    integration: {
      id: Integration.ID.make("amazon-bedrock"),
      name: "Amazon Bedrock",
      methods: [
        {
          type: "key",
          label: "Bedrock API key",
          form: [{ key: "region", type: "string", title: "AWS region", required: true, default: "us-east-1" }],
        },
        {
          id: Integration.MethodID.make("sigv4"),
          type: "aws-sigv4",
          label: "AWS credentials",
          region: { key: "region", type: "string", title: "AWS region", required: true, default: "us-east-1" },
        },
      ],
      connections: [],
    },
    connected: false,
    active: false,
    connectionCount: 0,
    modelCount: 10,
  }
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    provider: { list: vi.fn().mockResolvedValue([bedrockEntry]), update },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
    integration: {
      ...base.integration,
      get: vi.fn().mockResolvedValue(bedrockEntry.integration),
    },
  } as unknown as ByMorningClient)
  renderProviderCatalog()

  await userEvent.click(screen.getByRole("button", { name: "Add provider" }))
  await userEvent.click(await screen.findByRole("option", { name: "Amazon Bedrock" }))

  expect(await screen.findByRole("button", { name: "Bedrock API key" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "AWS credentials" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Use deployment AWS credentials" })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Use deployment AWS credentials" }))
  expect(update).toHaveBeenCalledWith({
    workspace: workspace.id,
    provider: Provider.AmazonBedrock,
    status: "enabled",
  })
  await userEvent.click(screen.getByRole("button", { name: "AWS credentials" }))
  expect(await screen.findByLabelText("AWS access key ID")).toBeRequired()
  expect(screen.getByLabelText("AWS secret access key")).toBeRequired()
  expect(screen.getByLabelText(/AWS session token/)).not.toBeRequired()
  expect(screen.getByLabelText("AWS region")).toHaveValue("us-east-1")
  expect(screen.queryByRole("combobox", { name: "Connection access" })).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Label/)).not.toBeInTheDocument()
})

function ProviderCatalogHarness(props: {
  readonly fixture?: ((catalog: ProviderCatalogResource) => JSX.Element) | undefined
}): JSX.Element {
  const server = useServer()
  const catalog = createProviderCatalog({
    api: server.scope.api,
    workspace: workspace.id,
    signal: new AbortController().signal,
  })
  return (
    <IntegrationProvider>
      <ProviderCatalog catalog={catalog} />
      {props.fixture?.(catalog)}
    </IntegrationProvider>
  )
}

function renderProviderCatalog(fixture?: (catalog: ProviderCatalogResource) => JSX.Element) {
  render(() => (
    <SDKProvider>
      <DialogProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DataProvider>
            <ProviderCatalogHarness fixture={fixture} />
          </DataProvider>
        </WorkspaceScope>
      </DialogProvider>
      <Toast.Region />
    </SDKProvider>
  ))
}

function providerRefreshFixture(catalog: ProviderCatalogResource) {
  return (
    <button
      type="button"
      onClick={() => {
        catalog.invalidate()
        void catalog.sync().catch(() => undefined)
      }}
    >
      Refresh fixture
    </button>
  )
}

function providerEntry(index: number, connected: boolean): ProviderDirectoryEntry {
  const name = Provider.Name.make(`provider-${index}`)
  const displayName = `Provider ${index} with an intentionally long name`
  return {
    info: {
      name,
      displayName,
      api: Provider.API.make(`https://provider-${index}.example.com`),
      format: "openai",
      status: "auto",
    },
    integration: {
      id: Integration.ID.make(name),
      name: displayName,
      methods: [{ type: "key", label: "API key" }],
      connections: [],
    },
    active: connected,
    connected,
    connectionCount: connected ? 1 : 0,
    modelCount: index,
  }
}
