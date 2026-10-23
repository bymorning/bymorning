import { Effect } from "effect"
import { Chat } from "@bymorning/testing/scenario/chat"
import { expect, makeTest } from "../fixtures/app.js"

/** A real administrator whose Workspace has no Provider connection and no Session yet. */
const fresh = makeTest((app) => Effect.map(app.login(), (owner) => ({ owner })))

const seeded = makeTest(Chat.make)

fresh.describe("first visit", () => {
  fresh("lands a new administrator on the checklist and carries them into a first session", async ({ app, page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const workspace = app.data.owner.properties.workspaceID
    const directory = await app.client.provider.list()
    const target = directory.find((entry) => entry.info.name === "opencode")
    if (!target?.integration) throw new Error("The real Provider directory is missing the OpenCode integration")
    const label = target.info.displayName ?? target.integration.name

    // Sign-in lands straight on Overview; with no Session yet the checklist is the whole page.
    await page.goto("/login")
    await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
    const checklist = page.getByRole("region", { name: "Getting started", exact: true })
    await expect(checklist).toBeVisible()
    const steps = checklist.getByRole("list", { name: "Getting started steps", exact: true })
    await expect(steps.locator('li[data-step="provider"]')).toHaveAttribute("data-state", "pending")
    await expect(steps.locator('li[data-step="session"]')).toHaveAttribute("data-state", "pending")
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toHaveCount(0)

    // The provider step connects inline through the same directory dialog as the Integrations page.
    await steps.locator('li[data-step="provider"]').getByRole("button", { name: "Add provider", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add provider", exact: true })
    await dialog.getByRole("option", { name: label, exact: true }).click()
    const connection = page.getByRole("dialog", { name: `Connect ${label}`, exact: true })
    await expect(connection).toBeVisible()
    await connection.getByLabel("API key", { exact: true }).fill("e2e-fixture-key-not-a-real-secret")
    await connection.getByRole("button", { name: "Connect", exact: true }).click()
    // A key connection is stored, not verified; the model's first request checks it.
    await expect(page.getByRole("heading", { name: `Saved ${label} connection`, exact: true })).toBeVisible()
    await expect(page.getByText("The key is stored but has not been checked.", { exact: false })).toBeVisible()
    await page.getByRole("button", { name: "Done", exact: true }).click()

    await expect
      .poll(async () => (await app.client.provider.list()).find((entry) => entry.info.name === "opencode"))
      .toMatchObject({ active: true, connected: true })
    await expect(steps.locator('li[data-step="provider"]')).toHaveAttribute("data-state", "done")
    await expect(checklist.getByText(/of 6 complete/)).toBeVisible()

    // The session step opens a real draft; there is no activation gate now that a provider is connected.
    await steps.locator('li[data-step="session"] [data-action="getting-started-session"]').click()
    await expect(page).toHaveURL(new RegExp(`/w/${workspace}/new-session\\?draftId=`))
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Activate a provider to start chatting" })).toHaveCount(0)

    // Back on Overview the provider outcome persists; skips and dismissal are browser-local.
    await page.goto(`/w/${workspace}`)
    await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
    await expect(checklist).toBeVisible()
    await expect(steps.locator('li[data-step="provider"]')).toHaveAttribute("data-state", "done")
    await steps.locator('li[data-step="budget"] [data-action="getting-started-skip"]').click()
    await expect(steps.locator('li[data-step="budget"]')).toHaveAttribute("data-state", "skipped")
    await checklist.getByRole("button", { name: "Dismiss", exact: true }).click()
    await expect(checklist).toHaveCount(0)
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Getting started", exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

seeded.describe("seeded workspace", () => {
  seeded("marks the connected provider and existing session complete", async ({ app, page }) => {
    const workspace = app.data.owner.properties.workspaceID
    await page.goto("/login")
    await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
    const checklist = page.getByRole("region", { name: "Getting started", exact: true })
    await expect(checklist).toBeVisible()
    const steps = checklist.getByRole("list", { name: "Getting started steps", exact: true })
    await expect(steps.locator('li[data-step="provider"]')).toHaveAttribute("data-state", "done")
    await expect(steps.locator('li[data-step="session"]')).toHaveAttribute("data-state", "done")
    await expect(checklist.getByText("2 of 6 complete")).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
  })
})
