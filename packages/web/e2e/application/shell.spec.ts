import { expect, makeTest, test } from "../fixtures/app.js"
import { Chat } from "@bymorning/testing/scenario/chat"

/** A real administrator whose browser has not opened any page yet. */
const signedIn = makeTest(Chat.make)

signedIn(
  "an unknown Workspace URL says it is unavailable and leads back to a real Workspace",
  async ({ page, app }) => {
    const workspace = app.data.owner.properties.workspaceID
    await page.goto("/login")
    await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)

    await page.goto("/w/wrk_doesnotexist")
    await expect(page.getByRole("heading", { name: "Workspace unavailable", exact: true })).toBeVisible()
    await expect(page.getByText("This workspace does not exist or you do not have access to it.")).toBeVisible()
    await expect(page).toHaveTitle("Workspace unavailable · ByMorning")

    await page.getByRole("link", { name: "Go to your workspace", exact: true }).click()
    await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  },
)

test("a malformed Session ID says the session cannot be found and returns to Overview", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  await page.goto(`/w/${workspace}/session/not-a-session`)
  const message = page.getByRole("alert").filter({ hasText: "This session cannot be found." })
  await expect(message).toBeVisible()
  await message.getByRole("button", { name: "Return to Overview", exact: true }).click()
  await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
})

test("the document title names the current page", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const header = page.locator('[data-component="session-header"]')
  await header.getByRole("button", { name: "Rename session Untitled", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Session title", exact: true })
  await editor.fill("Planning notes")
  await editor.press("Enter")
  await expect(header.getByRole("heading", { name: "Rename session Planning notes", exact: true })).toBeVisible()
  await expect(page).toHaveTitle("Planning notes · ByMorning")

  const navigation = page.getByRole("navigation", { name: "Workspace navigation", exact: true })
  await navigation.getByRole("button", { name: "Overview", exact: true }).click()
  await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await expect(page).toHaveTitle("Overview · ByMorning")

  await page.goto(`/w/${workspace}/members`)
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible()
  await expect(page).toHaveTitle("Members · ByMorning")
})

test("the command palette offers Session commands while a session is open", async ({ page }) => {
  // The emulated desktop browser reports a non-Mac platform, so the mod key is Control.
  await page.keyboard.press("Control+k")
  const palette = page.getByRole("dialog", { name: "Commands", exact: true })
  await expect(palette).toBeVisible()
  await palette.getByRole("combobox", { name: "Search commands", exact: true }).fill("archive")
  await expect(palette.getByRole("option", { name: /Archive session/ })).toBeVisible()
})

test("the command palette drops Session commands after leaving the session", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  await page
    .getByRole("navigation", { name: "Workspace navigation", exact: true })
    .getByRole("button", { name: "Overview", exact: true })
    .click()
  await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()

  await page.keyboard.press("Control+k")
  const palette = page.getByRole("dialog", { name: "Commands", exact: true })
  await expect(palette).toBeVisible()
  const search = palette.getByRole("combobox", { name: "Search commands", exact: true })
  // Appearance commands are still offered, so the palette has loaded; only the Session ones are gone.
  await search.fill("reasoning")
  await expect(palette.getByRole("option", { name: /reasoning summaries/ })).toBeVisible()
  await search.fill("archive")
  await expect(palette.getByText("No commands found", { exact: true })).toBeVisible()
  await expect(palette.getByRole("option", { name: /Archive session/ })).toHaveCount(0)
})
