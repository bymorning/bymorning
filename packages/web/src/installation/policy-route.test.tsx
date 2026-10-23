import { ByMorning } from "@bymorning/client"
import { cleanup, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { SDKProvider } from "../context/sdk"
import { Toast, toaster } from "../ui/components/toast"
import { renderForm as render } from "../ui/form-query.test-support"
import { InstallationProvider } from "./model"
import { InstallationPolicyPage } from "./policy-route"

function mount() {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const update = vi.fn().mockImplementation(async (policy: unknown) => policy)
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    installation: {
      ...base.installation,
      self: vi.fn().mockResolvedValue({ admin: true }),
      policy: { ...base.installation.policy, get: vi.fn().mockResolvedValue({}), update },
    },
  })
  render(() => (
    <SDKProvider>
      <InstallationProvider>
        <InstallationPolicyPage />
      </InstallationProvider>
      <Toast.Region />
    </SDKProvider>
  ))
  return { update }
}

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

it("keeps Save policy disabled until something changes", async () => {
  const { update } = mount()
  const save = await screen.findByRole("button", { name: "Save policy" })
  expect(save).toBeDisabled()

  await userEvent.type(screen.getByRole("textbox", { name: "Invitation domains" }), "example.com")
  expect(save).toBeEnabled()
  await userEvent.click(save)
  expect(update).toHaveBeenCalledOnce()
  expect(await screen.findByRole("button", { name: "Save policy" })).toBeDisabled()
})

it("rejects an invalid invitation domain before saving", async () => {
  const { update } = mount()
  await userEvent.type(await screen.findByRole("textbox", { name: "Invitation domains" }), "not a domain!!")

  expect(await screen.findByRole("alert")).toHaveTextContent("is not a valid email domain")
  expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled()
  expect(update).not.toHaveBeenCalled()
})

it("warns that an empty plugin allowlist blocks every plugin", async () => {
  mount()
  await userEvent.click(await screen.findByRole("radio", { name: /Allowlist/ }))

  expect(await screen.findByRole("alert")).toHaveTextContent("An empty allowlist blocks every Plugin")
  await userEvent.type(screen.getByRole("textbox", { name: "Plugin allowlist" }), "@bymorning/plugin-share")
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
