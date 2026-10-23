import { ByMorning } from "@bymorning/client"
import { cleanup, render, screen } from "@solidjs/testing-library"
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { AccountProvider } from "../context/account"
import { SDKProvider } from "../context/sdk"
import { Toast, toaster } from "../ui/components/toast"
import { InstallationProvider } from "./model"
import { InstallationPage } from "./route"

const existing = "acc_existing"

function mount() {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const grant = vi.fn().mockResolvedValue({ admins: [existing, "acc_new"] })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    account: { ...base.account, get: vi.fn().mockResolvedValue({ id: existing }) },
    installation: {
      ...base.installation,
      self: vi.fn().mockResolvedValue({ admin: true }),
      admin: { ...base.installation.admin, list: vi.fn().mockResolvedValue({ admins: [existing] }), grant },
    },
  } as never)
  const history = createMemoryHistory()
  history.set({ value: "/" })
  render(() => (
    <SDKProvider>
      <MemoryRouter history={history}>
        <Route
          path="/"
          component={() => (
            <AccountProvider>
              <InstallationProvider>
                <InstallationPage />
              </InstallationProvider>
              <Toast.Region />
            </AccountProvider>
          )}
        />
      </MemoryRouter>
    </SDKProvider>
  ))
  return { grant }
}

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

it("explains the account ID format instead of sending a malformed grant", async () => {
  const { grant } = mount()
  await userEvent.type(await screen.findByRole("textbox", { name: "Account ID" }), "bogus")
  await userEvent.click(screen.getByRole("button", { name: "Grant admin" }))

  expect(await screen.findByText("Enter an account ID like acc_…")).toBeInTheDocument()
  expect(grant).not.toHaveBeenCalled()
})

it("grants an account ID with the acc_ prefix", async () => {
  const { grant } = mount()
  await userEvent.type(await screen.findByRole("textbox", { name: "Account ID" }), "acc_new")
  await userEvent.click(screen.getByRole("button", { name: "Grant admin" }))

  expect(grant).toHaveBeenCalledWith({ accountID: "acc_new" })
  expect(await screen.findByText("Installation Admin granted")).toBeInTheDocument()
})
