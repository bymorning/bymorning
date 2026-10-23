import type { ByMorningClient, ProviderDirectoryEntry } from "@bymorning/client"
import type { Page } from "@playwright/test"
import { expect, test } from "../fixtures/app.js"

test.use({ video: "on", screenshot: "on", viewport: { width: 1280, height: 720 } })

const providerName = (entry: ProviderDirectoryEntry) =>
  entry.info.displayName ?? entry.integration?.name ?? entry.info.name

type BrowserApp = {
  readonly client: ByMorningClient
  readonly data: { readonly owner: { readonly properties: { readonly workspaceID: string } } }
}

async function disableProviders(app: BrowserApp) {
  const directory = await app.client.provider.list()
  for (const entry of directory) {
    if (entry.active) await app.client.provider.update({ provider: entry.info.name, status: "disabled" })
  }
  return directory
}

async function startProviderOnboarding(app: BrowserApp, page: Page, draft: string) {
  const workspace = app.data.owner.properties.workspaceID
  await page.goto(`/w/${workspace}`)
  const newSession = page.locator('[data-action="home-new-session"]')
  await expect(newSession).toBeEnabled()
  await newSession.click()
  await expect(page.getByRole("heading", { name: "Activate a provider to start chatting" })).toBeVisible()
  const message = page.getByRole("combobox", { name: "Message", exact: true })
  await message.fill(draft)
  return { message, workspace }
}

async function openProviderDirectory(page: Page, directory: ReadonlyArray<ProviderDirectoryEntry>) {
  await page.getByRole("button", { name: "Add provider", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Add provider", exact: true })
  await expect(dialog).toBeVisible()
  const search = dialog.getByRole("combobox", { name: "Search providers", exact: true })
  await expect(search).toBeEditable()
  const available = directory.filter((entry) => entry.integration !== undefined)
  await expect(dialog.getByRole("option")).toHaveCount(available.length)
  for (const entry of available) {
    await expect(dialog.getByRole("option", { name: providerName(entry), exact: true })).toHaveCount(1)
  }
  return { dialog, search }
}

test("connects a Provider API key directly while preserving the desktop draft", async ({ app, page }) => {
  const directory = await disableProviders(app)
  const anthropic = directory.find((entry) => entry.info.name === "anthropic")
  if (!anthropic?.integration) throw new Error("The real Provider directory is missing the Anthropic integration")
  const unsupported = directory.find((entry) => entry.integration === undefined)
  if (!unsupported) throw new Error("The real Provider directory has no unsupported catalog Provider")

  const draft = "Draft preserved while I connect a safe test provider"
  const { message, workspace } = await startProviderOnboarding(app, page, draft)
  const { dialog, search } = await openProviderDirectory(page, directory)

  const openAI = dialog.getByRole("option", { name: "OpenAI", exact: true })
  const bedrock = dialog.getByRole("option", { name: "Amazon Bedrock", exact: true })
  await expect(openAI.locator('[data-slot="provider-icon"] img')).toHaveCount(1)
  await expect(bedrock.locator('[data-slot="provider-icon"] img')).toHaveCount(1)

  await search.fill("Anthropic")
  await expect(dialog.getByRole("option", { name: "Anthropic", exact: true })).toBeVisible()
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await search.clear()
  await expect(dialog.getByRole("option")).toHaveCount(
    directory.filter((entry) => entry.integration !== undefined).length,
  )

  await expect(dialog.getByRole("option", { name: providerName(unsupported), exact: true })).toHaveCount(0)
  await dialog.getByRole("option", { name: "Anthropic", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Search models", exact: true })).toHaveCount(0)
  await expect(page.getByRole("list", { name: "Provider models", exact: true })).toHaveCount(0)
  const connection = page.getByRole("dialog", { name: "Connect Anthropic", exact: true })
  await expect(connection).toBeVisible()
  await expect(connection.getByLabel("Connection access", { exact: true })).toHaveCount(0)
  await expect(connection.getByLabel(/^Label/)).toHaveCount(0)

  const apiKey = connection.getByLabel("API key", { exact: true })
  await expect(apiKey).toBeEditable()
  await apiKey.fill("e2e-fixture-key-not-a-real-secret")
  await connection.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Saved Anthropic connection", exact: true })).toBeVisible()
  expect(
    await page
      .locator("input")
      .evaluateAll(
        (inputs, secret) => inputs.filter((input) => "value" in input && input.value === secret).length,
        "e2e-fixture-key-not-a-real-secret",
      ),
  ).toBe(0)
  await page.getByRole("button", { name: "Done", exact: true }).click()

  await expect
    .poll(async () => (await app.client.provider.list()).find((entry) => entry.info.name === "anthropic"))
    .toMatchObject({ active: true, connected: true, connectionCount: 1 })
  await expect(page.getByRole("heading", { name: "Activate a provider to start chatting" })).toHaveCount(0)
  await expect(message).toContainText(draft)
  await expect(page.getByRole("button", { name: /model/i })).toBeVisible()

  await page.goto(`/w/${workspace}/gateway/models`)
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible()
  await expect(page.getByRole("switch", { name: /in picker/i })).toHaveCount(0)
})

test("activates Bedrock on mobile after showing its complete credential requirements", async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const directory = await disableProviders(app)
  const draft = "Mobile draft preserved during provider activation"
  const { message, workspace } = await startProviderOnboarding(app, page, draft)
  const { dialog } = await openProviderDirectory(page, directory)

  const bedrock = dialog.getByRole("option", { name: "Amazon Bedrock", exact: true })
  await expect(bedrock.locator('[data-slot="provider-icon"] img')).toHaveCount(1)
  await bedrock.click()
  await expect(page.getByRole("heading", { name: "Amazon Bedrock", exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Search models", exact: true })).toHaveCount(0)
  await expect(page.getByRole("list", { name: "Provider models", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Bedrock API key", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "AWS credentials", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "AWS credentials", exact: true }).click()
  const connection = page.getByRole("dialog", { name: "Connect Amazon Bedrock", exact: true })
  await expect(connection.getByLabel("AWS access key ID", { exact: true })).toHaveAttribute("type", "password")
  await expect(connection.getByLabel("AWS secret access key", { exact: true })).toHaveAttribute("type", "password")
  await expect(connection.getByLabel(/AWS session token/)).toHaveAttribute("type", "password")
  // Any commercial or GovCloud region is accepted, so the region is typed rather than picked.
  await expect(connection.getByRole("textbox", { name: "AWS region", exact: true })).toBeEditable()
  await expect(connection.getByLabel("Connection access", { exact: true })).toHaveCount(0)
  await expect(connection.getByLabel(/^Label/)).toHaveCount(0)
  await expect(connection.getByRole("button", { name: "Connect", exact: true })).toBeDisabled()

  await connection.getByRole("button", { name: "Cancel", exact: true }).click()
  const reopened = await openProviderDirectory(page, directory)
  await reopened.dialog.getByRole("option", { name: "Amazon Bedrock", exact: true }).click()
  const deployment = page.getByRole("button", { name: "Use deployment AWS credentials", exact: true })
  await expect(deployment).toBeEnabled()
  await deployment.click()
  await expect
    .poll(async () => (await app.client.provider.list()).find((entry) => entry.info.name === "amazon-bedrock"))
    .toMatchObject({ active: true })
  await page.getByRole("button", { name: "Close", exact: true }).click()

  await expect(page.getByRole("heading", { name: "Activate a provider to start chatting" })).toHaveCount(0)
  await expect(message).toContainText(draft)

  await page.goto(`/w/${workspace}/gateway/models`)
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible()
  await expect(page.getByRole("switch", { name: "Enabled Nova Lite", exact: true })).toHaveCount(1)
  await expect(page.getByRole("switch", { name: /in picker/i })).toHaveCount(0)
})
