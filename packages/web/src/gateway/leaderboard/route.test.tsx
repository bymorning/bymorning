import { ByMorning, type ByMorningClient, type UsageLeaderboardOutput } from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { afterEach, expect, it, vi } from "vitest"

import { type QueryState } from "../../context/data"
import { TestDataProvider as DataProvider } from "../../context/test-data-provider"
import { ThemeProvider } from "../../ui/theme"
import { SDKProvider } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { Toast, toaster } from "../../ui/components/toast"
import { providerIcons } from "../../integration/provider-icons.generated"
import { GatewayLeaderboardPage, GatewayLeaderboardRoute, spendShares } from "./route"

const usage = (cost: number, total: number, costComplete = true) => ({
  invocations: 1,
  cost,
  costComplete,
  tokens: { total, input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const data = {
  days: 7,
  from: new Date("2026-08-31T00:00:00.000Z"),
  to: new Date("2026-09-06T12:00:00.000Z"),
  users: [
    {
      userID: "usr_01M0VJBS17YBD57FG3C6Q6N8FY",
      email: "andrew@example.com",
      usage: usage(12.5, 1_000, false),
      models: [{ model: "openai/gpt-5", usage: usage(12.5, 1_000, false) }],
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      userID: `usr_01M0VJBS17YBD57FG3C6Q6N${index.toString().padStart(3, "0")}`,
      email: `member${index}@example.com`,
      usage: usage(10 - index, 10_000 - index),
      models: [{ model: "anthropic/claude-sonnet", usage: usage(10 - index, 10_000 - index) }],
    })),
  ],
  models: [
    { model: "openai/gpt-5", users: 4, usage: usage(20, 8_000) },
    { model: "anthropic/claude-sonnet", users: 7, usage: usage(10, 20_000) },
  ],
} as unknown as UsageLeaderboardOutput

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.create(),
  name: "Test",
  status: "active",
  role: "admin",
})

function installClient(overrides: Record<string, unknown>) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, ...overrides } as ByMorningClient)
}

const ready = (data: UsageLeaderboardOutput): QueryState<UsageLeaderboardOutput> => ({
  state: "ready",
  refreshedAt: 0,
  data,
})

function mount(input: { state?: () => QueryState<UsageLeaderboardOutput> } = {}) {
  const [view, setView] = createStore<{
    range: 7 | 30 | 90
    page: number
    expanded: Set<string>
  }>({
    range: 7,
    page: 0,
    expanded: new Set<string>(),
  })
  const retry = vi.fn()
  return {
    ...render(() => (
      <ThemeProvider>
        <Toast.Region />
        <GatewayLeaderboardPage
          state={input.state ?? (() => ready(data))}
          range={() => view.range}
          page={() => view.page}
          expanded={() => view.expanded}
          onRangeChange={(range) => setView({ range, page: 0 })}
          onPageChange={(page) => setView("page", page)}
          onToggle={(id) => setView("expanded", new Set(view.expanded).add(id))}
          onRetry={retry}
          modelInfo={(id) =>
            id === "openai/gpt-5" || id === "gpt-5"
              ? { name: "GPT-5", provider: Provider.Name.make("openai") }
              : undefined
          }
        />
      </ThemeProvider>
    )),
    retry,
  }
}

it("renders the model table above members without filter controls", async () => {
  mount()
  expect(screen.getByRole("heading", { name: "Leaderboard" })).toBeInTheDocument()
  const models = screen.getByRole("table", { name: "Model leaderboard" })
  const members = screen.getByRole("table", { name: "Member leaderboard" })
  expect(models.compareDocumentPosition(members) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(members).getAllByRole("row")).toHaveLength(11)
  expect(within(members).getByRole("rowheader", { name: /andrew/ })).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument()
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Cost" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Tokens" })).not.toBeInTheDocument()
  expect(within(models).getByRole("cell", { name: "4" })).toBeInTheDocument()
  expect(screen.getAllByText("GPT-5").length).toBeGreaterThan(0)
  expect(screen.getAllByText("openai/gpt-5").length).toBeGreaterThan(0)
  expect(document.querySelector('[aria-label="Model leaderboard"] [data-slot="model-label"]')).toHaveTextContent(
    "GPT-5openai/gpt-5",
  )
  expect(document.querySelector('[aria-label="Model leaderboard"] [data-slot="provider-icon"] img')).toHaveAttribute(
    "src",
    providerIcons.openai.url,
  )
  expect(screen.getByLabelText("At least $12.50; known subtotal; pricing incomplete")).toBeInTheDocument()
  expect(within(members).getByText("1K")).toBeInTheDocument()
  // Share is of the whole Workspace's spend ($20 + $10), so the leader is not automatically 100%.
  expect(within(models).getByLabelText("67% of model spend")).toBeInTheDocument()
  expect(within(models).getByText("67%")).toBeInTheDocument()
  expect(within(models).getByLabelText("33% of model spend")).toBeInTheDocument()
  expect(within(models).getByText("33%")).toBeInTheDocument()
  const modelShares = within(models)
    .getAllByRole("progressbar")
    .map((bar) => Number(bar.getAttribute("aria-label")?.match(/^(\d+)%/)?.[1]))
  expect(modelShares.reduce((sum, share) => sum + share, 0)).toBe(100)
  expect(within(models).queryByText("100%")).not.toBeInTheDocument()
  expect(within(members).getAllByLabelText(/% of member spend$/).length).toBeGreaterThan(0)

  await userEvent.click(screen.getByRole("button", { name: "Expand model usage for andrew@example.com" }))
  expect(screen.getByRole("table", { name: "Models used by andrew@example.com" })).toHaveTextContent("gpt-5")
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText("Page 2 of 2")).toBeInTheDocument()
})

it("uses a non-ID fallback when a historical member has no resolvable email", () => {
  const { email: _, ...user } = data.users[0]!
  mount({ state: () => ready({ ...data, users: [user] }) })
  expect(screen.getByRole("rowheader", { name: /Unknown member/ })).toBeInTheDocument()
  expect(screen.queryByText(data.users[0]!.userID)).not.toBeInTheDocument()
})

it("resolves the provider icon for usage records that omit the provider prefix", () => {
  mount({
    state: () =>
      ready({
        ...data,
        users: [],
        models: [{ model: "gpt-5", users: 1, usage: usage(1, 100) }],
      }),
  })
  expect(document.querySelector('[aria-label="Model leaderboard"] [data-slot="provider-icon"] img')).toHaveAttribute(
    "src",
    providerIcons.openai.url,
  )
})

it("renders deterministic loading, failure, and empty states", async () => {
  mount({ state: () => ({ state: "loading" }) })
  expect(screen.getByRole("status")).toHaveTextContent("Loading leaderboard...")
  cleanup()
  const [state, setState] = createSignal<QueryState<UsageLeaderboardOutput>>(ready(data))
  const failed = mount({ state })
  setState({ state: "error", message: "offline" })
  expect(await screen.findByText("Failed to load leaderboard.")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(failed.retry).toHaveBeenCalledOnce()
  cleanup()
  mount({ state: () => ready({ ...data, users: [], models: [] }) })
  expect(screen.getByRole("status")).toHaveTextContent("No usage")
  expect(screen.getByRole("status")).toHaveAttribute("data-component", "empty")
  expect(screen.getByRole("status")).toHaveAttribute("data-variant", "panel")
})

it("toasts leaderboard load failures and renders the empty page instead of throwing", async () => {
  const leaderboard = vi
    .fn<ByMorningClient["usage"]["leaderboard"]>()
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new Error("offline"))
  installClient({
    usage: { ...ByMorning.make({ baseUrl: "http://localhost" }).usage, leaderboard },
    model: { list: vi.fn().mockResolvedValue([]) },
  })
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DataProvider>
            <Toast.Region />
            <GatewayLeaderboardRoute />
          </DataProvider>
        </WorkspaceScope>
      </SDKProvider>
    </ThemeProvider>
  ))

  await screen.findByRole("table", { name: "Member leaderboard" })
  await userEvent.click(screen.getByRole("button", { name: "30 days" }))
  expect(await screen.findByText("Failed to load leaderboard.")).toBeInTheDocument()
  expect(screen.queryByRole("table", { name: "Member leaderboard" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true")
})

it("reloads the complete leaderboard when the range or workspace changes", async () => {
  const first = WorkspaceAccess.Info.make({ id: Workspace.ID.create(), name: "First", status: "active", role: "admin" })
  const second = WorkspaceAccess.Info.make({
    id: Workspace.ID.create(),
    name: "Second",
    status: "active",
    role: "admin",
  })
  const leaderboard = vi.fn<ByMorningClient["usage"]["leaderboard"]>().mockResolvedValue(data)
  installClient({
    usage: { ...ByMorning.make({ baseUrl: "http://localhost" }).usage, leaderboard },
    model: { list: vi.fn().mockResolvedValue([]) },
  })
  const [current, setCurrent] = createSignal(first)
  render(() => (
    <ThemeProvider>
      <SDKProvider>
        <Show when={current()} keyed>
          {(active) => (
            <WorkspaceScope list={[first, second]} current={active}>
              <DataProvider>
                <Toast.Region />
                <GatewayLeaderboardRoute />
              </DataProvider>
            </WorkspaceScope>
          )}
        </Show>
      </SDKProvider>
    </ThemeProvider>
  ))

  await screen.findByRole("table", { name: "Member leaderboard" })
  expect(leaderboard).toHaveBeenLastCalledWith({ workspace: first.id, days: 7 }, expect.anything())
  await userEvent.click(screen.getByRole("button", { name: "30 days" }))
  expect(leaderboard).toHaveBeenLastCalledWith({ workspace: first.id, days: 30 }, expect.anything())
  await screen.findByRole("table", { name: "Member leaderboard" })
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText("Page 2 of 2")).toBeInTheDocument()
  setCurrent(second)
  expect(leaderboard).toHaveBeenLastCalledWith({ workspace: second.id, days: 7 }, expect.anything())
  expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument()
})

it("keeps a valid progress range when every model and member has zero spend", () => {
  const zeroUsage = usage(0, 0)
  mount({
    state: () =>
      ready({
        ...data,
        users: data.users.map((user) => ({ ...user, usage: zeroUsage })),
        models: data.models.map((model) => ({ ...model, usage: zeroUsage })),
      }),
  })

  for (const bar of screen.getAllByRole("progressbar")) {
    expect(Number(bar.getAttribute("max"))).toBeGreaterThan(0)
  }
})

it("fills each share bar to the percentage it shows when total spend is under $1", () => {
  // $0.22 + $0.18: a denominator clamped to $1 drew 22% and 18% bars beside 55% and 45%.
  mount({
    state: () =>
      ready({
        ...data,
        users: data.users.map((user, index) => ({ ...user, usage: usage(index === 0 ? 0.22 : 0.18, 1_000) })),
        models: data.models.map((model, index) => ({ ...model, usage: usage(index === 0 ? 0.22 : 0.18, 1_000) })),
      }),
  })

  const bars = screen.getAllByRole("progressbar")
  expect(bars.length).toBeGreaterThan(0)
  for (const bar of bars) {
    const shown = Number(bar.getAttribute("aria-label")?.match(/^(\d+)%/)?.[1])
    const filled = (Number(bar.getAttribute("value")) / Number(bar.getAttribute("max"))) * 100
    expect(filled).toBeCloseTo(shown, 5)
  }
  const models = screen.getByRole("table", { name: "Model leaderboard" })
  expect(within(models).getByLabelText("55% of model spend")).toHaveAttribute("value", "55")
  expect(within(models).getByLabelText("45% of model spend")).toHaveAttribute("value", "45")
})

it("allocates share of spend so the column always sums to exactly 100", () => {
  // A real leaderboard: one large row over many small ones. Rounding each row alone gives 99.
  const observed = [1.95, 0.1, 0.09, 0.07, 0.05, 0.03, 0.02, 0.01, 0, 0]
  const shares = spendShares(observed)
  expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100)
  expect(shares).toEqual([84, 4, 4, 3, 2, 1, 1, 1, 0, 0])
  // Ties in remainder resolve toward the higher-ranked row, never by reordering.
  expect(spendShares([1, 1, 1])).toEqual([34, 33, 33])
  // Nothing priced means nothing to share, rather than dividing by zero.
  expect(spendShares([0, 0])).toEqual([0, 0])
  expect(spendShares([])).toEqual([])
  // The 99-case in the other direction: rows that each round up would total 101.
  expect(spendShares([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]).reduce((sum, share) => sum + share, 0)).toBe(100)
})
