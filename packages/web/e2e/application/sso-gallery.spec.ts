import { AuthScenario } from "@bymorning/testing/scenario/auth"
import { copyFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { start } from "../../../server/test/oidc-idp.js"
import { expect, makeTest } from "../fixtures/app.js"

const test = makeTest(AuthScenario.loginLocal)
const gallery = "/tmp/opencode/sso-gallery-2026-09-14/screenshots"

test("SSO screenshot gallery", async ({ app, browser }, testInfo) => {
  testInfo.setTimeout(240_000)
  const fixture = await start()
  const owner = app.data
  const workspace = owner.properties.workspaceID
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined

  try {
    context = await browser.newContext({
      baseURL: app.web.href,
      colorScheme: "light",
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 900 },
    })
    await context.addInitScript(() => {
      localStorage.setItem("bymorning-color-scheme", "light")
      localStorage.setItem("bymorning-theme-id", "ink")
    })
    const page = await context.newPage()
    const errors: string[] = []
    const artifacts: Array<{ readonly name: string; readonly path: string }> = []
    page.on("pageerror", (error) => errors.push(error.message))

    const capture = async (name: string) => {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "ink")
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
      await page.evaluate("document.fonts.ready")
      const path = testInfo.outputPath(name)
      await page.screenshot({
        path,
        animations: "disabled",
        caret: "hide",
      })
      artifacts.push({ name, path })
    }

    await page.goto("/login")
    await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
    // A Workspace with no Session yet shows Overview without a Sessions list.
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
    await page.goto(`/w/${workspace}/security`)
    await expect(page.getByRole("heading", { name: "SSO", exact: true })).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: "No SSO connection" })).toHaveText(
      "No SSO connection configured yet.",
    )
    await expect(page.getByRole("button", { name: "Connect SSO", exact: true })).toBeVisible()
    await capture("01-empty-sso.png")

    await page.getByRole("button", { name: "Connect SSO", exact: true }).click()
    const createDialog = page.getByRole("dialog", { name: "Add Auth Provider", exact: true })
    await expect(createDialog).toBeVisible()
    await expect(createDialog.getByLabel("Callback URL", { exact: true })).toHaveCount(0)
    await expect(createDialog.getByLabel("Display name", { exact: true })).toHaveCount(0)
    await expect(createDialog.getByLabel("Status", { exact: true })).toHaveCount(0)
    await expect(createDialog.getByLabel("OpenID Connect (OIDC) Provider", { exact: true })).toBeVisible()
    await expect(createDialog.getByLabel("Domain", { exact: true })).toBeVisible()
    await capture("02-connect-sso-form.png")

    const providerSelect = createDialog.getByRole("group", { name: "OpenID Connect (OIDC) Provider", exact: true })
    await providerSelect.getByRole("button", { name: "Custom", exact: true }).click()
    const providerOptions = page.getByRole("option", { includeHidden: true })
    await expect(providerOptions).toHaveText(["Google Workspace", "Okta", "Microsoft Entra", "Custom"])
    await expect(page.getByRole("option", { name: "Auth0", exact: true, includeHidden: true })).toHaveCount(0)
    await expect(page.getByRole("option", { name: "Ping", exact: true, includeHidden: true })).toHaveCount(0)
    await capture("03-provider-choices.png")
    await page.getByRole("option", { name: "Microsoft Entra", exact: true, includeHidden: true }).click()

    await createDialog
      .getByLabel("Microsoft Entra tenant ID", { exact: true })
      .fill("6f9619ff-8b86-d011-b42d-00cf4fc964ff")
    await createDialog.getByLabel("Client ID", { exact: true }).fill("b7c3a121-98aa-48d5-8f73-a92b4509a101")
    await createDialog.getByLabel("Client secret", { exact: true }).fill("gallery-secret-not-real")
    await createDialog.getByLabel("Domain", { exact: true }).fill("northstar.example")
    await expect(createDialog.getByLabel("Issuer", { exact: true })).toHaveCount(0)
    await capture("04-microsoft-entra-configuration.png")

    await createDialog.getByLabel("Domain", { exact: true }).fill("   ")
    await createDialog.getByRole("button", { name: "Create provider", exact: true }).click()
    await expect(createDialog.getByRole("alert")).toHaveText("Domain is required.")
    await capture("05-domains-validation.png")
    await createDialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(createDialog).toHaveCount(0)

    await page.getByRole("button", { name: "Connect SSO", exact: true }).click()
    const localDialog = page.getByRole("dialog", { name: "Add Auth Provider", exact: true })
    await localDialog.getByLabel("Issuer", { exact: true }).fill(fixture.issuer.href)
    await localDialog.getByLabel("Client ID", { exact: true }).fill(fixture.clientID)
    await localDialog.getByLabel("Client secret", { exact: true }).fill(fixture.clientSecret)
    await localDialog.getByLabel("Domain", { exact: true }).fill("northstar.example")
    await localDialog.getByRole("button", { name: "Create provider", exact: true }).click()

    const createdToast = page.getByText("Auth Provider Custom created", { exact: true })
    await expect(createdToast).toBeVisible()
    await page.getByRole("button", { name: "Dismiss", exact: true }).click()
    await expect(createdToast).toHaveCount(0)
    const createdProviders = await app.client["api.auth-provider"].authProvider.list()
    expect(createdProviders).toHaveLength(1)
    expect(createdProviders[0]?.domains).toEqual(["northstar.example"])
    await expect(page.getByRole("button", { name: "Connect SSO", exact: true })).toHaveCount(0)
    const details = page.getByRole("region", { name: "SSO connection", exact: true })
    await expect(details).toHaveCount(1)
    await expect(details.getByText("OpenID Connect (OIDC) Provider", { exact: true })).toBeVisible()
    await expect(details.getByText("Custom", { exact: true })).toBeVisible()
    await expect(details.getByText("Domain", { exact: true })).toBeVisible()
    await expect(details.getByText("northstar.example", { exact: true })).toBeVisible()
    await expect(details.getByText("Callback URL", { exact: true })).toBeVisible()
    await expect(details.getByText("Credentials", { exact: true })).toBeVisible()
    await expect(details.getByText("Configured", { exact: true })).toBeVisible()
    await expect(details.getByRole("button", { name: "Edit SSO connection", exact: true })).toBeVisible()
    await expect(details.getByText("Issuer", { exact: true })).toHaveCount(0)
    await expect(details.getByText("Client ID", { exact: true })).toHaveCount(0)
    await expect(details.getByText("Status", { exact: true })).toHaveCount(0)
    await expect(details.getByText("Revision", { exact: true })).toHaveCount(0)
    await capture("06-connection-details.png")

    await details.getByRole("button", { name: "Edit SSO connection", exact: true }).click()
    const editDialog = page.getByRole("dialog", { name: "Edit Auth Provider", exact: true })
    await expect(editDialog.getByLabel("Display name", { exact: true })).toHaveCount(0)
    await expect(editDialog.getByLabel("Status", { exact: true })).toHaveCount(0)
    await expect(editDialog.getByLabel("OpenID Connect (OIDC) Provider", { exact: true })).toHaveAttribute(
      "data-disabled",
      "",
    )
    await expect(editDialog.getByLabel("Issuer", { exact: true })).toBeDisabled()
    await expect(editDialog.getByLabel("Client ID", { exact: true })).toBeDisabled()
    await expect(editDialog.getByLabel("Client secret", { exact: true })).toHaveValue("")
    await expect(editDialog).toContainText("Leave empty to keep the stored value.")
    await capture("07-edit-sso-connection.png")

    await editDialog.getByLabel("Domain", { exact: true }).fill("northstar.co.uk")
    await capture("08-minimal-edit-fields.png")
    await editDialog.getByRole("button", { name: "Save provider", exact: true }).click()
    await expect(page.getByText("Auth Provider Custom updated", { exact: true })).toBeVisible()
    const updatedProviders = await app.client["api.auth-provider"].authProvider.list()
    expect(updatedProviders).toHaveLength(1)
    expect(updatedProviders[0]?.domains).toEqual(["northstar.co.uk"])
    await expect(page.getByRole("button", { name: "Connect SSO", exact: true })).toHaveCount(0)
    await expect(details.getByText("northstar.co.uk", { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("heading", { name: "SSO", exact: true })).toBeVisible()
    await expect(details).toHaveCount(1)
    await expect(details.getByText("Custom", { exact: true })).toBeVisible()
    await expect(details.getByText("northstar.co.uk", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Connect SSO", exact: true })).toHaveCount(0)
    await capture("09-updated-connection-details.png")

    await page.setViewportSize({ width: 600, height: 900 })
    await expect(details.getByText("OpenID Connect (OIDC) Provider", { exact: true })).toBeVisible()
    await expect(details.getByRole("button", { name: "Copy callback URL for SSO connection", exact: true })).toHaveCSS(
      "white-space",
      "nowrap",
    )
    await expect(details.getByRole("button", { name: "Edit SSO connection", exact: true })).toHaveCSS(
      "white-space",
      "nowrap",
    )

    expect(errors).toEqual([])
    await mkdir(gallery, { recursive: true })
    await Promise.all(artifacts.map((artifact) => copyFile(artifact.path, join(gallery, artifact.name))))
  } finally {
    try {
      await context?.close()
    } finally {
      await fixture.close()
    }
  }
})
