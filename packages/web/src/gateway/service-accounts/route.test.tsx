import {
  ByMorning,
  type BudgetStatusOutput,
  type ByMorningClient,
  type ServiceAccountKeyCreateOutput,
  type ServiceAccountKeyListOutput,
  type ServiceAccountListOutput,
} from "@bymorning/client"
import * as Workspace from "@bymorning/schema/workspace"
import * as WorkspaceAccess from "@bymorning/schema/workspace-access"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ParentProps } from "solid-js"

import { DataProvider } from "../../context/data"
import { DialogProvider } from "../../context/dialog"
import { SDKProvider, useSDK } from "../../context/sdk"
import { WorkspaceScope } from "../../context/workspace"
import { ServerProvider } from "../../runtime/server/runtime"
import { Toast, toaster } from "../../ui/components/toast"
import { GatewayServiceAccountRoute, GatewayServiceAccountsRoute } from "./route"

const workspace = WorkspaceAccess.Info.make({
  id: Workspace.ID.make("wrk_06689145a001WPprT0zKiRAQWn"),
  name: "Test",
  status: "active",
  role: "admin",
})
const accountID = "sva_06689145a001WPprT0zKiRAQWn" as ServiceAccountListOutput[number]["id"]
const otherAccountID = "sva_06689145a001WPprT0zKiRAQWo" as ServiceAccountListOutput[number]["id"]
const keyID = "apk_06689145a001WPprT0zKiRAQWn" as ServiceAccountKeyListOutput[number]["id"]
const secret = "bms_live_9f8e7d6c5b4a3f2e1d0c" as ServiceAccountKeyCreateOutput["secret"]
const clipboardProperty = Object.getOwnPropertyDescriptor(navigator, "clipboard")

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

describe("Gateway service account routes", () => {
  it("records status failures natively and allows a successful retry", async () => {
    const pending = Promise.withResolvers<ServiceAccountListOutput[number]>()
    const update = vi
      .fn<ByMorningClient["serviceAccount"]["update"]>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(account({ name: "Production inference", status: "suspended" }))
    const list = vi.fn(async () => [account({ name: "Production inference" })])
    installClient({ list, update })
    const { client } = renderRoutes("/w/wrk/gateway/service-accounts")
    const suspend = () =>
      screen.getAllByRole("menuitem", { hidden: true }).find((item) => item.textContent === "Suspend")!
    await screen.findByRole("link", { name: "Production inference" })
    await userEvent.click(screen.getByRole("button", { name: "Actions for Production inference" }))
    await userEvent.click(suspend())
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole("button", { name: "Actions for Production inference" }))
    await userEvent.click(suspend())
    expect(update).toHaveBeenCalledTimes(1)
    pending.reject(new Error("Status unavailable"))
    expect(await screen.findByText("Status unavailable")).toBeInTheDocument()
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe("error"))
    await userEvent.click(screen.getByRole("button", { name: "Actions for Production inference" }))
    await userEvent.click(suspend())
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenLastCalledWith({ workspace: workspace.id, id: accountID, status: "suspended" })
    expect(await screen.findByText("Service account suspended")).toBeInTheDocument()
  })

  it("retains the created secret when the subsequent key refresh fails", async () => {
    const keyCreate = vi.fn(async () => ({ key: key({ name: "Deploy" }), secret }))
    const keyList = vi
      .fn<ByMorningClient["serviceAccount"]["key"]["list"]>()
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error("Key refresh unavailable"))
    installClient({ get: vi.fn(async () => account({ name: "Production inference" })), keyList, keyCreate })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)
    await screen.findByRole("heading", { name: "Production inference" })
    await userEvent.click((await screen.findAllByRole("button", { name: "Create key" }))[0]!)
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Deploy")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))
    expect(await screen.findByRole("dialog", { name: "Copy your API key" })).toBeInTheDocument()
    expect(screen.getAllByDisplayValue(secret)).toHaveLength(1)
    expect(await screen.findByText("Key refresh unavailable")).toBeInTheDocument()
    expect(keyCreate).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() =>
      expect(getComputedStyle(screen.getByRole("button", { name: "Try again" })).pointerEvents).not.toBe("none"),
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(keyList).toHaveBeenCalledTimes(3))
    expect(keyCreate).toHaveBeenCalledTimes(1)
  })

  it("captures the account when opening a key dialog even if the route changes before submission", async () => {
    const keyCreate = vi.fn(async () => ({ key: key({ name: "Deploy" }), secret }))
    installClient({
      get: vi.fn(async (input) =>
        account({ id: input.id, name: input.id === accountID ? "Production inference" : "Batch export" }),
      ),
      keyCreate,
    })
    const { history } = renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)
    await screen.findByRole("heading", { name: "Production inference" })
    await userEvent.click((await screen.findAllByRole("button", { name: "Create key" }))[0]!)
    history.set({ value: `/w/wrk/gateway/service-accounts/${otherAccountID}` })
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Deploy")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))
    await waitFor(() =>
      expect(keyCreate).toHaveBeenCalledWith({ workspace: workspace.id, id: accountID, name: "Deploy" }),
    )
  })

  it("shows the loading state, then the accounts returned by the list catalog", async () => {
    const pending = Promise.withResolvers<ServiceAccountListOutput>()
    const list = vi.fn(() => pending.promise)
    installClient({ list })
    renderRoutes("/w/wrk/gateway/service-accounts")

    expect(screen.getByText("Loading service accounts…")).toBeInTheDocument()
    expect(document.querySelector("[data-service-account-list]")).toHaveAttribute("aria-busy", "true")
    await waitFor(() => expect(list).toHaveBeenCalledWith({ workspace: workspace.id }, expect.anything()))
    expect(screen.queryByRole("link", { name: "Production inference" })).not.toBeInTheDocument()

    pending.resolve([account({ name: "Production inference" }), account({ name: "Batch export", status: "suspended" })])
    expect(await screen.findByRole("link", { name: "Production inference" })).toHaveAttribute(
      "href",
      `/w/${workspace.id}/gateway/service-accounts/${accountID}`,
    )
    expect(screen.getByRole("link", { name: "Batch export" })).toHaveAttribute(
      "href",
      `/w/${workspace.id}/gateway/service-accounts/${otherAccountID}`,
    )
    expect(screen.queryByText("Loading service accounts…")).not.toBeInTheDocument()
    expect(document.querySelector("[data-service-account-list]")).toHaveAttribute("aria-busy", "false")
  })

  it("toasts a failed list load with a retry action that syncs the catalog", async () => {
    const list = vi
      .fn<ByMorningClient["serviceAccount"]["list"]>()
      .mockRejectedValueOnce(new Error("Service accounts offline"))
      .mockResolvedValue([account({ name: "Production inference" })])
    installClient({ list })
    renderRoutes("/w/wrk/gateway/service-accounts")

    expect(await screen.findByText("Service accounts offline")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("link", { name: "Production inference" })).toBeInTheDocument()
  })

  it("creates a key and, by default, a service account named after it in one step", async () => {
    const created = account({ name: "Claude Code", policy: {} })
    const create = vi.fn<ByMorningClient["serviceAccount"]["create"]>().mockResolvedValue(created)
    const keyCreate = vi
      .fn<ByMorningClient["serviceAccount"]["key"]["create"]>()
      .mockResolvedValue({ key: {} as never, secret })
    const list = vi
      .fn<ByMorningClient["serviceAccount"]["list"]>()
      .mockResolvedValueOnce([account({ name: "Production inference" })])
      .mockResolvedValue([account({ name: "Production inference" }), { ...created, keyCount: 1 }])
    installClient({ list, create, keyCreate })
    renderRoutes("/w/wrk/gateway/service-accounts")

    await screen.findByRole("link", { name: "Production inference" })
    await userEvent.click(screen.getByRole("button", { name: "Create API key" }))
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    // The key is the subject; the account is a secondary choice that defaults to a new one.
    expect(within(dialog).getByRole("textbox", { name: "Key name" })).toHaveFocus()
    expect(within(dialog).getByRole("button", { name: "New service account" })).toBeInTheDocument()
    expect(dialog).toHaveTextContent("A service account with the same name will hold this key.")
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Claude Code")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ workspace: workspace.id, name: "Claude Code", policy: {} }),
    )
    await waitFor(() =>
      expect(keyCreate).toHaveBeenCalledWith({ workspace: workspace.id, id: created.id, name: "Claude Code" }),
    )
    expect(await screen.findByRole("dialog", { name: "Copy your API key" })).toBeInTheDocument()
    expect(await screen.findByText("API key created")).toBeInTheDocument()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it("attaches a key to an existing service account when one is chosen", async () => {
    const existing = account({ name: "Production inference" })
    const create = vi.fn<ByMorningClient["serviceAccount"]["create"]>()
    const keyCreate = vi
      .fn<ByMorningClient["serviceAccount"]["key"]["create"]>()
      .mockResolvedValue({ key: {} as never, secret })
    installClient({ list: vi.fn(async () => [existing]), create, keyCreate })
    renderRoutes("/w/wrk/gateway/service-accounts")

    await screen.findByRole("link", { name: "Production inference" })
    await userEvent.click(screen.getByRole("button", { name: "Create API key" }))
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Deploy")
    await userEvent.click(within(dialog).getByRole("button", { name: "New service account" }))
    await userEvent.click(screen.getByRole("option", { name: "Production inference", hidden: true }))
    expect(dialog).not.toHaveTextContent("A service account with the same name")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))

    await waitFor(() =>
      expect(keyCreate).toHaveBeenCalledWith({ workspace: workspace.id, id: existing.id, name: "Deploy" }),
    )
    expect(create).not.toHaveBeenCalled()
    expect(await screen.findByRole("dialog", { name: "Copy your API key" })).toBeInTheDocument()
  })

  it("creates a service account on its own from the secondary action", async () => {
    const created = account({ name: "Unrestricted inference", policy: {} })
    const create = vi.fn<ByMorningClient["serviceAccount"]["create"]>().mockResolvedValue(created)
    const list = vi
      .fn<ByMorningClient["serviceAccount"]["list"]>()
      .mockResolvedValueOnce([account({ name: "Production inference" })])
      .mockResolvedValue([account({ name: "Production inference" }), created])
    const budgetStatusRead = vi.fn<ByMorningClient["budget"]["status"]>(async () => budgetStatus())
    installClient({ list, create, budgetStatus: budgetStatusRead })
    renderRoutes("/w/wrk/gateway/service-accounts")

    await screen.findByRole("link", { name: "Production inference" })
    await waitFor(() => expect(budgetStatusRead).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole("button", { name: "New service account" }))
    const dialog = screen.getByRole("dialog", { name: "New service account" })
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Service account name" }),
      "Unrestricted inference",
    )
    await userEvent.click(within(dialog).getByRole("button", { name: "Create service account" }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ workspace: workspace.id, name: "Unrestricted inference", policy: {} }),
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(await screen.findByText("Service account created")).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "Unrestricted inference" })).toBeInTheDocument()
    // Budget standings list service accounts too, so they refresh with the account list.
    await waitFor(() => expect(budgetStatusRead).toHaveBeenCalledTimes(2))
  })

  it("waits for the account read before fetching keys, then renders both", async () => {
    const pending = Promise.withResolvers<ServiceAccountListOutput[number]>()
    const get = vi.fn(() => pending.promise)
    const keyList = vi.fn(async () => [key({ name: "Production" })])
    installClient({ get, keyList })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)

    expect(screen.getByText("Loading service account…")).toBeInTheDocument()
    await waitFor(() => expect(get).toHaveBeenCalledWith({ workspace: workspace.id, id: accountID }, expect.anything()))
    expect(keyList).not.toHaveBeenCalled()

    pending.resolve(account({ name: "Production inference", keyCount: 1 }))
    expect(await screen.findByRole("heading", { name: "Production inference" })).toBeInTheDocument()
    await waitFor(() => expect(keyList).toHaveBeenCalledTimes(1))
    expect(keyList).toHaveBeenCalledWith({ workspace: workspace.id, id: accountID }, expect.anything())
    expect(screen.getByRole("table", { name: "API keys" })).toBeInTheDocument()
    expect(screen.getByRole("rowheader", { name: "Production" })).toBeInTheDocument()
  })

  it("renders the not-found state for a not-found account without a retry toast", async () => {
    const get = vi.fn(async () => Promise.reject(new Error(`Service account resource not found: ${accountID}`)))
    const keyList = vi.fn(async () => [] satisfies ServiceAccountKeyListOutput)
    installClient({ get, keyList })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)

    expect(await screen.findByRole("heading", { name: "Service account not found" })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="service-account-not-found"]')).toHaveTextContent(
      "The requested service account could not be found.",
    )
    expect(screen.queryByText(`Service account resource not found: ${accountID}`)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()
    expect(keyList).not.toHaveBeenCalled()
  })

  it("creates a key, shows its secret once with a working copy action, and clears it on close", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const keyCreate = vi.fn(async () => ({
      key: key({ name: "Deploy" }),
      secret,
    }))
    const keyList = vi
      .fn<ByMorningClient["serviceAccount"]["key"]["list"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([key({ name: "Deploy" })])
    installClient({
      get: vi.fn(async () => account({ name: "Production inference", keyCount: 1 })),
      keyList,
      keyCreate,
    })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)

    await screen.findByRole("heading", { name: "Production inference" })
    // The header action and the empty-state button both open the same create-key dialog.
    const openers = await screen.findAllByRole("button", { name: "Create key" })
    await userEvent.click(openers[0]!)
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Deploy")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))

    await waitFor(() =>
      expect(keyCreate).toHaveBeenCalledWith({ workspace: workspace.id, id: accountID, name: "Deploy" }),
    )
    await waitFor(() => expect(keyList).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("dialog", { name: "Copy your API key" })).toBeInTheDocument()
    expect(screen.getByDisplayValue(secret)).toBeInTheDocument()
    expect(screen.getAllByDisplayValue(secret)).toHaveLength(1)
    expect(await screen.findByText("API key created")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Copy API key" }))
    expect(writeText).toHaveBeenCalledWith(secret)
    expect(await screen.findByText("API key copied")).toBeInTheDocument()

    // The reveal is the only moment the secret exists, so client configuration lives here with it filled in.
    expect(screen.getByRole("heading", { name: "Connect a client" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("tab", { name: "Claude Code" }))
    const config = document.querySelector('[data-slot="connect-config"]')!
    expect(config.textContent).toContain("/inference/anthropic")
    expect(config.textContent).toContain(`ANTHROPIC_AUTH_TOKEN="${secret}"`)
    await userEvent.click(screen.getByRole("button", { name: "Copy configuration" }))
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(secret))

    await userEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Copy your API key" })).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(secret)
    expect(screen.getByRole("rowheader", { name: "Deploy" })).toBeInTheDocument()
  })

  it("warns instead of closing the one-time key reveal on Escape and closes on a second Escape", async () => {
    const keyCreate = vi.fn(async () => ({ key: key({ name: "Deploy" }), secret }))
    installClient({ get: vi.fn(async () => account({ name: "Production inference" })), keyCreate })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)
    await screen.findByRole("heading", { name: "Production inference" })
    await userEvent.click((await screen.findAllByRole("button", { name: "Create key" }))[0]!)
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Deploy")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))
    expect(await screen.findByRole("dialog", { name: "Copy your API key" })).toBeInTheDocument()

    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("dialog", { name: "Copy your API key" })).toBeInTheDocument()
    expect(screen.getByText(/won't be shown again. Copy it now/)).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Copy your API key" })).not.toBeInTheDocument())
  })

  it("rejects an expiry date in the past", async () => {
    const keyCreate = vi.fn(async () => ({ key: key({ name: "Deploy" }), secret }))
    installClient({ get: vi.fn(async () => account({ name: "Production inference" })), keyCreate })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)
    await screen.findByRole("heading", { name: "Production inference" })
    await userEvent.click((await screen.findAllByRole("button", { name: "Create key" }))[0]!)
    const dialog = screen.getByRole("dialog", { name: "Create API key" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Key name" }), "Deploy")
    await userEvent.type(dialog.querySelector('input[type="date"]')!, "2020-01-01")
    await userEvent.click(within(dialog).getByRole("button", { name: "Create key" }))
    expect(await within(dialog).findByText("Choose an expiry date in the future.")).toBeInTheDocument()
    expect(keyCreate).not.toHaveBeenCalled()
  })

  it("offers Revoke for an expired key", async () => {
    installClient({
      get: vi.fn(async () => account({ name: "Production inference", keyCount: 1 })),
      keyList: vi.fn(async () => [key({ name: "Old", timeExpires: new Date("2020-01-01T00:00:00Z") })]),
    })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)
    await screen.findByRole("rowheader", { name: "Old" })
    expect(screen.getByText("Expired")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument()
  })

  it("revokes a key after confirmation and refetches the key list", async () => {
    const keyRevoke = vi.fn(async () => undefined)
    const keyList = vi
      .fn<ByMorningClient["serviceAccount"]["key"]["list"]>()
      .mockResolvedValueOnce([key({ name: "Production" })])
      .mockResolvedValue([key({ name: "Production", timeRevoked: new Date("2026-09-04T00:00:00Z") })])
    installClient({
      get: vi.fn(async () => account({ name: "Production inference", keyCount: 1 })),
      keyList,
      keyRevoke,
    })
    renderRoutes(`/w/wrk/gateway/service-accounts/${accountID}`)

    await screen.findByRole("rowheader", { name: "Production" })
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }))
    const confirm = screen.getByRole("dialog", { name: "Revoke API key?" })
    expect(confirm).toHaveTextContent("Revoke Production? Requests using it will immediately fail.")
    await userEvent.click(within(confirm).getByRole("button", { name: "Revoke" }))

    await waitFor(() => expect(keyRevoke).toHaveBeenCalledWith({ workspace: workspace.id, id: accountID, keyID }))
    await waitFor(() => expect(keyList).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("API key revoked")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByText("Revoked")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument()
  })

  it("renders the invalid-ID fallback without reading the account", async () => {
    const get = vi.fn(async () => account({ name: "Production inference" }))
    const keyList = vi.fn(async () => [] satisfies ServiceAccountKeyListOutput)
    installClient({ get, keyList })
    renderRoutes("/w/wrk/gateway/service-accounts/wrk_06689145a001WPprT0zKiRAQWn")

    expect(await screen.findByRole("heading", { name: "Invalid service account" })).toBeInTheDocument()
    expect(screen.getByText("This service account URL is not valid.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to service accounts" })).toHaveAttribute(
      "href",
      `/w/${workspace.id}/gateway/service-accounts`,
    )
    expect(get).not.toHaveBeenCalled()
    expect(keyList).not.toHaveBeenCalled()
  })
})

function account(
  input: Partial<ServiceAccountListOutput[number]> & Pick<ServiceAccountListOutput[number], "name">,
): ServiceAccountListOutput[number] {
  return {
    id: input.name === "Unrestricted inference" || input.name === "Batch export" ? otherAccountID : accountID,
    workspaceID: workspace.id,
    status: "active",
    policy: {},
    keyCount: 0,
    timeCreated: new Date("2026-08-12T00:00:00Z"),
    timeUpdated: new Date("2026-08-12T00:00:00Z"),
    ...input,
  }
}

function key(
  input: Partial<ServiceAccountKeyListOutput[number]> & Pick<ServiceAccountKeyListOutput[number], "name">,
): ServiceAccountKeyListOutput[number] {
  return {
    id: keyID,
    workspaceID: workspace.id,
    serviceAccountID: accountID,
    prefix: "bm_visible12",
    timeCreated: new Date("2026-08-13T00:00:00Z"),
    ...input,
  }
}

function budgetStatus(): BudgetStatusOutput {
  return {
    period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
    standings: [
      {
        target: { type: "workspace" },
        holder: "workspace" as BudgetStatusOutput["standings"][number]["holder"],
        period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
        spent: 4.25,
        limit: 100,
      },
      {
        target: { type: "service_account", serviceAccountID: accountID },
        holder: accountID as unknown as BudgetStatusOutput["standings"][number]["holder"],
        period: { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") },
        spent: 1.25,
        limit: 50,
      },
    ],
  }
}

function installClient(input: {
  readonly list?: ByMorningClient["serviceAccount"]["list"]
  readonly get?: ByMorningClient["serviceAccount"]["get"]
  readonly create?: ByMorningClient["serviceAccount"]["create"]
  readonly update?: ByMorningClient["serviceAccount"]["update"]
  readonly keyList?: ByMorningClient["serviceAccount"]["key"]["list"]
  readonly keyCreate?: ByMorningClient["serviceAccount"]["key"]["create"]
  readonly keyRevoke?: ByMorningClient["serviceAccount"]["key"]["revoke"]
  readonly budgetStatus?: ByMorningClient["budget"]["status"]
}) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    budget: {
      ...base.budget,
      status: input.budgetStatus ?? vi.fn(async () => budgetStatus()),
    },
    serviceAccount: {
      list: input.list ?? vi.fn(async () => [] satisfies ServiceAccountListOutput),
      get: input.get ?? vi.fn(async () => Promise.reject(new Error("unused"))),
      create: input.create ?? vi.fn(async () => Promise.reject(new Error("unused"))),
      update: input.update ?? vi.fn(async () => Promise.reject(new Error("unused"))),
      remove: vi.fn(async () => undefined),
      key: {
        list: input.keyList ?? vi.fn(async () => [] satisfies ServiceAccountKeyListOutput),
        create: input.keyCreate ?? vi.fn(async () => Promise.reject(new Error("unused"))),
        revoke: input.keyRevoke ?? vi.fn(async () => undefined),
      },
    },
  } as ByMorningClient)
}

function Providers(props: ParentProps) {
  const sdk = useSDK()
  return (
    <ServerProvider scope={{ origin: sdk.baseURL, identity: "test", workspace: workspace.id, api: sdk.client }}>
      <DataProvider>{props.children}</DataProvider>
    </ServerProvider>
  )
}

function renderRoutes(path: string) {
  const client = new QueryClient()
  const history = createMemoryHistory()
  history.set({ value: path })
  render(() => (
    <QueryClientProvider client={client}>
      <SDKProvider>
        <MemoryRouter history={history}>
          <Route
            path="/w/:workspaceID/gateway/service-accounts"
            component={() => (
              <WorkspaceScope list={[workspace]} current={workspace}>
                <DialogProvider>
                  <Providers>
                    <Toast.Region />
                    <GatewayServiceAccountsRoute />
                  </Providers>
                </DialogProvider>
              </WorkspaceScope>
            )}
          />
          <Route
            path="/w/:workspaceID/gateway/service-accounts/:serviceAccountID"
            component={() => (
              <WorkspaceScope list={[workspace]} current={workspace}>
                <DialogProvider>
                  <Providers>
                    <Toast.Region />
                    <GatewayServiceAccountRoute />
                  </Providers>
                </DialogProvider>
              </WorkspaceScope>
            )}
          />
        </MemoryRouter>
      </SDKProvider>
    </QueryClientProvider>
  ))
  return { client, history }
}
