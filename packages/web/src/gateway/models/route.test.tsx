import {
  ByMorning,
  type ByMorningClient,
  type ModelListOutput,
  type ProviderDirectoryEntry,
  type WorkspaceEventItem,
} from "@bymorning/client"
import { Event } from "@bymorning/schema/event"
import { Integration } from "@bymorning/schema/integration"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../../ui/form-query.test-support"
import { MemoryRouter, Route } from "@solidjs/router"
import { createSignal } from "solid-js"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useData, type Data } from "../../context/data"
import { TestDataProvider as DataProvider } from "../../context/test-data-provider"
import { DialogProvider } from "../../context/dialog"
import { IntegrationProvider } from "../../context/integration"
import { SDKProvider } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { WorkspaceEventProvider } from "../../test/workspace-event"
import { Toast, toaster } from "../../ui/components/toast"
import { providerIcons } from "../../integration/provider-icons.generated"
import { GatewayModelsPage } from "./view"
import { GatewayModelsRoute } from "./route"

afterEach(() => {
  cleanup()
  toaster.dismiss()
})

const providers = [
  provider(Provider.OpenAI, "OpenAI", 0),
  provider(Provider.Anthropic, "Anthropic", 1),
  provider(Provider.Fireworks, "Fireworks", 2),
]
const models = [
  model(Provider.OpenAI, "gpt-5", "GPT-5"),
  model(Provider.Anthropic, "claude-4", "Claude 4"),
  model(Provider.Fireworks, "deepseek-v4", "DeepSeek V4"),
  model(Provider.Fireworks, "qwen-4", "Qwen 4"),
]

describe("Gateway models", () => {
  it("toggles inference access with Enable as the only model switch", async () => {
    const older = model(Provider.OpenAI, "older-supported", "Older supported model")
    const { modelToggle } = installClient({
      providerEntries: [provider(Provider.OpenAI, "OpenAI", 1)],
      modelEntries: [older],
    })
    let data!: Data
    const Page = () => {
      data = useData()
      return <GatewayModelsRoute />
    }
    renderApp(() => (
      <MemoryRouter>
        <Route path="/" component={Page} />
      </MemoryRouter>
    ))
    const enable = await screen.findByRole("switch", { name: "Enabled Older supported model" })
    expect(enable).toBeChecked()
    expect(screen.queryByRole("switch", { name: /in picker/i })).not.toBeInTheDocument()
    expect(modelToggle).not.toHaveBeenCalled()
    await userEvent.click(enable)
    expect(modelToggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: older.info.id, enabled: false }),
      expect.anything(),
    )
    await waitFor(() => expect(data.workspace.model.rows()).toEqual([expect.objectContaining({ enabled: false })]))
    expect(screen.getByRole("switch", { name: "Enabled Older supported model" })).not.toBeChecked()
  })

  it("keeps model toggles interactive and rolls the latest failed intent back to server state", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const initial = model(Provider.OpenAI, "rapid", "Rapid model")
    const [items, setItems] = createSignal<ModelListOutput>([initial])
    const toggle = vi
      .fn<(item: ModelListOutput[number], enabled: boolean) => Promise<unknown>>()
      .mockImplementationOnce(async (item, enabled) => {
        await first.promise
        setItems([{ ...item, enabled }])
      })
      .mockImplementationOnce(() => second.promise)
    render(() => (
      <GatewayModelsPage
        items={items}
        state={() => ({ state: "ready" })}
        providerEntries={() => providers}
        onRetry={async () => undefined}
        onToggle={toggle}
      />
    ))

    const enable = screen.getByRole("switch", { name: "Enabled Rapid model" })
    await userEvent.click(enable)
    expect(enable).not.toBeChecked()
    expect(enable).toBeEnabled()
    await userEvent.click(enable)
    expect(enable).toBeChecked()
    expect(toggle).toHaveBeenCalledTimes(1)

    first.resolve()
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(2))
    second.reject(new Error("Rejected"))
    await waitFor(() => expect(enable).not.toBeChecked())
    expect(screen.getByRole("alert")).toHaveTextContent("Rejected")
  })

  it("toasts only the latest successful model toggle intent after it is confirmed", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const initial = model(Provider.OpenAI, "rapid-success", "Rapid success model")
    const [items, setItems] = createSignal<ModelListOutput>([initial])
    const toggle = vi
      .fn<(item: ModelListOutput[number], enabled: boolean) => Promise<unknown>>()
      .mockImplementationOnce(async (item, enabled) => {
        await first.promise
        setItems([{ ...item, enabled }])
      })
      .mockImplementationOnce(async (item, enabled) => {
        await second.promise
        setItems([{ ...item, enabled }])
      })
    render(() => (
      <>
        <Toast.Region />
        <GatewayModelsPage
          items={items}
          state={() => ({ state: "ready" })}
          providerEntries={() => providers}
          onRetry={async () => undefined}
          onToggle={toggle}
        />
      </>
    ))

    const enable = screen.getByRole("switch", { name: "Enabled Rapid success model" })
    await userEvent.click(enable)
    expect(screen.queryByText("Rapid success model disabled.")).not.toBeInTheDocument()
    await userEvent.click(enable)
    first.resolve()
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(2))
    expect(screen.queryByText("Rapid success model disabled.")).not.toBeInTheDocument()
    second.resolve()

    expect(await screen.findByText("Rapid success model enabled.")).toBeInTheDocument()
    expect(screen.getAllByText("Rapid success model enabled.")).toHaveLength(1)
  })

  it("offers model activation from the shared row action menu", async () => {
    const toggle = vi.fn().mockResolvedValue(undefined)
    renderPage({ items: [model(Provider.OpenAI, "menu-model", "Menu model")], providers, toggle })

    await userEvent.click(screen.getByRole("button", { name: "Actions for Menu model" }))
    await userEvent.click(menuItem("Disable")!)

    expect(toggle).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.objectContaining({ id: "menu-model" }) }),
      false,
    )
  })

  it("disables the toggle for the default model and warns instead of erroring on attempted disable", async () => {
    const toggle = vi.fn().mockResolvedValue(undefined)
    const defaultModel = model(Provider.OpenAI, "current-default", "Current default")
    defaultModel.isPreferredDefault = true
    defaultModel.isEffectiveDefault = true
    renderPage({ items: [defaultModel], providers, toggle })

    const switchControl = screen.getByRole("switch", { name: "Enabled Current default" })
    expect(switchControl).toBeChecked()
    expect(switchControl).toBeDisabled()

    const trigger = switchControl.closest('[data-component="tooltip-trigger"]')!
    await userEvent.hover(trigger)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Current default is the default model. Choose a new default before disabling it.",
    )
    await userEvent.unhover(trigger)

    await userEvent.click(switchControl, { pointerEventsCheck: 0 })
    expect(toggle).not.toHaveBeenCalled()
    expect(switchControl).toBeChecked()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Actions for Current default" }))
    const disableItem = menuItem("Disable")!
    expect(disableItem).toHaveAttribute("data-disabled")
    await userEvent.click(disableItem, { pointerEventsCheck: 0 })
    expect(toggle).not.toHaveBeenCalled()
  })

  it("shows a plain enable/disable tooltip for a non-default model", async () => {
    renderPage({ items: [model(Provider.OpenAI, "plain-model", "Plain model")], providers })
    const switchControl = screen.getByRole("switch", { name: "Enabled Plain model" })
    expect(switchControl).not.toBeDisabled()

    await userEvent.hover(switchControl.closest('[data-component="tooltip-trigger"]')!)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Disable Plain model")
  })

  it("sets an available model as the workspace default from the row action menu and tags it", async () => {
    const initial = model(Provider.OpenAI, "default-candidate", "Default candidate")
    const [items, setItems] = createSignal<ModelListOutput>([initial])
    const setDefault = vi.fn(async (item: ModelListOutput[number]) => {
      setItems([{ ...item, isPreferredDefault: true, isEffectiveDefault: true }])
    })
    render(() => (
      <GatewayModelsPage
        items={items}
        state={() => ({ state: "ready" })}
        providerEntries={() => providers}
        onRetry={async () => undefined}
        onToggle={async () => undefined}
        onSetDefault={setDefault}
      />
    ))

    expect(screen.queryByText("Default")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Actions for Default candidate" }))
    await userEvent.click(menuItem("Set as default")!)

    expect(setDefault).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.objectContaining({ id: "default-candidate" }) }),
    )
    expect(await screen.findByText("Default")).toBeInTheDocument()
  })

  it("disables setting a disabled or unavailable model as the default without calling the server", async () => {
    const setDefault = vi.fn().mockResolvedValue(undefined)
    const disabledModel = { ...model(Provider.OpenAI, "disabled-model", "Disabled model"), enabled: false }
    const unavailableModel = model(Provider.OpenAI, "unavailable-model", "Unavailable model")
    unavailableModel.unavailableReason = "region-unsupported"
    renderPage({ items: [disabledModel, unavailableModel], providers, setDefault })

    await userEvent.click(screen.getByRole("button", { name: "Actions for Disabled model" }))
    const disabledItem = menuItem("Set as default")!
    expect(disabledItem).toHaveAttribute("data-disabled")
    expect(screen.getByText("Enable the model first to set it as the default.")).toBeInTheDocument()
    await userEvent.click(disabledItem)
    await userEvent.keyboard("{Escape}")

    await userEvent.click(screen.getByRole("button", { name: "Actions for Unavailable model" }))
    const unavailableItem = menuItem("Set as default")!
    expect(unavailableItem).toHaveAttribute("data-disabled")
    await userEvent.click(unavailableItem)

    expect(setDefault).not.toHaveBeenCalled()
  })

  it("rolls an optimistic default tag back and surfaces the error when setting the default fails", async () => {
    const attempt = Promise.withResolvers<void>()
    const setDefault = vi.fn(() => attempt.promise)
    renderPage({ items: [model(Provider.OpenAI, "flaky-default", "Flaky default")], providers, setDefault })

    await userEvent.click(screen.getByRole("button", { name: "Actions for Flaky default" }))
    await userEvent.click(menuItem("Set as default")!)

    expect(await screen.findByText("Default")).toBeInTheDocument()
    attempt.reject(new Error("Model unavailable"))
    await waitFor(() => expect(screen.queryByText("Default")).not.toBeInTheDocument())
    expect(screen.getByText("Could not set Flaky default as the default model: Model unavailable")).toBeInTheDocument()
  })

  it("omits the default action from the row menu when the route provides no default handler", async () => {
    renderPage({ items: [model(Provider.OpenAI, "no-handler", "No handler")], providers })

    await userEvent.click(screen.getByRole("button", { name: "Actions for No handler" }))
    expect(menuItem("Set as default")).toBeUndefined()
  })

  it("wires the default action to the SDK from the route and refreshes management flags", async () => {
    const preferred = model(Provider.OpenAI, "gpt-5", "GPT-5")
    const other = model(Provider.Anthropic, "claude-4", "Claude 4")
    const { modelDefault } = installClient({ providerEntries: providers, modelEntries: [preferred, other] })
    renderApp(() => (
      <MemoryRouter>
        <Route path="/" component={GatewayModelsRoute} />
      </MemoryRouter>
    ))

    await userEvent.click(await screen.findByRole("button", { name: "Actions for GPT-5" }))
    await userEvent.click(menuItem("Set as default")!)

    await waitFor(() =>
      expect(modelDefault).toHaveBeenCalledWith(
        expect.objectContaining({ provider: Provider.OpenAI, id: "gpt-5" }),
        expect.anything(),
      ),
    )
    expect(await screen.findByText("Default")).toBeInTheDocument()
  })

  it("puts the workspace default model at the top of the list regardless of input order", () => {
    const isDefault = model(Provider.Fireworks, "deepseek-v4", "DeepSeek V4")
    isDefault.isPreferredDefault = true
    isDefault.isEffectiveDefault = true
    renderPage({ items: [models[0]!, models[1]!, isDefault, models[3]!], providers })

    expect(
      Array.from(document.querySelectorAll('[data-slot="model-list"] strong')).map((element) => element.textContent),
    ).toEqual(["DeepSeek V4", "GPT-5", "Claude 4", "Qwen 4"])
  })

  it("shows precise USD-per-million pricing without features, a caption, or a visible toggle label", () => {
    const priced = model(Provider.OpenAI, "priced", "Priced")
    priced.info.cost = { input: 0.028, output: 1.25, cache: { read: 0.0035, write: 0 } }
    renderPage({ items: [priced], providers })

    expect(screen.getByRole("list", { name: "Workspace models" })).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
    expect(screen.queryByText("Prices in USD per 1M tokens")).not.toBeInTheDocument()
    expect(screen.getByRole("term", { name: "Input price, USD per 1M tokens" })).toBeInTheDocument()
    expect(screen.getByRole("term", { name: "Output price, USD per 1M tokens" })).toBeInTheDocument()
    expect(screen.getByRole("term", { name: "Cache read price, USD per 1M tokens" })).toBeInTheDocument()
    expect(screen.getByRole("term", { name: "Cache write price, USD per 1M tokens" })).toBeInTheDocument()
    expect(screen.getAllByRole("definition").map((definition) => definition.textContent)).toEqual([
      "$0.028",
      "$1.25",
      "$0.0035",
      "$0.00",
    ])
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument()
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument()
    expect(screen.queryByText("Features")).not.toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(screen.queryByText(/connections/i)).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="model-list-header"]')).toHaveTextContent(
      "ModelInputOutputCache ReadCache Write",
    )
    expect(document.querySelector('[data-slot="model-enabled"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="model-actions"] [data-component="switch"]')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="model-actions"] [data-slot="switch-label"]')).toHaveClass("sr-only")
    expect(screen.getByRole("button", { name: "Actions for Priced" })).toBeInTheDocument()
    expect(screen.queryByText("Provider")).not.toBeInTheDocument()
  })

  it("does not round a known tiny price to zero or turn an unknown price into free", () => {
    const priced = model(Provider.OpenAI, "tiny", "Tiny")
    priced.info.cost = { input: 1e-23, cache: {} }
    renderPage({ items: [priced], providers })

    expect(screen.getByRole("term", { name: "Input price, USD per 1M tokens" }).nextElementSibling).toHaveTextContent(
      "$1.00e-23",
    )
    expect(screen.getAllByText("—")).toHaveLength(3)
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument()
  })

  it("explains an empty search and clears both the search text and provider filter", async () => {
    renderPage({ items: models, providers })
    await chooseFilter("Anthropic")
    await userEvent.type(screen.getByRole("searchbox", { name: "Search models" }), "zzz")
    expect(screen.getByText('No models match "zzz".')).toBeInTheDocument()
    expect(screen.queryByText("No models match this provider.")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }))
    expect(screen.getByRole("searchbox", { name: "Search models" })).toHaveValue("")
    expect(screen.getByText("GPT-5", { selector: "strong" })).toBeInTheDocument()
  })

  it("filters by stable provider ID and clears no-match state", async () => {
    const toggle = vi.fn().mockResolvedValue(undefined)
    renderPage({ items: models, providers, toggle })
    await userEvent.click(screen.getByRole("button", { name: "All providers" }))
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All providers",
      "Anthropic",
      "Fireworks",
      "OpenAI",
    ])
    await chooseFilter("Anthropic")
    expect(screen.getByText("Claude 4", { selector: "strong" })).toBeInTheDocument()
    expect(screen.queryByText("GPT-5")).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("switch", { name: "Enabled Claude 4" }))
    expect(toggle).toHaveBeenCalledTimes(1)
    cleanup()
    const [reactiveModels, setReactiveModels] = createSignal<ModelListOutput>(models)
    render(() => (
      <GatewayModelsPage
        items={reactiveModels}
        state={() => ({ state: "ready" })}
        providerEntries={() => providers}
        onRetry={async () => undefined}
        onToggle={async () => undefined}
      />
    ))
    await chooseFilter("Anthropic")
    setReactiveModels(models.filter((item) => item.info.provider !== Provider.Anthropic))
    expect(screen.getByText("No models match this provider.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(screen.getByText("GPT-5", { selector: "strong" })).toBeInTheDocument()
  })

  it("toasts load failures with a retry action and shows the empty state", async () => {
    const onRetry = vi.fn(async () => undefined)
    const [state, setState] = createSignal<{ readonly state: string; readonly message?: string }>({ state: "ready" })
    render(() => (
      <>
        <Toast.Region />
        <GatewayModelsPage items={() => []} state={state} onRetry={onRetry} onToggle={async () => undefined} />
      </>
    ))
    setState({ state: "error", message: "Models offline" })

    expect(await screen.findByText("Models offline")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Connect provider" })).toBeInTheDocument()
  })

  it("marks tiered base prices", () => {
    const tiered = model(Provider.OpenAI, "tiered", "Tiered")
    tiered.info.cost.tiers = [
      { input: 2, output: 3, cache: { read: 1, write: 1 }, tier: { type: "context", size: 200_000 } },
    ]
    renderPage({ items: [tiered], providers })
    expect(screen.getAllByLabelText("Base price; tiered pricing may apply")).toHaveLength(4)
  })

  it("shows bounded Bedrock availability reasons and unknown optional values", () => {
    const transport = model(Provider.Name.make("amazon-bedrock"), "transport", "Transport candidate")
    transport.unavailableReason = "transport-unsupported"
    transport.info.cost = { cache: {} }
    transport.info.limit = { context: 200_000 }
    const regional = model(Provider.Name.make("amazon-bedrock"), "regional", "Regional model")
    regional.unavailableReason = "region-unsupported"
    renderPage({ items: [transport, regional], providers })

    expect(screen.getByText("Unavailable: transport is not supported.")).toBeInTheDocument()
    expect(screen.getByText("Unavailable in the active AWS region.")).toBeInTheDocument()
    expect(screen.getAllByText("—")).toHaveLength(4)
    expect(screen.getByRole("button", { name: "Actions for Transport candidate" })).toBeInTheDocument()
  })

  it("syncs models and the provider directory once when the route and ProviderCatalog share the data owner", async () => {
    const { providerList, modelList } = installClient({ providerEntries: providers, modelEntries: models })
    renderApp(() => (
      <MemoryRouter>
        <Route path="/" component={GatewayModelsRoute} />
      </MemoryRouter>
    ))

    expect(await screen.findByText("GPT-5", { selector: "strong" })).toBeInTheDocument()
    await waitFor(() => expect(providerList).toHaveBeenCalledTimes(1))
    expect(modelList).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole("tab", { name: "Providers" }))
    expect(await screen.findByRole("region", { name: "Providers" })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="workspace-page-actions"]')).toHaveTextContent("Add provider")
    expect(screen.getByRole("button", { name: "Add provider" })).toBeInTheDocument()
    expect(
      Array.from(document.querySelectorAll('[data-slot="provider-icon"] img')).map((icon) => icon.getAttribute("src")),
    ).toEqual([providerIcons.anthropic.url, providerIcons.fireworks.url])
    expect(providerList).toHaveBeenCalledTimes(1)
    expect(modelList).toHaveBeenCalledTimes(1)
  })

  it("uses the model switch pattern for provider activation without redundant state text", async () => {
    const automatic = provider(Provider.Anthropic, "Anthropic", 1)
    const { providerUpdate } = installClient({ providerEntries: [automatic], modelEntries: [] })
    renderApp(() => (
      <MemoryRouter>
        <Route path="/" component={GatewayModelsRoute} />
      </MemoryRouter>
    ))

    await userEvent.click(await screen.findByRole("tab", { name: "Providers" }))
    const enable = await screen.findByRole("switch", { name: "Enabled Anthropic" })
    expect(enable).toBeChecked()
    expect(document.querySelector('[data-slot="provider-list-header"]')).toHaveTextContent("ProviderActions")
    expect(screen.queryByText("Automatic · Active")).not.toBeInTheDocument()

    await userEvent.click(enable)
    expect(providerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: Provider.Anthropic, status: "disabled" }),
    )
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enabled Anthropic" })).not.toBeChecked())
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument()
  })

  it("keeps provider toggles interactive and reconciles a failed newer intent", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const providerWrite = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    installClient({
      providerEntries: [provider(Provider.Anthropic, "Anthropic", 1)],
      modelEntries: [],
      providerWrite,
    })
    renderApp(() => (
      <MemoryRouter>
        <Route path="/" component={GatewayModelsRoute} />
      </MemoryRouter>
    ))

    await userEvent.click(await screen.findByRole("tab", { name: "Providers" }))
    const enable = await screen.findByRole("switch", { name: "Enabled Anthropic" })
    await userEvent.click(enable)
    expect(enable).not.toBeChecked()
    expect(enable).toBeEnabled()
    await userEvent.click(enable)
    expect(enable).toBeChecked()
    expect(providerWrite).toHaveBeenCalledTimes(1)

    first.resolve()
    await waitFor(() => expect(providerWrite).toHaveBeenCalledTimes(2))
    second.reject(new Error("Rejected"))
    await waitFor(() => expect(enable).not.toBeChecked())
  })

  it("bounds provider and model reads across route updates and Workspace events", async () => {
    const events = eventStream()
    const providerRefresh = Promise.withResolvers<void>()
    const modelRefresh = Promise.withResolvers<void>()
    const [revision, setRevision] = createSignal(0)
    const { providerList, modelList } = installClient({
      providerEntries: providers,
      modelEntries: models,
      events,
      blockSecondRead: { provider: providerRefresh.promise, model: modelRefresh.promise },
    })
    renderApp(
      () => (
        <div data-revision={revision()}>
          <MemoryRouter>
            <Route path="/" component={GatewayModelsRoute} />
          </MemoryRouter>
        </div>
      ),
      true,
    )

    expect(await screen.findByText("GPT-5", { selector: "strong" })).toBeInTheDocument()
    await waitFor(() => expect(providerList).toHaveBeenCalledTimes(1))
    expect(modelList).toHaveBeenCalledTimes(1)

    setRevision(1)
    await waitFor(() => expect(document.querySelector("[data-revision='1']")).toBeInTheDocument())
    await userEvent.click(screen.getByRole("tab", { name: "Providers" }))
    await userEvent.click(screen.getByRole("tab", { name: "Models" }))
    events.push({
      id: Event.ID.make("00000000-0000-4000-8000-000000000010"),
      type: "mcp.status.changed",
      created: 1,
      data: {},
    })
    await Promise.resolve()
    expect(providerList).toHaveBeenCalledTimes(1)
    expect(modelList).toHaveBeenCalledTimes(1)

    await events.push({
      id: Event.ID.make("00000000-0000-4000-8000-000000000011"),
      type: "integration.connection.updated",
      created: Date.now() + 1,
      data: { integrationID: Integration.ID.make(Provider.OpenAI) },
    })
    await waitFor(() => expect(providerList).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(modelList).toHaveBeenCalledTimes(2))
    expect(screen.queryByText("Refreshing providers…")).not.toBeInTheDocument()

    await Promise.all([
      events.push({
        id: Event.ID.make("00000000-0000-4000-8000-000000000012"),
        type: "integration.updated",
        created: Date.now() + 2,
        data: {},
      }),
      events.push({
        id: Event.ID.make("00000000-0000-4000-8000-000000000013"),
        type: "config.updated",
        created: Date.now() + 3,
        data: {},
      }),
    ])
    // `push` settles when the Connection pulls the event, but the Connection batches
    // non-terminal events for 16 ms before delivery. Outlast that window so the burst
    // reaches the watcher while the reads are still in flight.
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    providerRefresh.resolve()
    modelRefresh.resolve()
    await waitFor(() => expect(providerList).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(modelList).toHaveBeenCalledTimes(3))
  })
})

describe("Gateway custom models", () => {
  const connected = [provider(Provider.OpenAI, "OpenAI", 1), provider(Provider.Anthropic, "Anthropic", 0)]
  const route = () =>
    renderApp(() => (
      <MemoryRouter>
        <Route path="/" component={GatewayModelsRoute} />
      </MemoryRouter>
    ))

  it("adds a custom model on an active provider with optional prices and context limit", async () => {
    const { modelCreate } = installClient({ providerEntries: connected, modelEntries: [models[0]!] })
    route()
    await screen.findByRole("switch", { name: "Enabled GPT-5" })
    await userEvent.click(screen.getByRole("button", { name: "Add model" }))
    const dialog = await screen.findByRole("dialog", { name: "Add custom model" })
    // Only active Providers can be chosen.
    expect(within(dialog).getByRole("button", { name: "OpenAI" })).toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Display label" }), "Pinned GPT")
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Upstream model name" }), "gpt-5-2026-01-01")
    expect(within(dialog).getByRole("textbox", { name: "Key (optional)" })).toHaveAccessibleDescription(
      "The model's identity within the provider and in API requests. It can't be changed later.",
    )
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Input price" }), "1.25")
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Context limit" }), "1.5")
    await userEvent.click(within(dialog).getByRole("button", { name: "Add model" }))
    expect(await within(dialog).findByText("Context limit must be a whole number of tokens.")).toBeInTheDocument()
    expect(modelCreate).not.toHaveBeenCalled()
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Context limit" }))
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Context limit" }), "128000")
    await userEvent.click(within(dialog).getByRole("button", { name: "Add model" }))
    await waitFor(() =>
      expect(modelCreate).toHaveBeenCalledWith(
        {
          workspace: workspace.id,
          provider: Provider.OpenAI,
          name: "Pinned GPT",
          apiID: "gpt-5-2026-01-01",
          cost: { input: 1.25 },
          limit: { context: 128000 },
        },
        expect.anything(),
      ),
    )
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add custom model" })).not.toBeInTheDocument())
    expect(await screen.findByRole("switch", { name: "Enabled Pinned GPT" })).toBeInTheDocument()
    expect(screen.getByText("Custom")).toBeInTheDocument()
  })

  it("edits and deletes only custom models", async () => {
    const custom = {
      ...model(Provider.OpenAI, "pinned", "Pinned"),
      custom: true,
      info: { ...model(Provider.OpenAI, "pinned", "Pinned").info, apiID: "upstream-v1", cost: { input: 2, cache: {} } },
    }
    const { modelUpdate, modelDelete } = installClient({
      providerEntries: connected,
      modelEntries: [models[0]!, custom],
    })
    route()
    await screen.findByRole("switch", { name: "Enabled Pinned" })
    await userEvent.click(screen.getByRole("button", { name: "Actions for GPT-5" }))
    expect(menuItem("Edit")).toBeUndefined()
    expect(menuItem("Delete")).toBeUndefined()
    await userEvent.keyboard("{Escape}")

    await userEvent.click(screen.getByRole("button", { name: "Actions for Pinned" }))
    await userEvent.click(menuItem("Edit")!)
    const dialog = await screen.findByRole("dialog", { name: "Edit custom model" })
    expect(within(dialog).queryByRole("textbox", { name: "Key (optional)" })).not.toBeInTheDocument()
    expect(within(dialog).getByRole("textbox", { name: "Upstream model name" })).toHaveValue("upstream-v1")
    expect(within(dialog).getByRole("textbox", { name: "Input price" })).toHaveValue("2")
    const label = within(dialog).getByRole("textbox", { name: "Display label" })
    await userEvent.clear(label)
    await userEvent.type(label, "Pinned v2")
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }))
    await waitFor(() =>
      expect(modelUpdate).toHaveBeenCalledWith(
        {
          workspace: workspace.id,
          provider: Provider.OpenAI,
          id: "pinned",
          name: "Pinned v2",
          apiID: "upstream-v1",
          cost: { input: 2 },
          limit: { context: 1 },
        },
        expect.anything(),
      ),
    )
    await screen.findByRole("switch", { name: "Enabled Pinned v2" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit custom model" })).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole("button", { name: "Actions for Pinned v2" }), { pointerEventsCheck: 0 })
    await userEvent.click(menuItem("Delete")!)
    const confirm = await screen.findByRole("dialog", { name: "Delete Pinned v2?" })
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete model" }))
    await waitFor(() =>
      expect(modelDelete).toHaveBeenCalledWith(
        { workspace: workspace.id, provider: Provider.OpenAI, id: "pinned" },
        expect.anything(),
      ),
    )
    await waitFor(() => expect(screen.queryByRole("switch", { name: "Enabled Pinned v2" })).not.toBeInTheDocument())
  })
})

function menuItem(name: string) {
  return screen.getAllByRole("menuitem", { hidden: true }).find((element) => element.textContent === name)
}

async function chooseFilter(option: string) {
  const trigger = screen.getByRole("button", { name: /providers$/i })
  if (trigger.getAttribute("aria-expanded") !== "true") await userEvent.click(trigger)
  const item = screen.getByRole("option", { name: option })
  const popover = item.closest("[data-component='menu-content']")
  await userEvent.click(item)
  if (!popover) return
  fireEvent.animationEnd(popover)
  popover.remove()
}

function renderPage(input: {
  readonly items: ModelListOutput
  readonly providers: ReadonlyArray<ProviderDirectoryEntry>
  readonly toggle?: (model: ModelListOutput[number], enabled: boolean) => Promise<unknown>
  readonly setDefault?: (model: ModelListOutput[number]) => Promise<unknown>
}) {
  return render(() => (
    <GatewayModelsPage
      items={() => input.items}
      state={() => ({ state: "ready" })}
      providerEntries={() => input.providers}
      onRetry={async () => undefined}
      onToggle={input.toggle ?? (async () => undefined)}
      {...(input.setDefault ? { onSetDefault: input.setDefault } : {})}
    />
  ))
}

function provider(name: Provider.Name, displayName: string, connectionCount: number): ProviderDirectoryEntry {
  return {
    info: {
      name,
      displayName,
      api: Provider.API.make(`https://${name}.example.com`),
      format: "openai",
      status: "auto",
    },
    integration: {
      id: Integration.ID.make(name),
      name: displayName,
      methods: [{ type: "key", label: "API key" }],
      connections: [],
    },
    active: connectionCount > 0,
    connected: connectionCount > 0,
    connectionCount,
    modelCount: 1,
  }
}

function model(provider: Provider.Name, id: string, name: string): ModelListOutput[number] {
  return {
    info: {
      id,
      provider,
      apiID: id,
      name,
      description: "",
      status: "active",
      releaseDate: "2026-01-01",
      lastUpdated: "2026-01-01",
      openWeights: false,
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        tools: true,
        input: ["text"],
        output: ["text"],
      },
      variants: [],
      limit: { context: 1, output: 1 },
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    },
    enabled: true,
    isPreferredDefault: false,
    isEffectiveDefault: false,
  }
}

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

function installClient(input: {
  readonly providerEntries: ReadonlyArray<ProviderDirectoryEntry>
  readonly modelEntries: ModelListOutput
  readonly events?: ReturnType<typeof eventStream>
  readonly blockSecondRead?: {
    readonly provider: Promise<void>
    readonly model: Promise<void>
  }
  readonly providerWrite?: (change: {
    readonly provider: Provider.Name
    readonly status: "auto" | "enabled" | "disabled"
  }) => Promise<void>
}) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  let entries = input.modelEntries
  let providerEntries = [...input.providerEntries]
  let providerReads = 0
  let modelReads = 0
  const providerList = vi.fn(async () => {
    providerReads += 1
    if (providerReads === 2) await input.blockSecondRead?.provider
    return providerEntries
  })
  const modelList = vi.fn(async () => {
    modelReads += 1
    if (modelReads === 2) await input.blockSecondRead?.model
    return entries
  })
  const modelToggle = vi.fn(async (change: { readonly id: string; readonly enabled: boolean }) => {
    entries = entries.map((item) => (item.info.id === change.id ? { ...item, enabled: change.enabled } : item))
    return entries
  })
  const modelDefault = vi.fn(async (change: { readonly provider: Provider.Name; readonly id: string }) => {
    entries = entries.map((item) => ({
      ...item,
      isPreferredDefault: item.info.provider === change.provider && item.info.id === change.id,
      isEffectiveDefault: item.info.provider === change.provider && item.info.id === change.id,
    }))
    return entries
  })
  const providerUpdate = vi.fn(
    async (change: { readonly provider: Provider.Name; readonly status: "auto" | "enabled" | "disabled" }) => {
      await input.providerWrite?.(change)
      providerEntries = providerEntries.map((entry) =>
        entry.info.name === change.provider
          ? {
              ...entry,
              info: { ...entry.info, status: change.status },
              active: change.status !== "disabled",
            }
          : entry,
      )
    },
  )
  type Custom = {
    readonly provider: Provider.Name
    readonly id?: string
    readonly name: string
    readonly apiID: string
    readonly cost?: { readonly input?: number; readonly output?: number }
    readonly limit?: { readonly context?: number }
  }
  const customRow = (change: Custom) => {
    const row = model(change.provider, change.id ?? change.apiID, change.name)
    return {
      ...row,
      custom: true,
      info: {
        ...row.info,
        apiID: change.apiID,
        cost: { ...change.cost, cache: {} },
        limit: { ...change.limit },
      },
    }
  }
  const modelCreate = vi.fn(async (change: Custom) => {
    const row = customRow(change)
    entries = [...entries, row]
    return row
  })
  const modelUpdate = vi.fn(async (change: Custom) => {
    const row = customRow(change)
    entries = entries.map((item) => (item.info.id === row.info.id ? row : item))
    return row
  })
  const modelDelete = vi.fn(async (change: { readonly provider: Provider.Name; readonly id: string }) => {
    entries = entries.filter((item) => item.info.provider !== change.provider || item.info.id !== change.id)
  })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    provider: { list: providerList, update: providerUpdate },
    model: {
      ...base.model,
      list: modelList,
      toggle: modelToggle,
      default: modelDefault,
      create: modelCreate,
      update: modelUpdate,
      delete: modelDelete,
    },
    event: {
      ...base.event,
      ...(input.events ? { subscribe: input.events.subscribe } : {}),
    },
    integration: {
      ...base.integration,
      get: vi
        .fn()
        .mockImplementation(({ integrationID }) =>
          Promise.resolve(input.providerEntries.find((entry) => entry.integration?.id === integrationID)?.integration),
        ),
    },
  } as unknown as ByMorningClient)
  return { providerList, providerUpdate, modelList, modelToggle, modelDefault, modelCreate, modelUpdate, modelDelete }
}

function renderApp(view: () => ReturnType<typeof GatewayModelsPage>, events = false) {
  const content = () => (
    <DataProvider>
      <IntegrationProvider>{view()}</IntegrationProvider>
    </DataProvider>
  )
  return render(() => (
    <SDKProvider>
      <DialogProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          {events ? <WorkspaceEventProvider>{content()}</WorkspaceEventProvider> : content()}
        </WorkspaceScope>
      </DialogProvider>
    </SDKProvider>
  ))
}

function eventStream() {
  const queue: Array<{ readonly item: WorkspaceEventItem; readonly delivered: PromiseWithResolvers<void> }> = []
  let wake = Promise.withResolvers<void>()
  return {
    push(item: WorkspaceEventItem) {
      const delivered = Promise.withResolvers<void>()
      queue.push({ item, delivered })
      wake.resolve()
      return delivered.promise
    },
    subscribe: vi.fn<ByMorningClient["event"]["subscribe"]>((_input, options) =>
      (async function* () {
        yield { id: Event.ID.make("00000000-0000-4000-8000-000000000000"), type: "server.connected" as const, data: {} }
        while (!options?.signal?.aborted) {
          if (queue.length === 0) {
            await wake.promise
            wake = Promise.withResolvers<void>()
            continue
          }
          const next = queue.shift()!
          yield next.item
          next.delivered.resolve()
        }
      })(),
    ),
  }
}
