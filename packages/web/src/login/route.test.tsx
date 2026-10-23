import { ByMorning, type AuthMethodOutput, type ByMorningClient } from "@bymorning/client"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import { SDKProvider } from "../context/sdk"
import { failureHints, LoginRoute } from "./route"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Ready = Extract<AuthMethodOutput, { state: "ready" }>
type ProviderID = Ready["providers"][number]["id"]

function mockMethod(method: AuthMethodOutput | Error) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const run: ByMorningClient["auth"]["method"] =
    method instanceof Error ? async () => Promise.reject(method) : async () => method
  vi.spyOn(ByMorning, "make").mockReturnValue({ ...base, auth: { ...base.auth, method: vi.fn(run) } })
}

const mount = (path = "/") => {
  const history = createMemoryHistory()
  history.set({ value: path })
  return render(() => (
    <SDKProvider>
      <MemoryRouter history={history}>
        <Route path="/" component={LoginRoute} />
      </MemoryRouter>
    </SDKProvider>
  ))
}

test("shows loading status while sign-in options are pending", () => {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const pending: ByMorningClient["auth"]["method"] = () => new Promise(() => {})
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    auth: { ...base.auth, method: vi.fn(pending) },
  })
  mount()
  expect(screen.getByRole("status")).toHaveTextContent("Loading sign-in options…")
})

test("renders a neutral fallback action when inventory is unavailable", async () => {
  mockMethod(new Error("unavailable"))
  mount()
  expect(await screen.findByRole("link", { name: "Continue" })).toHaveAttribute(
    "href",
    expect.stringContaining("/auth/login"),
  )
})

test("continues locally without the sign-in card when local login is the only method", async () => {
  const replace = vi.fn()
  vi.stubGlobal("location", { replace, origin: "http://localhost", href: "http://localhost/" })
  mockMethod({
    state: "ready",
    callbackBase: "http://localhost/auth/callback",
    providers: [],
    local: true,
  })
  mount()
  expect(await screen.findByRole("status")).toHaveTextContent("Loading sign-in options…")
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("http://localhost/auth/login"))
  expect(screen.queryByRole("heading", { name: "Welcome back" })).not.toBeInTheDocument()
  expect(screen.queryByRole("link", { name: "Continue locally" })).not.toBeInTheDocument()
})

test("keeps the fallback action after a failed attempt", async () => {
  const replace = vi.fn()
  vi.stubGlobal("location", { replace, origin: "http://localhost", href: "http://localhost/" })
  mockMethod(new Error("unavailable"))
  mount("/?auth=failed")
  expect(await screen.findByRole("link", { name: "Continue" })).toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})

test("lists enabled providers with per-provider login links and local login", async () => {
  const replace = vi.fn()
  vi.stubGlobal("location", { replace, origin: "http://localhost", href: "http://localhost/" })
  mockMethod({
    state: "ready",
    callbackBase: "http://localhost/auth/callback",
    providers: [
      {
        id: "apv_00000000000000000000000001" as ProviderID,
        displayName: "Example SSO",
        kind: "okta",
      },
    ],
    local: true,
  })
  mount()
  const provider = await screen.findByRole("link", { name: "Continue with Example SSO" })
  expect(provider).toHaveAttribute("href", expect.stringContaining("/auth/login?provider="))
  expect(provider.getAttribute("href")).toContain("apv_00000000000000000000000001")
  expect(screen.getByRole("link", { name: "Continue locally" })).toHaveAttribute(
    "href",
    expect.stringContaining("/auth/login"),
  )
  // Local login beside a provider is a choice, so the card never auto-continues.
  expect(replace).not.toHaveBeenCalled()
})

test("keeps the local sign-in card after a failed attempt and omits the empty provider list", async () => {
  const replace = vi.fn()
  vi.stubGlobal("location", { replace, origin: "http://localhost", href: "http://localhost/" })
  mockMethod({
    state: "ready",
    callbackBase: "http://localhost/auth/callback",
    providers: [],
    local: true,
  })
  const { container } = mount("/?auth=failed")
  expect(await screen.findByRole("link", { name: "Continue locally" })).toHaveAttribute(
    "href",
    expect.stringContaining("/auth/login"),
  )
  expect(screen.getByRole("alert")).toHaveTextContent("That sign-in attempt failed.")
  expect(container.querySelector('[data-slot="login-providers"]')).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})

test("offers setup when no provider is configured", async () => {
  mockMethod({ state: "setup", callbackBase: "http://localhost/auth/callback" })
  mount()
  expect(await screen.findByRole("link", { name: "Open setup" })).toHaveAttribute("href", "/setup")
})

test("[SEC-BANNER-01] requires acknowledgment of the system use notification before sign-in continues", async () => {
  mockMethod({
    state: "ready",
    callbackBase: "http://localhost/auth/callback",
    providers: [
      {
        id: "apv_00000000000000000000000001" as ProviderID,
        displayName: "Example SSO",
        kind: "okta",
      },
    ],
    banner: "Authorized use only. Activity may be monitored.",
  })
  mount()
  expect(await screen.findByText("Authorized use only. Activity may be monitored.")).toBeInTheDocument()
  expect(screen.getByRole("region", { name: "System use notification" })).toBeInTheDocument()
  // No sign-in action exists before acknowledgment.
  expect(screen.queryByRole("link", { name: "Continue with Example SSO" })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("checkbox", { name: "I have read and acknowledge this notice." }))
  const provider = await screen.findByRole("link", { name: "Continue with Example SSO" })
  expect(provider.getAttribute("href")).toContain("/auth/login?provider=")
})

test("[SEC-BANNER-02] never skips a configured notification for the local sign-in shortcut", async () => {
  const replace = vi.fn()
  vi.stubGlobal("location", { replace, origin: "http://localhost", href: "http://localhost/" })
  mockMethod({
    state: "ready",
    callbackBase: "http://localhost/auth/callback",
    providers: [],
    local: true,
    banner: "Local development notice.",
  })
  mount()
  expect(await screen.findByText("Local development notice.")).toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
  expect(screen.queryByRole("link", { name: "Continue locally" })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("checkbox", { name: "I have read and acknowledge this notice." }))
  expect(await screen.findByRole("link", { name: "Continue locally" })).toHaveAttribute(
    "href",
    expect.stringContaining("/auth/login"),
  )
  expect(replace).not.toHaveBeenCalled()
})

const readyWithProvider: AuthMethodOutput = {
  state: "ready",
  callbackBase: "http://localhost/auth/callback",
  providers: [{ id: "apv_00000000000000000000000001" as ProviderID, displayName: "Example SSO", kind: "microsoft" }],
  local: false,
}

test.each([
  ["exchange", "check the client secret, the redirect URI, and the Gateway's outbound HTTPS access"],
  [
    "claims",
    "Your identity provider did not send a verified email address. For Microsoft Entra, add the optional ID token claims email and xms_edov.",
  ],
  ["domain", "Your email domain is not admitted for this sign-in provider"],
  ["provider", "This sign-in provider was removed, disabled, or changed during sign-in"],
  ["expired", "The sign-in attempt expired or was started in another browser"],
  ["account", "ask an administrator for an invitation or to restore your account"],
  ["unknown", "The server log records the cause"],
] as const)("explains a %s sign-in failure under the failure message", async (reason, text) => {
  mockMethod(readyWithProvider)
  const { container } = mount(`/?auth=failed&reason=${reason}`)
  await screen.findByRole("link", { name: "Continue with Example SSO" })
  const alert = screen.getByRole("alert")
  expect(alert).toHaveTextContent("That sign-in attempt failed. Choose a provider below to try again.")
  const hint = container.querySelector('[data-slot="login-failure-hint"]')
  expect(hint).toHaveTextContent(text)
  expect(hint?.textContent).toBe(failureHints[reason])
  expect(alert).toContainElement(hint as HTMLElement)
})

test("shows no hint for a missing or unrecognized reason", async () => {
  mockMethod(readyWithProvider)
  const { container } = mount("/?auth=failed&reason=<script>person@example.com")
  expect(await screen.findByRole("alert")).toHaveTextContent("That sign-in attempt failed.")
  expect(container.querySelector('[data-slot="login-failure-hint"]')).not.toBeInTheDocument()
  expect(screen.getByRole("alert")).not.toHaveTextContent("person@example.com")
})

test("ignores a reason without a failed attempt", async () => {
  mockMethod(readyWithProvider)
  const { container } = mount("/?reason=claims")
  await screen.findByRole("link", { name: "Continue with Example SSO" })
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(container.querySelector('[data-slot="login-failure-hint"]')).not.toBeInTheDocument()
})
