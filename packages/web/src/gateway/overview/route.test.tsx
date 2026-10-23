import { ByMorning, type ByMorningClient, type UsageOverviewOutput, type UsageRecordsOutput } from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { Show, createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { type QueryState } from "../../context/data"
import { TestDataProvider as DataProvider } from "../../context/test-data-provider"
import { SDKProvider } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { ThemeProvider } from "../../ui/theme"
import { Toast, toaster } from "../../ui/components/toast"
import { formatRelativeTime } from "../../ui/format"
import {
  GatewayOverviewPage,
  GatewayOverviewRoute,
  formatTokenCount,
  usageChartConfiguration,
  type UsageMetric,
} from "./route"

it.each([
  [999, "999"],
  [1_000, "1K"],
  [1_200, "1.2K"],
  [9_999, "10K"],
  [10_000, "10K"],
  [100_000, "100K"],
  [500_000, "500K"],
  [999_949, "999.9K"],
  [999_950, "1M"],
  [1_000_000, "1M"],
  [1_500_000, "1.5M"],
  [10_000_000, "10M"],
  [100_000_000, "100M"],
  [1_000_000_000, "1B"],
  [1_500_000_000, "1.5B"],
  [1_000_000_000_000, "1T"],
])("formats token count %d as %s", (value, expected) => {
  expect(formatTokenCount(value)).toBe(expected)
})

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})
const aggregate = {
  invocations: 12,
  cost: 18.5,
  costComplete: true,
  tokens: { total: 1_500, input: 500, output: 400, reasoning: 300, cache: { read: 200, write: 100 } },
}
const populated = {
  days: 30,
  from: new Date("2026-08-01T00:00:00.000Z"),
  to: new Date("2026-08-31T00:00:00.000Z"),
  total: aggregate,
  daily: [
    { date: "2026-08-29", usage: { ...aggregate, invocations: 4, cost: 6.25, tokens: { ...aggregate.tokens, total: 500 } } },
    { date: "2026-08-30", usage: { ...aggregate, invocations: 4, cost: 6.25, tokens: { ...aggregate.tokens, total: 500 } } },
    { date: "2026-08-31", usage: { ...aggregate, invocations: 4, cost: 6.25, tokens: { ...aggregate.tokens, total: 500 } } },
  ],
  models: [{ model: "provider/model", usage: aggregate }],
  users: [{ userID: "00000000-0000-4000-8000-000000000001", usage: aggregate }],
} as unknown as UsageOverviewOutput
const empty = {
  ...populated,
  total: {
    invocations: 0,
    cost: 0,
    costComplete: true,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  daily: [],
  models: [],
  users: [],
} as UsageOverviewOutput
const requestPage = {
  data: [
    {
      id: "00000000-0000-4000-8000-000000000731",
      model: "provider/request-model",
      createdAt: new Date("2026-08-31T10:00:00.000Z"),
      usage: {
        cost: 0.125,
        costComplete: false,
        tokens: { input: 1_234, output: 56, reasoning: 7, cache: { read: 0, write: 890 } },
      },
    },
  ],
  cursor: "next_page",
} as UsageRecordsOutput
const emptyRequestPage = { data: [] } as UsageRecordsOutput
const ready = <T,>(data: T): QueryState<T> => ({ state: "ready", refreshedAt: 0, data })
const clipboardProperty = Object.getOwnPropertyDescriptor(navigator, "clipboard")

function mountRoute(
  overview: ByMorningClient["usage"]["overview"],
  records: ByMorningClient["usage"]["records"] = vi.fn().mockResolvedValue(emptyRequestPage),
) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    usage: { ...base.usage, overview, records },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
  })
  return render(() => (
    <ThemeProvider>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DataProvider>
            <Toast.Region />
            <GatewayOverviewRoute />
          </DataProvider>
        </WorkspaceScope>
      </SDKProvider>
    </ThemeProvider>
  ))
}

function mountPage(
  usage: QueryState<UsageOverviewOutput> | (() => QueryState<UsageOverviewOutput>),
  onUsageRetry = vi.fn(),
  requestLog: QueryState<UsageRecordsOutput> | (() => QueryState<UsageRecordsOutput>) = ready(emptyRequestPage),
) {
  const [range, setRange] = createSignal<7 | 30 | 90>(30)
  const [metric, setMetric] = createSignal<UsageMetric>("cost")
  const onRequestLogRetry = vi.fn()
  const onPrevious = vi.fn()
  const onNext = vi.fn()
  return {
    ...render(() => (
      <ThemeProvider>
        <Toast.Region />
        <GatewayOverviewPage
          endpoint={`${window.location.origin}/inference`}
          range={range}
          usage={() => (typeof usage === "function" ? usage() : usage)}
          requestLog={() => (typeof requestLog === "function" ? requestLog() : requestLog)}
          onRangeChange={setRange}
          onUsageRetry={onUsageRetry}
          onRequestLogRetry={onRequestLogRetry}
          canGoPrevious={() => false}
          onPrevious={onPrevious}
          onNext={onNext}
          model={(id) =>
            id === "provider/request-model"
              ? { name: "Request Model", provider: Provider.Name.make("anthropic") }
              : undefined
          }
          metric={metric}
          onMetricChange={setMetric}
        />
      </ThemeProvider>
    )),
    range,
    metric,
    onRetry: onUsageRetry,
    onRequestLogRetry,
    onPrevious,
    onNext,
  }
}

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
  if (clipboardProperty) {
    Object.defineProperty(navigator, "clipboard", clipboardProperty)
    return
  }
  Reflect.deleteProperty(navigator, "clipboard")
})

it("shows and copies the inference endpoint", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  mountPage(ready(empty))

  expect(screen.getByText(`${window.location.origin}/inference`)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Copy endpoint" }))
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/inference`)
  expect(await screen.findByText("Endpoint copied.")).toHaveAttribute("aria-live", "polite")
})

it("loads the current workspace and refetches without showing stale data when the range changes", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(768)
  const second = Promise.withResolvers<UsageOverviewOutput>()
  const overview = vi
    .fn()
    .mockResolvedValueOnce(populated)
    .mockImplementationOnce(() => second.promise)
  mountRoute(overview)

  expect(screen.getByRole("status", { name: "Loading usage overview" })).toHaveTextContent("30 days")
  expect(overview).toHaveBeenCalledWith({ workspace: workspace.id, days: 30 }, expect.anything())
  await screen.findByRole("img", { name: /Daily total cost/ })
  await waitFor(() => expect(document.querySelector<HTMLElement>('[data-slot="chart-viewport"]')?.scrollLeft).toBe(768))

  await userEvent.click(screen.getByRole("button", { name: "7 days" }))
  expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true")
  expect(screen.getByRole("status", { name: "Loading usage overview" })).toHaveTextContent("7 days")
  expect(screen.queryByRole("img", { name: /Daily total cost/ })).not.toBeInTheDocument()
  expect(overview).toHaveBeenLastCalledWith({ workspace: workspace.id, days: 7 }, expect.anything())
  second.resolve({ ...populated, days: 7 } as UsageOverviewOutput)
  await screen.findByRole("img", { name: /Daily total cost/ })
  await waitFor(() => expect(document.querySelector<HTMLElement>('[data-slot="chart-viewport"]')?.scrollLeft).toBe(768))
})

it("retries an API error", async () => {
  const overview = vi.fn().mockRejectedValueOnce(new Error("Usage unavailable")).mockResolvedValueOnce(empty)
  mountRoute(overview)

  expect(await screen.findByText("Usage unavailable")).toBeInTheDocument()
  await userEvent.click(await screen.findByRole("button", { name: "Try again" }))
  expect(await screen.findByRole("status", { name: "No usage for selected period" })).toHaveTextContent("No usage")
  expect(overview).toHaveBeenCalledTimes(2)
})

it("renders deterministic loading, error, and empty states", async () => {
  mountPage({ state: "loading" })
  expect(screen.getByRole("status", { name: "Loading usage overview" })).toBeInTheDocument()
  cleanup()

  const [usageState, setUsageState] = createSignal<QueryState<UsageOverviewOutput>>({ state: "loading" })
  const error = mountPage(usageState)
  setUsageState({ state: "error", message: "Broken usage" })
  expect(await screen.findByText("Broken usage")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(error.onRetry).toHaveBeenCalledOnce()
  cleanup()

  mountPage(ready(empty))
  expect(screen.getByRole("status", { name: "No usage for selected period" })).toHaveAttribute("data-variant", "panel")
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

it("persists the selected chart metric across an actual page reload", async () => {
  localStorage.clear()
  const overview = vi.fn().mockResolvedValue(populated)
  const first = mountRoute(overview)
  const user = userEvent.setup()

  await screen.findByRole("img", { name: "Daily total cost" })
  await user.click(screen.getByRole("tab", { name: /Requests/ }))
  await screen.findByRole("img", { name: "Daily requests" })
  first.unmount()

  mountRoute(overview)
  expect(await screen.findByRole("img", { name: "Daily requests" })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: /Requests/ })).toHaveAttribute("aria-selected", "true")
})

it("upgrades a request-log row's identity once the model catalog resolves after the row already rendered", async () => {
  const modelList = Promise.withResolvers<ByMorningClient["model"]["list"]>()
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    usage: {
      ...base.usage,
      overview: vi.fn().mockResolvedValue(populated),
      records: vi.fn().mockResolvedValue(requestPage),
    },
    model: { ...base.model, list: vi.fn().mockReturnValue(modelList.promise) },
  })
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DataProvider>
            <Toast.Region />
            <GatewayOverviewRoute />
          </DataProvider>
        </WorkspaceScope>
      </SDKProvider>
    </ThemeProvider>
  ))

  const table = await screen.findByRole("table", { name: "Request log" })
  // Before the catalog resolves, the row falls back to parsing the recorded string.
  expect(within(table).getByRole("rowheader", { name: "request-model" })).toBeInTheDocument()

  modelList.resolve([
    {
      info: {
        id: "request-model",
        provider: Provider.Name.make("provider"),
        apiID: "request-model",
        name: "Request Model",
        description: "",
        status: "active",
        releaseDate: "2026-01-01",
        lastUpdated: "2026-01-01",
        openWeights: false,
        capabilities: { temperature: true, reasoning: true, attachment: true, tools: true, input: [], output: [] },
        variants: [],
        limit: { context: 1, output: 1 },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      },
      enabled: true,
      isPreferredDefault: false,
      isEffectiveDefault: false,
    },
  ] as unknown as ByMorningClient["model"]["list"])

  // The same row upgrades in place to the catalog's identity, without a remount.
  await waitFor(() => expect(within(table).getByRole("rowheader", { name: "Request Model" })).toBeInTheDocument())
  expect(within(table).queryByRole("rowheader", { name: "request-model" })).not.toBeInTheDocument()
})

it("renders and formats one row per request with numeric columns aligned", async () => {
  const result = mountPage(ready(populated), vi.fn(), ready(requestPage))
  const table = screen.getByRole("table", { name: "Request log" })
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toEqual(["Time", "Model", "Input", "Cache Read", "Cache Write", "Output", "Cost"])
  const identity = within(table).getByRole("rowheader", { name: "Request Model" })
  expect(identity).toBeInTheDocument()
  expect(within(table).queryByText("provider/request-model")).not.toBeInTheDocument()
  expect(within(table).getByTitle("provider/request-model")).toBeInTheDocument()
  // The row shows the catalog Provider's mark, not one parsed from the recorded string.
  const icon = identity.querySelector('[data-slot="provider-icon"]')
  expect(icon).toHaveAttribute("data-provider-icon-kind", "canonical")
  expect(icon).toHaveAttribute("data-provider-icon", "anthropic")
  expect(within(table).getByText("1,234")).toHaveAttribute("data-align", "end")
  expect(within(table).getByText("-")).toHaveAttribute("data-align", "end")
  expect(within(table).getByText("890")).toHaveAttribute("data-align", "end")
  const output = within(table).getByText("63")
  expect(output).toHaveAttribute("data-align", "end")
  expect(output).toHaveAttribute("title", "56 output + 7 reasoning")
  expect(within(table).getByText("at least $0.1250").closest("td")).toHaveAttribute("data-align", "end")
  const time = table.querySelector("time")!
  expect(time).toHaveAttribute("datetime", "2026-08-31T10:00:00.000Z")
  expect(time).toHaveAttribute("title", requestPage.data[0]!.createdAt.toLocaleString())
  expect(result.container.querySelectorAll('[data-align="end"]')).toHaveLength(10)
  expect(screen.queryByRole("heading", { name: "Token breakdown" })).not.toBeInTheDocument()
  expect(result.container.querySelector('[data-component="gateway-usage"]')).not.toHaveAttribute("data-slot", "card")
  expect(result.container.querySelector('[data-component="request-log"]')).not.toHaveAttribute("data-slot", "card")
  expect(result.container.querySelector('[data-component="request-log-table"]')).toHaveAttribute(
    "data-slot",
    "table-wrap",
  )
  expect(await screen.findByRole("button", { name: "Prev" })).toBeDisabled()
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(result.onNext).toHaveBeenCalledOnce()
})

it("shows request log loading, error, and empty states with retry", async () => {
  mountPage(ready(empty), vi.fn(), () => ({ state: "loading" }))
  expect(screen.getByRole("status", { name: "Loading request log" })).toBeInTheDocument()
  cleanup()

  const [logState, setLogState] = createSignal<QueryState<UsageRecordsOutput>>(ready(emptyRequestPage))
  const error = mountPage(ready(empty), vi.fn(), logState)
  setLogState({ state: "error", message: "Log unavailable" })
  expect(await screen.findByText("Log unavailable")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(error.onRequestLogRetry).toHaveBeenCalledOnce()
  cleanup()

  mountPage(ready(empty))
  expect(screen.getByRole("status", { name: "No requests" })).toHaveAttribute("data-variant", "panel")
})

it("moves forward and backward through request log cursors", async () => {
  const records = vi
    .fn<ByMorningClient["usage"]["records"]>()
    .mockResolvedValueOnce(requestPage)
    .mockResolvedValueOnce(emptyRequestPage)
    .mockResolvedValueOnce(requestPage)
  mountRoute(vi.fn().mockResolvedValue(empty), records)

  await screen.findByRole("table", { name: "Request log" })
  expect(records).toHaveBeenNthCalledWith(1, { workspace: workspace.id, limit: 50 }, expect.anything())
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  await screen.findByRole("status", { name: "No requests" })
  expect(records).toHaveBeenNthCalledWith(
    2,
    { workspace: workspace.id, limit: 50, cursor: "next_page" },
    expect.anything(),
  )
  await userEvent.click(screen.getByRole("button", { name: "Prev" }))
  await screen.findByRole("table", { name: "Request log" })
  expect(records).toHaveBeenNthCalledWith(3, { workspace: workspace.id, limit: 50 }, expect.anything())
})

it("resets request log pagination when the workspace changes", async () => {
  const otherWorkspace = WorkspaceAccess.Info.make({
    id: Workspace.ID.create(),
    name: "Other",
    status: "active",
    role: "admin",
  })
  const records = vi
    .fn<ByMorningClient["usage"]["records"]>()
    .mockResolvedValueOnce(requestPage)
    .mockResolvedValueOnce(emptyRequestPage)
    .mockResolvedValueOnce(emptyRequestPage)
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    usage: { ...base.usage, overview: vi.fn().mockResolvedValue(empty), records },
    model: { ...base.model, list: vi.fn().mockResolvedValue([]) },
  })
  const [current, setCurrent] = createSignal(workspace)
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <Show when={current()} keyed>
          {(active) => (
            <WorkspaceScope list={[workspace, otherWorkspace]} current={active}>
              <DataProvider>
                <GatewayOverviewRoute />
              </DataProvider>
            </WorkspaceScope>
          )}
        </Show>
      </SDKProvider>
    </ThemeProvider>
  ))

  await screen.findByRole("table", { name: "Request log" })
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  await screen.findByRole("status", { name: "No requests" })
  setCurrent(otherWorkspace)

  await waitFor(() =>
    expect(records).toHaveBeenLastCalledWith({ workspace: otherWorkspace.id, limit: 50 }, expect.anything()),
  )
  expect(await screen.findByRole("status", { name: "No requests" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Prev" })).not.toBeInTheDocument()
  expect(records).not.toHaveBeenCalledWith(
    expect.objectContaining({ workspace: otherWorkspace.id, cursor: "next_page" }),
  )
})

it("formats request times relative to a stable absolute instant", () => {
  const now = new Date("2026-08-31T12:00:00.000Z")
  expect(formatRelativeTime(new Date("2026-08-31T10:00:00.000Z"), now)).toBe("2 hours ago")
  expect(formatRelativeTime(new Date("2026-08-30T12:00:00.000Z"), now)).toBe("yesterday")
})

it("formats populated metrics with an accessible chart and no breakdown tables", () => {
  const result = mountPage(ready(populated))

  // Cost leads, then requests, then tokens.
  expect(
    Array.from(result.container.querySelectorAll('[data-slot="metric"]')).map((metric) => [
      metric.querySelector("span")?.textContent,
      metric.querySelector("strong")?.textContent,
    ]),
  ).toEqual([
    ["Total cost", "$18.50"],
    ["Requests", "12"],
    ["Tokens", "1.5K"],
  ])
  expect(result.container.textContent).not.toMatch(/invocation/i)
  expect(screen.queryByRole("heading", { name: "Token breakdown" })).not.toBeInTheDocument()
  expect(screen.queryByRole("table", { name: "Model usage" })).not.toBeInTheDocument()
  expect(screen.queryByRole("table", { name: "User usage" })).not.toBeInTheDocument()

  // The chart defaults to cost.
  screen.getByRole("img", { name: "Daily total cost" })
  expect(screen.getByRole("tab", { name: /Total cost/ })).toHaveAttribute("aria-selected", "true")
  const viewport = result.container.querySelector<HTMLElement>('[data-slot="chart-viewport"]')
  expect(viewport).toHaveAttribute("tabindex", "0")
  const dailyValues = screen.getByRole("table", { name: "Daily total cost values" })
  expect(
    within(dailyValues)
      .getAllByRole("columnheader")
      .map((header) => header.textContent),
  ).toEqual(["Date", "Total cost"])
  expect(
    within(dailyValues)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual(["Aug 29$6.25", "Aug 30$6.25", "Aug 31$6.25"])
  expect(screen.getByRole("img", { name: /Daily total cost/ })).toHaveAttribute("aria-details", "chart-values")
  expect(result.container.textContent).not.toMatch(/higher|lower|increas|decreas/i)
})

it("switches the chart to the selected metric and keeps the choice across a reload", async () => {
  const [state, setState] = createSignal<QueryState<UsageOverviewOutput>>(ready(populated))
  mountPage(state)
  const user = userEvent.setup()

  await user.click(screen.getByRole("tab", { name: /Requests/ }))
  expect(screen.getByRole("tab", { name: /Requests/ })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("tab", { name: /Total cost/ })).toHaveAttribute("aria-selected", "false")
  screen.getByRole("img", { name: "Daily requests" })
  const requests = screen.getByRole("table", { name: "Daily requests values" })
  expect(within(requests).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Date", "Requests"])
  expect(
    within(requests)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual(["Aug 294", "Aug 304", "Aug 314"])

  await user.click(screen.getByRole("tab", { name: /Tokens/ }))
  screen.getByRole("img", { name: "Daily tokens" })
  expect(
    within(screen.getByRole("table", { name: "Daily tokens values" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual(["Aug 29500", "Aug 30500", "Aug 31500"])

  // A range change unmounts the results while loading; the selection must survive it.
  setState({ state: "loading" })
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  setState(ready({ ...populated, days: 7 } as UsageOverviewOutput))
  expect(screen.getByRole("tab", { name: /Tokens/ })).toHaveAttribute("aria-selected", "true")
  screen.getByRole("img", { name: "Daily tokens" })
})

it("keeps request counts expanded while compacting only token displays", () => {
  const usage = { ...aggregate, invocations: 1_500 }
  const data = {
    ...populated,
    total: usage,
    daily: [],
    models: [{ model: "provider/model", usage }],
    users: [],
  } as unknown as UsageOverviewOutput
  const result = mountPage(ready(data))

  expect(
    Array.from(result.container.querySelectorAll('[data-slot="metric"] strong')).map((metric) => metric.textContent),
  ).toEqual(["$18.50", "1,500", "1.5K"])
})

it("labels incomplete spend as a known subtotal", () => {
  mountPage(
    ready({
      ...populated,
      total: { ...aggregate, costComplete: false },
      models: [{ model: "provider/model", usage: { ...aggregate, costComplete: false } }],
    } as unknown as UsageOverviewOutput),
  )

  expect(screen.getByText("at least $18.50")).toBeInTheDocument()
  expect(screen.getByLabelText("At least $18.50; known subtotal; pricing incomplete")).toBeInTheDocument()
})

it("only moves the chart viewport for a rendered daily data set", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(768)
  const result = mountPage(ready(populated))
  const viewport = result.container.querySelector<HTMLElement>('[data-slot="chart-viewport"]')!

  await waitFor(() => expect(viewport.scrollLeft).toBe(768))
  viewport.scrollLeft = 120
  await Promise.resolve()

  expect(viewport.scrollLeft).toBe(120)
  expect(document.documentElement.scrollLeft).toBe(0)
})

it("preserves single-point chart semantics", () => {
  mountPage(ready({ ...populated, daily: [populated.daily[0]!] } as UsageOverviewOutput))
  expect(screen.getByRole("img", { name: "Daily total cost" })).toBeInTheDocument()
})

it("renders a populated overview with no daily points without inventing chart data", () => {
  mountPage(ready({ ...populated, daily: [] } as UsageOverviewOutput))
  const chart = screen.getByRole("img", { name: "Daily total cost" })
  expect(chart).toBeInTheDocument()
})

it("builds the reference bar chart configuration from the selected daily series", () => {
  const configuration = usageChartConfiguration({
    label: "Total cost",
    format: (value) => `$${value.toFixed(2)}`,
    dates: populated.daily.map((day) => day.date),
    values: populated.daily.map((day) => day.usage.cost),
    reducedMotion: true,
    theme: {
      text: "text",
      textMuted: "muted",
      textFaint: "faint",
      border: "border",
      background: "background",
      accent: "accent",
      accentHover: "hover",
      font: "mono",
    },
  })

  expect(configuration.data.labels).toEqual(["Aug 29", "Aug 30", "Aug 31"])
  expect(configuration.data.datasets).toEqual([
    expect.objectContaining({ label: "Total cost", data: [6.25, 6.25, 6.25], borderWidth: 0 }),
  ])
  // Tooltips name the metric and format it in its own unit rather than as a bare count.
  const label = configuration.options?.plugins?.tooltip?.callbacks?.label
  expect(typeof label === "function" && label.call(undefined as never, { parsed: { y: 6.25 } } as never)).toBe(
    "Total cost: $6.25",
  )
  expect(configuration.options).toMatchObject({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    scales: { x: { grid: { display: false } } },
    plugins: {
      title: { display: true, text: "Total cost", align: "start" },
      legend: { display: false },
      tooltip: { mode: "index", intersect: false },
    },
  })

  // The vertical scale shows only the baseline and the series max, matching the series' own units.
  const yScale = configuration.options?.scales?.y as
    | { afterBuildTicks?: (axis: { ticks: unknown }) => void; ticks?: { callback?: (value: number) => string } }
    | undefined
  const axis = { ticks: [] as Array<{ value: number }> }
  yScale?.afterBuildTicks?.(axis)
  expect(axis.ticks).toEqual([{ value: 0 }, { value: 6.25 }])
  expect(yScale?.ticks?.callback?.(6.25)).toBe("$6.25")
})

it("labels the newest day on the x axis even when older labels are thinned", () => {
  const dates = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`)
  const configuration = usageChartConfiguration({
    label: "Requests",
    format: String,
    dates,
    values: dates.map(() => 1),
    reducedMotion: true,
    theme: {
      text: "text",
      textMuted: "muted",
      textFaint: "faint",
      border: "border",
      background: "background",
      accent: "accent",
      accentHover: "hover",
      font: "mono",
    },
  })
  const xScale = configuration.options?.scales?.x as
    | { ticks?: { callback?: (value: number, index: number) => string } }
    | undefined
  const shown = dates.map((_, index) => xScale?.ticks?.callback?.(index, index)).filter(Boolean)
  expect(shown.at(-1)).toBe("Sep 30")
  expect(shown.length).toBeGreaterThan(5)
  expect(shown.length).toBeLessThan(dates.length)
})

it("shows a single baseline tick instead of a duplicate formatted value when every day is zero", () => {
  const configuration = usageChartConfiguration({
    label: "Total cost",
    format: (value) => `$${value.toFixed(2)}`,
    dates: empty.daily.map((day) => day.date),
    values: [0, 0, 0],
    reducedMotion: true,
    theme: {
      text: "text",
      textMuted: "muted",
      textFaint: "faint",
      border: "border",
      background: "background",
      accent: "accent",
      accentHover: "hover",
      font: "mono",
    },
  })

  const yScale = configuration.options?.scales?.y as
    | { afterBuildTicks?: (axis: { ticks: unknown }) => void }
    | undefined
  const axis = { ticks: [] as Array<{ value: number }> }
  yScale?.afterBuildTicks?.(axis)
  expect(axis.ticks).toEqual([{ value: 0 }])
})
