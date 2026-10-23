import { cleanup, screen, waitFor, within } from "@solidjs/testing-library"
import { renderForm as render } from "../ui/form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"

import { DialogProvider } from "../context/dialog"
import { Toast, toaster } from "../ui/components/toast"
import { SecurityPage, type SecurityProviderInfo, type SecurityProviderUpdate } from "./route"

afterEach(() => {
  cleanup()
  toaster.dismiss()
  vi.restoreAllMocks()
})

const provider = (overrides?: Partial<SecurityProviderInfo>): SecurityProviderInfo => ({
  id: "apv_00000000000000000000000001" as SecurityProviderInfo["id"],
  revision: 1 as SecurityProviderInfo["revision"],
  displayName: "Example SSO",
  kind: "okta",
  domains: ["example.com"],
  issuer: "https://accounts.example.com",
  clientID: "client-1",
  status: "enabled",
  ...overrides,
})

function mount(client: object) {
  render(() => (
    <>
      <DialogProvider>
        <SecurityPage client={client as never} />
      </DialogProvider>
      <Toast.Region />
    </>
  ))
}

test("renders connection details without another creation affordance and opens editing", async () => {
  const client = {
    list: vi.fn(async () => [provider()]),
    get: vi.fn(async () => provider()),
    create: vi.fn(async () => provider()),
    update: vi.fn(async () => provider({ revision: 2 as SecurityProviderInfo["revision"] })),
  }
  mount(client)
  const details = await screen.findByRole("region", { name: "SSO connection" })
  expect(within(details).getByText("OpenID Connect (OIDC) Provider", { selector: "dt" })).toBeVisible()
  expect(within(details).getByText("Domain", { selector: "dt" })).toBeVisible()
  expect(within(details).getByText("Okta")).toBeVisible()
  expect(within(details).getByText("example.com")).toBeVisible()
  expect(within(details).getByText(`${window.location.origin}/auth/callback/${provider().id}`)).toBeVisible()
  expect(within(details).getByText("Configured")).toBeVisible()
  expect(screen.queryByRole("button", { name: "Connect SSO" })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole("button", { name: "Edit SSO connection" }))
  expect(client.get).toHaveBeenCalledExactlyOnceWith({
    providerID: "apv_00000000000000000000000001",
  })
  const dialog = await screen.findByRole("dialog", { name: "Edit Auth Provider" })
  expect(within(dialog).queryByLabelText("Callback URL")).not.toBeInTheDocument()
  expect(within(dialog).getByLabelText("OpenID Connect (OIDC) Provider")).toBeInTheDocument()
  expect(within(dialog).getByLabelText("Domain")).toHaveValue("example.com")
  expect(within(dialog).queryByLabelText("Domains")).not.toBeInTheDocument()
  expect(within(dialog).getByLabelText("Issuer")).toBeDisabled()
  expect(within(dialog).getByLabelText("Client ID")).toBeDisabled()
  expect(within(dialog).queryByLabelText("Display name")).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText("Status")).not.toBeInTheDocument()
  expect(dialog).toHaveTextContent(/Saving creates revision 2/i)
  expect(dialog).toHaveTextContent(/invalidates pending login attempts/i)
  expect(within(dialog).getByRole("button", { name: "Save provider" })).toBeInTheDocument()
})

test("allocates the provider ID without showing a callback field and never exposes secrets", async () => {
  const client = {
    list: vi.fn(async () => [] as Array<SecurityProviderInfo>),
    get: vi.fn(),
    create: vi.fn(async () => provider()),
    update: vi.fn(),
  }
  mount(client)
  expect(await screen.findByRole("heading", { name: "SSO" })).toBeVisible()
  const empty = await screen.findByRole("status")
  expect(empty).toHaveTextContent("No SSO connection configured yet.")
  expect(empty).toHaveAttribute("data-component", "empty")
  expect(empty).toHaveAttribute("data-variant", "panel")
  await userEvent.click(screen.getByRole("button", { name: "Connect SSO" }))
  const dialog = screen.getByRole("dialog", { name: "Add Auth Provider" })
  expect(within(dialog).queryByLabelText("Provider ID")).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText("Callback URL")).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText("Display name")).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText("Status")).not.toBeInTheDocument()
  await userEvent.type(within(dialog).getByLabelText("Issuer"), "https://accounts.example.com")
  await userEvent.type(within(dialog).getByLabelText("Client ID"), "client-1")
  await userEvent.type(within(dialog).getByLabelText("Client secret"), "secret-1")
  await userEvent.type(within(dialog).getByLabelText("Domain"), " Example.COM ")
  await userEvent.click(within(dialog).getByRole("button", { name: "Create provider" }))
  expect(await screen.findByText("Auth Provider Example SSO created")).toBeInTheDocument()
  expect(client.create).toHaveBeenCalledExactlyOnceWith({
    id: expect.stringMatching(/^apv_/),
    displayName: "Custom",
    kind: "custom",
    domains: ["example.com"],
    issuer: "https://accounts.example.com",
    clientID: "client-1",
    clientSecret: "secret-1",
  })
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Auth Provider" })).not.toBeInTheDocument())
  expect(screen.queryByRole("button", { name: "Connect SSO" })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain("secret-1")
})

test("offers supported new provider kinds and derives the Microsoft issuer from the tenant ID", async () => {
  const client = {
    list: vi.fn(async () => [] as Array<SecurityProviderInfo>),
    get: vi.fn(),
    create: vi.fn(async (input: {
      readonly id: SecurityProviderInfo["id"]
      readonly kind: SecurityProviderInfo["kind"]
      readonly issuer: string
      readonly clientID: string
    }) =>
      provider({
        id: input.id,
        kind: input.kind,
        issuer: input.issuer,
        clientID: input.clientID,
      }),
    ),
    update: vi.fn(),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Connect SSO" }))
  const dialog = screen.getByRole("dialog", { name: "Add Auth Provider" })
  const providerSelect = within(dialog).getByLabelText("OpenID Connect (OIDC) Provider")
  expect(providerSelect).toBeInTheDocument()
  expect(within(dialog).getByText("OpenID Connect (OIDC) Provider")).toBeVisible()
  expect(within(dialog).queryByLabelText("Provider")).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText("Kind")).not.toBeInTheDocument()
  await userEvent.click(within(providerSelect).getByRole("button", { name: "Custom" }))
  expect(await screen.findByRole("option", { name: "Google Workspace", hidden: true })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: "Okta", hidden: true })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: "Microsoft Entra", hidden: true })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: "Custom", hidden: true })).toBeInTheDocument()
  expect(screen.queryByRole("option", { name: "Auth0", hidden: true })).not.toBeInTheDocument()
  expect(screen.queryByRole("option", { name: "Ping", hidden: true })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("option", { name: "Microsoft Entra", hidden: true }))

  expect(within(dialog).queryByLabelText("Issuer")).not.toBeInTheDocument()
  await userEvent.type(within(dialog).getByLabelText("Microsoft Entra tenant ID"), "tenant.example.com")
  await userEvent.type(within(dialog).getByLabelText("Client ID"), "client-1")
  await userEvent.type(within(dialog).getByLabelText("Client secret"), "secret-1")
  await userEvent.type(within(dialog).getByLabelText("Domain"), "example.com")
  await userEvent.click(within(dialog).getByRole("button", { name: "Create provider" }))

  await waitFor(() =>
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "microsoft",
        displayName: "Microsoft Entra",
        issuer: "https://login.microsoftonline.com/tenant.example.com/v2.0",
      }),
    ),
  )
})

test("derives an Azure Government issuer when the Microsoft Entra cloud is selected", async () => {
  const client = {
    list: vi.fn(async () => [] as Array<SecurityProviderInfo>),
    get: vi.fn(),
    create: vi.fn(async (input: { readonly id: SecurityProviderInfo["id"]; readonly issuer: string }) =>
      provider({ id: input.id, kind: "microsoft", issuer: input.issuer }),
    ),
    update: vi.fn(),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Connect SSO" }))
  const dialog = screen.getByRole("dialog", { name: "Add Auth Provider" })
  await userEvent.click(within(within(dialog).getByLabelText("OpenID Connect (OIDC) Provider")).getByRole("button", { name: "Custom" }))
  await userEvent.click(await screen.findByRole("option", { name: "Microsoft Entra", hidden: true }))
  await userEvent.click(within(within(dialog).getByLabelText("Microsoft Entra cloud")).getByRole("button", { name: /Commercial/ }))
  await userEvent.click(await screen.findByRole("option", { name: /Azure Government/, hidden: true }))
  await userEvent.type(within(dialog).getByLabelText("Microsoft Entra tenant ID"), "gov-tenant")
  await userEvent.type(within(dialog).getByLabelText("Client ID"), "client-1")
  await userEvent.type(within(dialog).getByLabelText("Client secret"), "secret-1")
  await userEvent.type(within(dialog).getByLabelText("Domain"), "example.gov")
  await userEvent.click(within(dialog).getByRole("button", { name: "Create provider" }))
  await waitFor(() =>
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "microsoft", issuer: "https://login.microsoftonline.us/gov-tenant/v2.0" }),
    ),
  )
})

test("shows the Azure Government cloud and tenant ID when editing a Government provider", async () => {
  const microsoft = provider({
    kind: "microsoft",
    issuer: "https://login.microsoftonline.us/00000000-0000-0000-0000-000000000000/v2.0",
  })
  const client = {
    list: vi.fn(async () => [microsoft]),
    get: vi.fn(async () => microsoft),
    create: vi.fn(),
    update: vi.fn(),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Edit SSO connection" }))
  const dialog = await screen.findByRole("dialog", { name: "Edit Auth Provider" })
  expect(within(dialog).getByLabelText("Microsoft Entra tenant ID")).toHaveValue("00000000-0000-0000-0000-000000000000")
  expect(within(within(dialog).getByLabelText("Microsoft Entra cloud")).getByRole("button", { name: /Azure Government/ })).toBeInTheDocument()
})

test("rejects multiple values in the single Domain input", async () => {
  const client = {
    list: vi.fn(async () => [] as Array<SecurityProviderInfo>),
    get: vi.fn(),
    create: vi.fn(async () => provider()),
    update: vi.fn(),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Connect SSO" }))
  const dialog = screen.getByRole("dialog", { name: "Add Auth Provider" })
  await userEvent.type(within(dialog).getByLabelText("Issuer"), "https://accounts.example.com")
  await userEvent.type(within(dialog).getByLabelText("Client ID"), "client-1")
  await userEvent.type(within(dialog).getByLabelText("Client secret"), "secret-1")
  await userEvent.type(within(dialog).getByLabelText("Domain"), "one.example, two.example")
  await userEvent.click(within(dialog).getByRole("button", { name: "Create provider" }))

  expect(await within(dialog).findByText("Enter one valid email domain, such as example.com.")).toBeVisible()
  expect(client.create).not.toHaveBeenCalled()
})

test("shows the tenant ID when editing Microsoft Entra and retains legacy kinds for saved providers", async () => {
  const microsoft = provider({
    kind: "microsoft",
    issuer: "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0",
  })
  const client = {
    list: vi.fn(async () => [microsoft]),
    get: vi.fn(async () => microsoft),
    create: vi.fn(),
    update: vi.fn(async () => provider({ revision: 2 as SecurityProviderInfo["revision"] })),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Edit SSO connection" }))
  const dialog = await screen.findByRole("dialog", { name: "Edit Auth Provider" })
  const tenantID = within(dialog).getByLabelText("Microsoft Entra tenant ID")
  expect(tenantID).toHaveValue("00000000-0000-0000-0000-000000000000")
  expect(tenantID).toBeDisabled()
  expect(within(dialog).queryByLabelText("Issuer")).not.toBeInTheDocument()

  expect(within(dialog).getByRole("button", { name: "Microsoft Entra" })).toHaveAttribute("aria-disabled", "true")
})

test("shows and preserves a noncanonical issuer when editing an existing Microsoft provider", async () => {
  const microsoft = provider({
    kind: "microsoft",
    issuer: "https://identity.example.com/company",
  })
  const client = {
    list: vi.fn(async () => [microsoft]),
    get: vi.fn(async () => microsoft),
    create: vi.fn(),
    update: vi.fn(async (_input: SecurityProviderUpdate) =>
      provider({ ...microsoft, revision: 2 as SecurityProviderInfo["revision"] }),
    ),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Edit SSO connection" }))
  const dialog = await screen.findByRole("dialog", { name: "Edit Auth Provider" })

  expect(within(dialog).queryByLabelText("Microsoft Entra tenant ID")).not.toBeInTheDocument()
  const issuer = within(dialog).getByLabelText("Issuer")
  expect(issuer).toHaveValue("https://identity.example.com/company")
  expect(issuer).toHaveAttribute("readonly")

  await userEvent.click(within(dialog).getByRole("button", { name: "Save provider" }))
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update.mock.calls[0]?.[0]).not.toHaveProperty("issuer")
})

test("updates derive the provider label while preserving status and stored secret", async () => {
  const client = {
    list: vi.fn(async () => [provider()]),
    get: vi.fn(async () => provider()),
    create: vi.fn(),
    update: vi.fn(async () => provider({ revision: 2 as SecurityProviderInfo["revision"] })),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Edit SSO connection" }))
  const dialog = await screen.findByRole("dialog", { name: "Edit Auth Provider" })
  await userEvent.click(within(dialog).getByRole("button", { name: "Save provider" }))
  expect(await screen.findByText("Auth Provider Example SSO updated")).toBeInTheDocument()
  expect(client.update).toHaveBeenCalledExactlyOnceWith({
    providerID: "apv_00000000000000000000000001",
    id: "apv_00000000000000000000000001",
    revision: 1,
    displayName: "Example SSO",
    kind: "okta",
    domains: ["example.com"],
    status: "enabled",
  })
})

test("requires an explicit single-domain choice before updating a legacy multi-domain provider", async () => {
  const legacy = provider({ domains: ["first.example", "second.example"] })
  const client = {
    list: vi.fn(async () => [legacy]),
    get: vi.fn(async () => legacy),
    create: vi.fn(),
    update: vi.fn(async () => provider({ domains: ["second.example"], revision: 2 as SecurityProviderInfo["revision"] })),
  }
  mount(client)
  const details = await screen.findByRole("region", { name: "SSO connection" })
  expect(within(details).getByText("Domain", { selector: "dt" })).toBeVisible()
  expect(within(details).getByText("first.example, second.example")).toBeVisible()
  await userEvent.click(await screen.findByRole("button", { name: "Edit SSO connection" }))
  const dialog = await screen.findByRole("dialog", { name: "Edit Auth Provider" })
  const domain = within(dialog).getByLabelText("Domain")
  expect(domain).toHaveValue("")
  expect(dialog).toHaveTextContent(
    "This provider currently has multiple domains (first.example, second.example). Enter the single domain to use.",
  )

  await userEvent.click(within(dialog).getByRole("button", { name: "Save provider" }))
  expect(await within(dialog).findByText("Choose one domain before saving this provider.")).toBeVisible()
  expect(client.update).not.toHaveBeenCalled()

  await userEvent.type(domain, " SECOND.EXAMPLE ")
  await userEvent.click(within(dialog).getByRole("button", { name: "Save provider" }))
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ domains: ["second.example"] }))
})

test("keeps disabled legacy connections disabled without exposing a status control", async () => {
  const disabled = provider({ kind: "auth0", status: "disabled" })
  const client = {
    list: vi.fn(async () => [disabled]),
    get: vi.fn(async () => disabled),
    create: vi.fn(),
    update: vi.fn(async () => provider({ ...disabled, revision: 2 as SecurityProviderInfo["revision"] })),
  }
  mount(client)
  expect(await screen.findByText("Disabled")).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "Edit SSO connection" }))
  const dialog = await screen.findByRole("dialog", { name: "Edit Auth Provider" })
  expect(within(dialog).queryByLabelText("Status")).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole("button", { name: "Save provider" }))
  await waitFor(() => expect(client.update).toHaveBeenCalledOnce())
  expect(client.update).toHaveBeenCalledWith(
    expect.objectContaining({ displayName: "Example SSO", kind: "auth0", status: "disabled" }),
  )
})

test("shows every legacy connection compactly and does not allow adding another", async () => {
  const second = provider({
    id: "apv_00000000000000000000000002" as SecurityProviderInfo["id"],
    displayName: "Company Entra",
    kind: "microsoft",
    issuer: "https://login.microsoftonline.com/company/v2.0",
    clientID: "client-2",
    domains: ["company.example"],
  })
  const client = {
    list: vi.fn(async () => [provider(), second]),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }
  mount(client)
  expect(await screen.findByRole("note")).toHaveTextContent(/multiple SSO connections already exist/i)
  expect(screen.getByRole("region", { name: "SSO connection 1" })).toBeVisible()
  expect(screen.getByRole("region", { name: "SSO connection 2" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Edit SSO connection 1" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Edit SSO connection 2" })).toBeVisible()
  expect(screen.queryByRole("button", { name: "Connect SSO" })).not.toBeInTheDocument()
  expect(client.create).not.toHaveBeenCalled()
})

test("shows the server's discovery message verbatim when creating a provider fails", async () => {
  const unreachable =
    "ByMorning could not reach the identity provider at https://login.microsoftonline.us. Check that the Gateway has outbound HTTPS access to it."
  const client = {
    list: vi.fn(async () => [] as Array<SecurityProviderInfo>),
    get: vi.fn(),
    create: vi.fn(async () => Promise.reject({ _tag: "Protocol.InputError", message: "", error: unreachable })),
    update: vi.fn(),
  }
  mount(client)
  await userEvent.click(await screen.findByRole("button", { name: "Connect SSO" }))
  const dialog = screen.getByRole("dialog", { name: "Add Auth Provider" })
  await userEvent.type(within(dialog).getByLabelText("Issuer"), "https://accounts.example.com")
  await userEvent.type(within(dialog).getByLabelText("Client ID"), "client-1")
  await userEvent.type(within(dialog).getByLabelText("Client secret"), "secret-1")
  await userEvent.type(within(dialog).getByLabelText("Domain"), "example.com")
  await userEvent.click(within(dialog).getByRole("button", { name: "Create provider" }))
  expect(await within(dialog).findByText(unreachable)).toBeVisible()
  expect(screen.getByRole("dialog", { name: "Add Auth Provider" })).toBeInTheDocument()
})
