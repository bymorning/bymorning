import { cleanup, render as renderView, screen, waitFor, within } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import userEvent from "@testing-library/user-event"
import {
  ByMorning,
  type BudgetStatusOutput,
  type ByMorningClient,
  type ModelListOutput,
  type ServiceAccountListOutput,
  type ServiceAccountKeyListOutput,
} from "@bymorning/client"
import { Provider } from "@bymorning/schema/provider"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TestDataProvider as DataProvider } from "../context/test-data-provider"
import { DialogProvider } from "../context/dialog"
import { SDKProvider } from "../context/sdk"
import { WorkspaceScope } from "../context/workspace"
import { providerIcons } from "../integration/provider-icons.generated"
import { GatewayBudgetsRoute } from "./budgets/route"
import { GatewayModelsPage } from "./models/view"
import { GatewayServiceAccountRoute, GatewayServiceAccountsRoute } from "./service-accounts/route"

afterEach(cleanup)

function render(view: () => JSX.Element) {
  const client = new QueryClient()
  const result = renderView(() => <QueryClientProvider client={client}>{view()}</QueryClientProvider>)
  return { ...result, client }
}

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.make("wrk_06689145a001WPprT0zKiRAQWn"),
  name: "Test",
  status: "active",
  role: "admin",
})

function installClient(overrides: Record<string, unknown>) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, ...overrides } as ByMorningClient)
}

describe("AI Gateway pages", () => {
  it("shows real budget status and preserves account policy when setting and removing limits", async () => {
    type Preview = BudgetStatusOutput["standings"][number]
    const serviceAccountID = "sva_06689145a001WPprT0zKiRAQWn" as unknown as Extract<Preview["target"], { type: "service_account" }>["serviceAccountID"]
    const status: BudgetStatusOutput = {
      period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
      standings: [
        {
          target: { type: "workspace" },
          holder: "workspace" as unknown as BudgetStatusOutput["standings"][number]["holder"],
          period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
          spent: 12.5,
          limit: 100,
        },
        {
          target: { type: "service_account", serviceAccountID },
          holder: serviceAccountID as unknown as BudgetStatusOutput["standings"][number]["holder"],
          period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
          spent: 4.25,
        },
      ],
    }
    const limitWrites: Array<Parameters<ByMorningClient["budget"]["limit"]>[0]> = []
    installClient({
      budget: {
        status: vi.fn(async () => status),
        limit: vi.fn(async (input: Parameters<ByMorningClient["budget"]["limit"]>[0]) => {
          limitWrites.push(input)
          return status.standings[0]!
        }),
      },
      serviceAccount: {
        list: vi.fn(async () => [
          {
            id: "sva_06689145a001WPprT0zKiRAQWn" as ServiceAccountListOutput[number]["id"],
            workspaceID: workspace.id,
            name: "Production inference",
            status: "active",
            policy: { models: ["gpt-5"], rpm: 60, tpm: 10_000 },
            keyCount: 0,
            timeCreated: new Date("2026-08-12T00:00:00Z"),
            timeUpdated: new Date("2026-08-12T00:00:00Z"),
          },
        ]),
      },
      user: {
        list: vi.fn(async () => ({ role: "admin", members: [] }) as Awaited<ReturnType<ByMorningClient["user"]["list"]>>),
      },
    })
    render(() => (
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <DataProvider>
            <DialogProvider>
              <GatewayBudgetsRoute />
            </DialogProvider>
          </DataProvider>
        </WorkspaceScope>
      </SDKProvider>
    ))

    expect(await screen.findByText("$12.50")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "100")
    expect(screen.getByText("Production inference")).toBeInTheDocument()
    expect(screen.getByText("$4.25")).toBeInTheDocument()
    expect(screen.getByText(/No limit/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Set limit for Production inference" }))
    await userEvent.type(screen.getByRole("textbox", { name: "Production inference monthly limit (USD)" }), "25.50")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(limitWrites).toHaveLength(1))
    expect(limitWrites[0]).toEqual({
      workspace: workspace.id,
      target: { type: "service_account", serviceAccountID },
      amount: 25.5,
    })

    await userEvent.click(screen.getByRole("button", { name: "Edit limit for Workspace" }))
    const workspaceInput = screen.getByRole("textbox", { name: "Workspace monthly limit (USD)" })
    await userEvent.clear(workspaceInput)
    await userEvent.click(screen.getByRole("button", { name: "Remove" }))
    await userEvent.click(
      within(await screen.findByRole("dialog", { name: "Remove limit?" })).getByRole("button", { name: "Remove" }),
    )
    await waitFor(() => expect(limitWrites).toEqual([
      { workspace: workspace.id, target: { type: "service_account", serviceAccountID }, amount: 25.5 },
      { workspace: workspace.id, target: { type: "workspace" } },
    ]))
  })

  it("renders service accounts returned by the client", async () => {
    const accounts: ServiceAccountListOutput = [
      {
        id: "sva_06689145a001WPprT0zKiRAQWn" as ServiceAccountListOutput[number]["id"],
        workspaceID: workspace.id,
        name: "Production inference",
        status: "active",
        policy: { models: ["gpt-5"], rpm: 60, tpm: 10_000 },
        timeCreated: new Date("2026-08-12T00:00:00Z"),
        timeUpdated: new Date("2026-08-12T00:00:00Z"),
        keyCount: 2,
      },
      {
        id: "sva_06689145a001WPprT0zKiRAQWo" as ServiceAccountListOutput[number]["id"],
        workspaceID: workspace.id,
        name: "Suspended account",
        status: "suspended",
        policy: { rpm: 10 },
        timeCreated: new Date("2026-08-13T00:00:00Z"),
        timeUpdated: new Date("2026-08-13T00:00:00Z"),
        keyCount: 0,
      },
    ]
    const creations: Array<Parameters<ByMorningClient["serviceAccount"]["create"]>[0]> = []
    const history = createMemoryHistory()
    history.set({ value: "/" })
    installClient({
      serviceAccount: {
        list: vi.fn(async () => accounts),
        get: vi.fn(async () => accounts[0]!),
        create: vi.fn(async (input) => {
          creations.push(input)
          return accounts[0]!
        }),
        update: vi.fn(async (input) => {
          if (input.status === "suspended") throw new Error("Status unavailable")
          return accounts[0]!
        }),
        remove: vi.fn(async () => undefined),
        key: {
          list: vi.fn(async () => [] satisfies ServiceAccountKeyListOutput),
          create: vi.fn(async () => Promise.reject(new Error("unused"))),
          revoke: vi.fn(async () => undefined),
        },
      },
      budget: {
        status: vi.fn(async () => ({
          period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
          standings: [
            {
              target: { type: "workspace" },
              holder: "workspace" as unknown as BudgetStatusOutput["standings"][number]["holder"],
              period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
              spent: 4.25,
              limit: 100,
            },
            {
              target: { type: "service_account", serviceAccountID: accounts[0]!.id },
              holder: accounts[0]!.id as unknown as BudgetStatusOutput["standings"][number]["holder"],
              period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
              spent: 4.25,
              limit: 100,
            },
          ],
        })),
      },
    })
    render(() => (
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route
            path="/"
            component={() => (
              <WorkspaceScope list={[workspace]} current={workspace}>
                <DialogProvider>
                  <DataProvider>
                    <GatewayServiceAccountsRoute />
                  </DataProvider>
                </DialogProvider>
              </WorkspaceScope>
            )}
          />
        </MemoryRouter>
      </SDKProvider>
    ))
    const accountLink = await screen.findByRole("link", { name: "Production inference" })
    expect(accountLink).toHaveAttribute("href", `/w/${workspace.id}/gateway/service-accounts/${accounts[0]!.id}`)
    expect(screen.getByRole("columnheader", { name: "Keys" })).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Models" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "RPM" })).not.toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "TPM" })).not.toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Usage" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Limit" })).toBeInTheDocument()
    expect(screen.getByText("(4%)")).toBeInTheDocument()
    expect(screen.getByText("$4.25")).toBeInTheDocument()
    expect(screen.getByText("$100.00")).toBeInTheDocument()
    expect(within(screen.getByRole("row", { name: /Suspended account/ })).getAllByText("—")[0]).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "New service account" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("New service account")
    expect(screen.getByRole("textbox", { name: "Service account name" })).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "Budget (USD/month)" })).not.toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Allowed models" })).not.toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "Requests per minute" })).not.toBeInTheDocument()
    expect(screen.queryByRole("spinbutton", { name: "Tokens per minute" })).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole("textbox", { name: "Service account name" }), "Unrestricted inference")
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create service account" }))

    await waitFor(() => expect(creations).toHaveLength(1))
    expect(creations[0]).toEqual({ workspace: workspace.id, name: "Unrestricted inference", policy: {} })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    const routeBeforeAction = history.get()
    await userEvent.click(screen.getByRole("button", { name: "Actions for Production inference" }))
    expect(history.get()).toBe(routeBeforeAction)
    await userEvent.keyboard("{Escape}")
    accountLink.focus()
    await userEvent.keyboard("{Enter}")
    expect(history.get()).toBe(`/w/${workspace.id}/gateway/service-accounts/${accounts[0]!.id}`)
  })

  it("renders a service account API key detail table without exposing its secret", async () => {
    const account: ServiceAccountListOutput[number] = {
      id: "sva_06689145a001WPprT0zKiRAQWn" as ServiceAccountListOutput[number]["id"],
      workspaceID: workspace.id,
      name: "Production inference",
      status: "active",
      policy: {},
      keyCount: 1,
      timeCreated: new Date("2026-08-12T00:00:00Z"),
      timeUpdated: new Date("2026-08-12T00:00:00Z"),
    }
    const keys: ServiceAccountKeyListOutput = [
      {
        id: "apk_06689145a001WPprT0zKiRAQWn" as ServiceAccountKeyListOutput[number]["id"],
        workspaceID: workspace.id,
        serviceAccountID: account.id,
        name: "Production",
        prefix: "bm_visible12",
        timeCreated: new Date("2026-08-13T00:00:00Z"),
      },
    ]
    installClient({
      serviceAccount: {
        get: vi.fn(async () => account),
        key: {
          list: vi.fn(async () => keys),
          create: vi.fn(async () => Promise.reject(new Error("unused"))),
          revoke: vi.fn(async () => undefined),
        },
      },
    })
    const history = createMemoryHistory()
    history.set({ value: `/w/${workspace.id}/gateway/service-accounts/${account.id}` })
    render(() => (
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route
            path="/w/:workspaceID/gateway/service-accounts/:serviceAccountID"
            component={() => (
              <WorkspaceScope list={[workspace]} current={workspace}>
                <DialogProvider>
                  <DataProvider>
                    <GatewayServiceAccountRoute />
                  </DataProvider>
                </DialogProvider>
              </WorkspaceScope>
            )}
          />
        </MemoryRouter>
      </SDKProvider>
    ))

    expect(await screen.findByRole("heading", { name: "Production inference" })).toBeInTheDocument()
    expect(screen.getByRole("table", { name: "API keys" })).toBeInTheDocument()
    expect(screen.getByRole("rowheader", { name: "Production" })).toBeInTheDocument()
    expect(screen.getByText("bm_visible12…")).toBeInTheDocument()
    expect(document.body.textContent).not.toContain("bm_secret")
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument()
  })

  it("toggles a model", async () => {
    const model: ModelListOutput[number] = {
      info: {
        id: "gpt-5.6",
        provider: Provider.OpenAI,
        apiID: "gpt-5.6",
        name: "GPT-5.6",
        description: "",
        status: "active",
        releaseDate: "2026-07-09",
        lastUpdated: "2026-07-09",
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
      isEffectiveDefault: true,
    }
    const toggles: boolean[] = []
    const [models, setModels] = createSignal([model])
    render(() => (
      <GatewayModelsPage
        items={models}
        state={() => ({ state: "ready" })}
        onRetry={async () => undefined}
        onToggle={async (_, enabled) => {
          toggles.push(enabled)
          setModels([{ ...model, enabled }])
        }}
      />
    ))
    expect(screen.getByRole("button", { name: "All providers" })).toBeInTheDocument()
    expect(
      document.querySelector(`[data-slot="model-provider"] img[src="${providerIcons.openai.url}"]`),
    ).toBeInTheDocument()
    expect(screen.queryByText("Default")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Actions for GPT-5.6" })).toBeInTheDocument()
    const toggle = screen.getByRole("switch", { name: "Enabled GPT-5.6" })
    await userEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enabled GPT-5.6" })).toBeEnabled())
    expect(toggles).toEqual([false])
  })

  it("switches the empty Models state to the Providers tab", async () => {
    const [tab, setTab] = createSignal<"models" | "providers">("models")
    render(() => (
      <GatewayModelsPage
        items={() => []}
        state={() => ({ state: "ready" })}
        onRetry={async () => undefined}
        onToggle={async () => undefined}
        tab={tab}
        onTabChange={setTab}
        providers={<p>Provider catalog</p>}
      />
    ))
    expect(screen.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true")
    await userEvent.type(screen.getByRole("tab", { name: "Models" }), "{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Providers" })).toHaveFocus()
    await userEvent.click(screen.getByRole("tab", { name: "Models" }))
    await userEvent.click(screen.getByRole("button", { name: "Connect provider" }))
    expect(screen.getByRole("tab", { name: "Providers" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Provider catalog")).toBeInTheDocument()
  })

  it("restores model controls after mutation failures", async () => {
    const model: ModelListOutput[number] = {
      info: {
        id: "gpt-5.6",
        provider: Provider.OpenAI,
        apiID: "gpt-5.6",
        name: "GPT-5.6",
        description: "",
        status: "active",
        releaseDate: "2026-07-09",
        lastUpdated: "2026-07-09",
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
      isEffectiveDefault: true,
    }
    const toggleRequest = Promise.withResolvers<never>()
    const { client } = render(() => (
      <GatewayModelsPage
        items={() => [model]}
        state={() => ({ state: "ready" })}
        onRetry={async () => undefined}
        onToggle={async () => toggleRequest.promise}
      />
    ))

    const toggle = screen.getByRole("switch", { name: "Enabled GPT-5.6" })
    await userEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    // Toggles stay interactive while a mutation is pending; the latest intent wins.
    expect(toggle).toBeEnabled()
    toggleRequest.reject(new Error("Toggle failed"))
    await waitFor(() => expect(toggle).toBeChecked())
    expect(screen.getByRole("alert")).toHaveTextContent(/^Could not disable GPT-5\.6: Toggle failed$/)
    expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe("error")
  })
})
