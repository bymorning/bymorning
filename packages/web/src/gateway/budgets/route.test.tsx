import { ByMorning, type BudgetLimitOutput, type BudgetStatusOutput, type ByMorningClient } from "@bymorning/client"
import type { ServiceAccountListOutput } from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import userEvent from "@testing-library/user-event"
import { createSignal, type ParentProps } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { DataProvider } from "../../context/data"
import { DialogProvider } from "../../context/dialog"
import { SDKProvider, useSDK } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { ServerProvider } from "../../runtime/server/runtime"
import { GatewayBudgetsPage, GatewayBudgetsRoute } from "./route"
import * as toast from "../../ui/components/toast"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.make("wrk_06689145a001WPprT0zKiRAQWn"),
  name: "Test",
  status: "active",
  role: "admin",
})
const alphaID = "sva_06689145a001WPprT0zKiRAQWn" as ServiceAccountListOutput[number]["id"]
const betaID = "sva_06689145a001WPprT0zKiRAQWo" as ServiceAccountListOutput[number]["id"]
const account = (name: string, id: ServiceAccountListOutput[number]["id"]): ServiceAccountListOutput[number] => ({
  id,
  workspaceID: workspace.id,
  name,
  status: "active",
  policy: { models: ["gpt-5"], rpm: 60, tpm: 10000 },
  keyCount: 0,
  timeCreated: new Date(),
  timeUpdated: new Date(),
})
const alpha = account("Alpha", alphaID)
const beta = account("Beta", betaID)

function statusFixture(): BudgetStatusOutput {
  return {
    period: { start: new Date("2026-09-01"), end: new Date("2026-10-01") },
    standings: [
      {
        target: { type: "workspace" },
        holder: "workspace" as unknown as BudgetStatusOutput["standings"][number]["holder"],
        period: { start: new Date("2026-09-01"), end: new Date("2026-10-01") },
        spent: 12,
        limit: 100,
      },
      {
        target: { type: "service_account", serviceAccountID: alphaID },
        holder: alphaID as unknown as BudgetStatusOutput["standings"][number]["holder"],
        period: { start: new Date("2026-09-01"), end: new Date("2026-10-01") },
        spent: 4,
        limit: 100,
      },
      {
        target: { type: "service_account", serviceAccountID: betaID },
        holder: betaID as unknown as BudgetStatusOutput["standings"][number]["holder"],
        period: { start: new Date("2026-09-01"), end: new Date("2026-10-01") },
        spent: 4,
        limit: 100,
      },
    ],
  }
}

function fixture(limit: ByMorningClient["budget"]["limit"], limitMock?: ByMorningClient["budget"]["limit"]) {
  const status = statusFixture()
  const read = vi.fn(async () => structuredClone(status))
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    budget: { ...base.budget, status: read, limit },
    serviceAccount: { ...base.serviceAccount, list: vi.fn(async () => [alpha, beta]) },
    user: { ...base.user, list: vi.fn(async () => ({ role: "admin" as const, members: [] })) },
  })
  const client = new QueryClient()
  function Providers(props: ParentProps) {
    const sdk = useSDK()
    return (
      <ServerProvider scope={{ origin: sdk.baseURL, identity: "test", workspace: workspace.id, api: sdk.client }}>
        <DataProvider>{props.children}</DataProvider>
      </ServerProvider>
    )
  }
  render(() => (
    <QueryClientProvider client={client}>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <Providers>
            <DialogProvider>
              <GatewayBudgetsRoute />
            </DialogProvider>
          </Providers>
        </WorkspaceScope>
      </SDKProvider>
    </QueryClientProvider>
  ))
  return { client, read, status, limit: limitMock ?? limit }
}

const confirmRemoval = async () =>
  userEvent.click(
    within(await screen.findByRole("dialog", { name: "Remove limit?" })).getByRole("button", { name: "Remove" }),
  )

it("keeps concurrent account requests independent through a sibling refresh and retains native rejection", async () => {
  const alpha = Promise.withResolvers<BudgetLimitOutput>()
  const beta = Promise.withResolvers<BudgetLimitOutput>()
  const limit = vi
    .fn<ByMorningClient["budget"]["limit"]>()
    .mockImplementationOnce(() => alpha.promise)
    .mockImplementationOnce(() => beta.promise)
    .mockResolvedValue(statusFixture().standings[1]!)
  const { client, read } = fixture(limit)
  await userEvent.click(await screen.findByRole("button", { name: "Edit limit for Alpha" }))
  await userEvent.click(screen.getByRole("button", { name: "Edit limit for Beta" }))
  const alphaForm = screen.getByRole("textbox", { name: "Alpha monthly limit (USD)" }).closest("form")!
  const betaForm = screen.getByRole("textbox", { name: "Beta monthly limit (USD)" }).closest("form")!
  // Two same-tick submits still admit only one request for Alpha.
  fireEvent.submit(alphaForm)
  fireEvent.submit(alphaForm)
  fireEvent.submit(betaForm)
  await waitFor(() => expect(limit).toHaveBeenCalledTimes(2))
  expect(limit).toHaveBeenNthCalledWith(1, {
    workspace: workspace.id,
    target: { type: "service_account", serviceAccountID: alphaID },
    amount: 100,
  })
  expect(limit).toHaveBeenNthCalledWith(2, {
    workspace: workspace.id,
    target: { type: "service_account", serviceAccountID: betaID },
    amount: 100,
  })
  expect(within(alphaForm).getByRole("button", { name: "Saving…" })).toBeDisabled()
  expect(within(betaForm).getByRole("button", { name: "Saving…" })).toBeDisabled()
  alpha.resolve(statusFixture().standings[1]!)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole("button", { name: "Edit limit for Alpha" })).toBeInTheDocument()
  expect(within(betaForm).getByRole("button", { name: "Saving…" })).toBeDisabled()
  beta.reject(new Error("Beta unavailable"))
  expect(await within(betaForm).findByRole("alert")).toHaveTextContent("Beta unavailable")
  expect(
    client
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state.status),
  ).toEqual(["success", "error"])
  expect(screen.getAllByRole("alert")).toHaveLength(1)
  await userEvent.click(within(betaForm).getByRole("button", { name: "Save" }))
  await waitFor(() => expect(limit).toHaveBeenCalledTimes(3))
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
})

it("validates without a write and removes once without also submitting the draft", async () => {
  const limit = vi.fn<ByMorningClient["budget"]["limit"]>().mockResolvedValue(statusFixture().standings[1]!)
  const { client } = fixture(limit)
  await userEvent.click(await screen.findByRole("button", { name: "Edit limit for Alpha" }))
  const input = screen.getByRole("textbox", { name: "Alpha monthly limit (USD)" })
  const form = input.closest("form")!
  fireEvent.input(input, { target: { value: "-1" } })
  fireEvent.submit(form)
  expect(within(form).getByRole("alert")).toBeInTheDocument()
  expect(limit).not.toHaveBeenCalled()
  expect(client.getMutationCache().getAll()).toHaveLength(0)
  fireEvent.input(input, { target: { value: "99" } })
  const submit = vi.fn()
  form.addEventListener("submit", submit)
  await userEvent.click(within(form).getByRole("button", { name: "Remove" }))
  await confirmRemoval()
  await waitFor(() => expect(limit).toHaveBeenCalledTimes(1))
  expect(submit).not.toHaveBeenCalled()
  expect(limit).toHaveBeenCalledWith({
    workspace: workspace.id,
    target: { type: "service_account", serviceAccountID: alphaID },
  })
})

it("keeps a committed workspace removal successful when refreshing fails", async () => {
  const limit = vi.fn<ByMorningClient["budget"]["limit"]>().mockResolvedValue(statusFixture().standings[0]!)
  const { client, read, limit: limitMock } = fixture(limit)
  await screen.findByRole("button", { name: "Edit limit for Workspace" })
  read.mockRejectedValue(new Error("Refresh unavailable"))
  await userEvent.click(screen.getByRole("button", { name: "Remove limit for Workspace" }))
  await confirmRemoval()
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  expect(limitMock).toHaveBeenCalledExactlyOnceWith({ workspace: workspace.id, target: { type: "workspace" } })
  expect(client.getMutationCache().getAll()[0]?.state.status).toBe("success")
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("does not turn a throwing post-commit presentation callback into a native write failure", async () => {
  const limit = vi.fn<ByMorningClient["budget"]["limit"]>().mockResolvedValue(statusFixture().standings[0]!)
  const { client, limit: limitMock } = fixture(limit)
  await screen.findByRole("button", { name: "Remove limit for Workspace" })
  const cause = new Error("Presentation unavailable")
  vi.spyOn(toast, "showToast").mockImplementationOnce(() => {
    throw cause
  })
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined)
  await userEvent.click(screen.getByRole("button", { name: "Remove limit for Workspace" }))
  await confirmRemoval()
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe("success"))
  expect(report).toHaveBeenCalledWith(cause)
  expect(limitMock).toHaveBeenCalledExactlyOnceWith({ workspace: workspace.id, target: { type: "workspace" } })
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("refreshes the captured workspace without closing the new workspace's editor", async () => {
  const status = statusFixture()
  const catalog = () => ({
    list: () => structuredClone(status),
    state: () => ({ state: "ready" as const, refreshedAt: 0 }),
    sync: vi.fn(async () => undefined),
    invalidate: vi.fn(),
  })
  const oldCatalog = catalog()
  const newCatalog = catalog()
  // Side catalogs carry no observable refresh bookkeeping so only the budget catalog's
  // refresh behavior is compared across the workspace switch.
  const side = () => ({
    list: () => undefined as never,
    state: () => ({ state: "ready" as const, refreshedAt: 0 }),
    sync: vi.fn(async () => undefined),
    invalidate: vi.fn(),
  })
  const [scope, setScope] = createSignal({ workspace: workspace.id, budget: oldCatalog })
  const pending = Promise.withResolvers<BudgetLimitOutput>()
  const limit = vi.fn<ByMorningClient["budget"]["limit"]>(() => pending.promise)
  const client = new QueryClient()
  render(() => (
    <QueryClientProvider client={client}>
      <DialogProvider>
        <GatewayBudgetsPage
          workspace={scope().workspace}
          budget={scope().budget}
          serviceAccount={side()}
          member={side()}
          budgetClient={{ limit }}
        />
      </DialogProvider>
    </QueryClientProvider>
  ))
  await userEvent.click(screen.getByRole("button", { name: "Remove limit for Workspace" }))
  await confirmRemoval()
  await waitFor(() => expect(limit).toHaveBeenCalledTimes(1))
  setScope({ workspace: Workspace.ID.make("wrk_06689145a001WPprT0zKiRAQWp"), budget: newCatalog })
  // The pending confirmation dialog is modal and cannot be dismissed mid-request, so a user reaches
  // the new workspace's page once the removal settles and the dialog closes.
  pending.resolve(status.standings[0]!)
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe("success"))
  await userEvent.click(screen.getByRole("button", { name: "Edit limit for Workspace" }))
  const input = screen.getByRole("textbox", { name: "Workspace monthly limit (USD)" })
  await userEvent.clear(input)
  await userEvent.type(input, "88")
  expect(input).toHaveValue("88")
  expect(oldCatalog.invalidate).toHaveBeenCalledTimes(1)
  expect(oldCatalog.sync).toHaveBeenCalledTimes(2)
  expect(newCatalog.invalidate).not.toHaveBeenCalled()
  expect(newCatalog.sync).not.toHaveBeenCalled()
  expect(limit).toHaveBeenCalledExactlyOnceWith({ workspace: workspace.id, target: { type: "workspace" } })
})

it("asks for confirmation before removing a limit and keeps it when cancelled", async () => {
  const limit = vi.fn<ByMorningClient["budget"]["limit"]>().mockResolvedValue(statusFixture().standings[0]!)
  fixture(limit)
  await userEvent.click(await screen.findByRole("button", { name: "Remove limit for Workspace" }))
  const dialog = await screen.findByRole("dialog", { name: "Remove limit?" })
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(limit).not.toHaveBeenCalled()
})

it("marks spending beyond the limit as over limit instead of a capped green percentage", async () => {
  const limit = vi.fn<ByMorningClient["budget"]["limit"]>()
  const status = statusFixture()
  const read = vi.fn(async () => ({
    ...status,
    standings: [{ ...status.standings[0]!, spent: 0.18, limit: 0.05 }, ...status.standings.slice(1)],
  }))
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    budget: { ...base.budget, status: read, limit },
    serviceAccount: { ...base.serviceAccount, list: vi.fn(async () => [alpha, beta]) },
    user: { ...base.user, list: vi.fn(async () => ({ role: "admin" as const, members: [] })) },
  })
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <ServerProviderForTest>
            <DialogProvider>
              <GatewayBudgetsRoute />
            </DialogProvider>
          </ServerProviderForTest>
        </WorkspaceScope>
      </SDKProvider>
    </QueryClientProvider>
  ))
  const badge = await screen.findByText("Over limit · 360% used")
  expect(badge).toHaveAttribute("data-state", "over")
  expect(screen.getByRole("progressbar", { name: /Workspace limit used \(over limit\)/ })).toHaveAttribute(
    "data-state",
    "over",
  )
})

it("reads a $0 limit with no spend as no room rather than fully used", async () => {
  const status = statusFixture()
  const read = vi.fn(async () => ({
    ...status,
    standings: [{ ...status.standings[0]!, spent: 0, limit: 0 }, ...status.standings.slice(1)],
  }))
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    budget: { ...base.budget, status: read },
    serviceAccount: { ...base.serviceAccount, list: vi.fn(async () => [alpha, beta]) },
    user: { ...base.user, list: vi.fn(async () => ({ role: "admin" as const, members: [] })) },
  })
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <SDKProvider>
        <WorkspaceScope list={[workspace]} current={workspace}>
          <ServerProviderForTest>
            <DialogProvider>
              <GatewayBudgetsRoute />
            </DialogProvider>
          </ServerProviderForTest>
        </WorkspaceScope>
      </SDKProvider>
    </QueryClientProvider>
  ))
  const badge = await screen.findByText("No room")
  expect(badge).not.toHaveAttribute("data-state", "over")
  expect(screen.queryByText("100% used")).not.toBeInTheDocument()
  expect(screen.getByRole("progressbar", { name: /Workspace limit used/ })).toHaveAttribute("value", "0")
})

function ServerProviderForTest(props: ParentProps) {
  const sdk = useSDK()
  return (
    <ServerProvider scope={{ origin: sdk.baseURL, identity: "test", workspace: workspace.id, api: sdk.client }}>
      <DataProvider>{props.children}</DataProvider>
    </ServerProvider>
  )
}

it("focuses the amount with its value selected when editing starts", async () => {
  fixture(vi.fn<ByMorningClient["budget"]["limit"]>())
  await userEvent.click(await screen.findByRole("button", { name: "Edit limit for Workspace" }))
  const input = await screen.findByRole<HTMLInputElement>("textbox", { name: /Workspace monthly limit/ })
  expect(input).toHaveFocus()
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(input.value.length)
})
