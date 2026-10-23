import { AuthScenario } from "@bymorning/testing/scenario/auth"
import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"

test("shows the signed-in email in the account dropdown across reload and login", async ({ page, app }) => {
  const trigger = page.getByRole("button", { name: "Open account menu", exact: true })
  await expect(trigger.getByText("owner@bymorning.ai", { exact: true })).toBeVisible()
  await trigger.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByText("owner@bymorning.ai", { exact: true })).toBeVisible()
  await menu.press("Escape")

  await page.reload()
  await expect(trigger.getByText("owner@bymorning.ai", { exact: true })).toBeVisible()
  await trigger.click()
  await menu.getByRole("menuitem", { name: "Log Out", exact: true }).click()
  await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
  await expect(trigger.getByText("owner@bymorning.ai", { exact: true })).toBeVisible()
  await trigger.click()
  await expect(menu.getByText("owner@bymorning.ai", { exact: true })).toBeVisible()
})

test("opens Login sessions from the account menu", async ({ page }) => {
  await page.getByRole("button", { name: "Open account menu", exact: true }).click()
  await page.getByRole("menuitem", { name: "Login sessions", exact: true }).click()

  const dialog = page.getByRole("dialog", { name: "Login sessions", exact: true })
  await expect(dialog.getByRole("heading", { name: "Login sessions", exact: true })).toBeVisible()
  await expect(dialog.getByText("This session", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Sign out", exact: true })).toBeVisible()
})

test("shows Console to admins and redirects members to their workspace overview", async ({ page, app }) => {
  const workspaceID = app.data.owner.properties.workspaceID
  const trigger = page.getByRole("button", { name: "Open account menu", exact: true })
  await trigger.click()
  const consoleItem = page.getByRole("menuitem", { name: "Console", exact: true })
  await expect(consoleItem).toBeVisible()
  await page.getByRole("menu").press("Escape")

  await Effect.runPromise(AuthScenario.loginMember(app))
  await page.context().clearCookies()
  await page.goto("/login")
  await expect(page).toHaveURL(new URL(`/w/${workspaceID}`, app.web).href)
  await page.goto(`/w/${workspaceID}/gateway`)

  await expect(page).toHaveURL(new URL(`/w/${workspaceID}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  await trigger.click()
  await expect(page.getByRole("menuitem", { name: "Console", exact: true })).toHaveCount(0)
})
