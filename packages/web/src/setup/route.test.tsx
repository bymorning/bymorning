import { ByMorning, type ByMorningClient } from "@bymorning/client"
import { MemoryRouter, Route } from "@solidjs/router"
import { cleanup, render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import { SDKProvider } from "../context/sdk"
import { SetupRoute } from "./route"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

type Inspect = Awaited<ReturnType<ByMorningClient["auth"]["inspect"]>>
type Setup = ByMorningClient["auth"]["setup"]
type Method = ByMorningClient["auth"]["method"]

const callbackBase = "https://app.example/auth/callback"

const provider = (overrides?: Partial<Inspect[number]>): Inspect[number] => ({
  id: "apv_00000000000000000000000001" as Inspect[number]["id"],
  revision: 1 as Inspect[number]["revision"],
  displayName: "Example SSO",
  kind: "okta",
  domains: ["example.com"],
  issuer: "https://accounts.example.com",
  clientID: "client-1",
  status: "enabled",
  ...overrides,
})

function mockAuth(inspectImpl: () => Promise<Inspect>, setupImpl?: Setup) {
  const base = ByMorning.make({ baseUrl: "http://localhost" })
  const inspect: ByMorningClient["auth"]["inspect"] = async () => inspectImpl()
  const setup: Setup = async (input) => setupImpl?.(input) ?? provider()
  const method: Method = async () => ({ state: "setup", callbackBase })
  vi.spyOn(ByMorning, "make").mockReturnValue({
    ...base,
    auth: { ...base.auth, inspect: vi.fn(inspect), setup: vi.fn(setup), method: vi.fn(method) },
  })
}

const mount = () =>
  render(() => (
    <SDKProvider>
      <MemoryRouter>
        <Route path="/" component={SetupRoute} />
      </MemoryRouter>
    </SDKProvider>
  ))

const inspectWith = async (token: string) => {
  await userEvent.type(screen.getByLabelText("Setup token"), token)
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  await screen.findByRole("button", { name: "Register provider" })
}

test("keeps the setup token in memory and inspects before registering", async () => {
  const calls: Array<string> = []
  mockAuth(async () => {
    calls.push("inspect")
    return []
  })
  mount()
  const token = screen.getByLabelText("Setup token")
  expect(token).toHaveAttribute("type", "password")
  await inspectWith("secret-token")
  expect(calls).toEqual(["inspect"])
  expect(window.location.search).not.toContain("secret-token")
})

test("registers a custom provider with the callback URL built from its pre-allocated ID", async () => {
  const seen: Array<Parameters<Setup>[0]> = []
  mockAuth(
    async () => [],
    async (input) => {
      seen.push(input)
      return provider()
    },
  )
  mount()
  await inspectWith("secret-token")
  const callback = (await screen.findByLabelText("Callback URL")) as HTMLInputElement
  expect(callback).toHaveAttribute("readonly")
  expect(callback.value).toMatch(new RegExp(`^${callbackBase}/apv_[A-Za-z0-9]{26}$`))
  const allocated = callback.value.slice(callbackBase.length + 1)
  expect(screen.getByRole("button", { name: "Copy callback URL" })).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText("Display name"), "Example SSO")
  await userEvent.type(screen.getByLabelText("Issuer"), "https://accounts.example.com")
  await userEvent.type(screen.getByLabelText("Client ID"), "client-1")
  await userEvent.type(screen.getByLabelText("Client secret"), "secret-1")
  await userEvent.type(screen.getByLabelText("Email domains"), "example.com, example.org")
  await userEvent.click(screen.getByRole("button", { name: "Register provider" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Example SSO is ready.")
  expect(screen.getByRole("heading", { name: "Auth Provider registered" })).toBeInTheDocument()
  expect(seen).toHaveLength(1)
  expect(seen[0]).toEqual({
    payload: {
      type: "create",
      token: "secret-token",
      value: {
        id: allocated,
        displayName: "Example SSO",
        kind: "custom",
        domains: ["example.com", "example.org"],
        issuer: "https://accounts.example.com",
        clientID: "client-1",
        clientSecret: "secret-1",
      },
    },
  })
})

test("derives the display name from a preset and the issuer from a Microsoft tenant ID", async () => {
  const seen: Array<Parameters<Setup>[0]> = []
  mockAuth(
    async () => [],
    async (input) => {
      seen.push(input)
      return provider({ displayName: "Microsoft Entra", kind: "microsoft" })
    },
  )
  mount()
  await inspectWith("secret-token")
  const kind = screen.getByLabelText("OpenID Connect (OIDC) Provider")
  await userEvent.click(within(kind).getByRole("button", { name: "Custom" }))
  expect(screen.queryByRole("option", { name: "Auth0", hidden: true })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole("option", { name: "Microsoft Entra", hidden: true }))
  expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument()
  expect(screen.queryByLabelText("Issuer")).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText("Microsoft Entra tenant ID"), "tenant.example.com")
  await userEvent.type(screen.getByLabelText("Client ID"), "client-1")
  await userEvent.type(screen.getByLabelText("Client secret"), "secret-1")
  await userEvent.type(screen.getByLabelText("Email domains"), "example.com")
  await userEvent.click(screen.getByRole("button", { name: "Register provider" }))
  await screen.findByRole("status")
  const payload = seen[0]?.payload
  expect(payload && "value" in payload ? payload.value : {}).toMatchObject({
    kind: "microsoft",
    displayName: "Microsoft Entra",
    issuer: "https://login.microsoftonline.com/tenant.example.com/v2.0",
  })
})

test("derives an Azure Government issuer when the Microsoft Entra cloud is selected", async () => {
  const seen: Array<Parameters<Setup>[0]> = []
  mockAuth(
    async () => [],
    async (input) => {
      seen.push(input)
      return provider({ displayName: "Microsoft Entra", kind: "microsoft" })
    },
  )
  mount()
  await inspectWith("secret-token")
  const kind = screen.getByLabelText("OpenID Connect (OIDC) Provider")
  await userEvent.click(within(kind).getByRole("button", { name: "Custom" }))
  await userEvent.click(await screen.findByRole("option", { name: "Microsoft Entra", hidden: true }))
  const cloud = screen.getByLabelText("Microsoft Entra cloud")
  await userEvent.click(within(cloud).getByRole("button", { name: /Commercial/ }))
  await userEvent.click(await screen.findByRole("option", { name: /Azure Government/, hidden: true }))
  await userEvent.type(screen.getByLabelText("Microsoft Entra tenant ID"), "gov-tenant")
  await userEvent.type(screen.getByLabelText("Client ID"), "client-1")
  await userEvent.type(screen.getByLabelText("Client secret"), "secret-1")
  await userEvent.type(screen.getByLabelText("Email domains"), "example.gov")
  await userEvent.click(screen.getByRole("button", { name: "Register provider" }))
  await screen.findByRole("status")
  const payload = seen[0]?.payload
  expect(payload && "value" in payload ? payload.value : {}).toMatchObject({
    kind: "microsoft",
    issuer: "https://login.microsoftonline.us/gov-tenant/v2.0",
  })
})

test("recovers an inspected provider without resending issuer or client ID", async () => {
  const seen: Array<Parameters<Setup>[0]> = []
  mockAuth(
    async () => [provider()],
    async (input) => {
      seen.push(input)
      return provider({ revision: 2 as Inspect[number]["revision"] })
    },
  )
  mount()
  await inspectWith("secret-token")
  await userEvent.click(screen.getByRole("button", { name: "Recover existing provider" }))
  expect(screen.getByRole("heading", { name: "Recover an Auth Provider" })).toBeInTheDocument()
  expect(screen.queryByLabelText("Callback URL")).not.toBeInTheDocument()
  await userEvent.clear(screen.getByLabelText("Display name"))
  await userEvent.type(screen.getByLabelText("Display name"), "Renamed SSO")
  await userEvent.click(screen.getByRole("button", { name: "Recover provider" }))
  expect(await screen.findByRole("status")).toHaveTextContent("revision 2")
  expect(seen).toHaveLength(1)
  const payload = seen[0]?.payload
  expect(payload?.type).toBe("update")
  expect(payload && "value" in payload ? payload.value : {}).not.toHaveProperty("issuer")
  expect(payload && "value" in payload ? payload.value : {}).not.toHaveProperty("clientID")
})

const unreachable =
  "ByMorning could not reach the identity provider at https://login.microsoftonline.us. Check that the Gateway has outbound HTTPS access to it."
const mismatch =
  "The identity provider's discovery document at https://accounts.example.com did not match the issuer. Check the issuer URL."

const registerCustom = async () => {
  await userEvent.type(await screen.findByLabelText("Display name"), "Example SSO")
  await userEvent.type(screen.getByLabelText("Issuer"), "https://accounts.example.com")
  await userEvent.type(screen.getByLabelText("Client ID"), "client-1")
  await userEvent.type(screen.getByLabelText("Client secret"), "secret-1")
  await userEvent.type(screen.getByLabelText("Email domains"), "example.com")
  await userEvent.click(screen.getByRole("button", { name: "Register provider" }))
}

test.each([
  ["an unreachable issuer (503)", { _tag: "ServiceUnavailableError", message: unreachable }, unreachable],
  ["a discovery mismatch (400)", { _tag: "Protocol.InputError", message: "", error: mismatch }, mismatch],
])("shows the server's message for %s verbatim", async (_name, failure, expected) => {
  mockAuth(
    async () => [],
    async () => Promise.reject(failure),
  )
  mount()
  await inspectWith("secret-token")
  await registerCustom()
  expect((await screen.findByRole("alert")).textContent).toBe(expected)
  expect(screen.getByRole("button", { name: "Register provider" })).toBeEnabled()
})
