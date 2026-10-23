import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/test-browser/timeline-harness.html?scenario=visual-subagents")
  await page.waitForFunction(() => window.timelineHarness !== undefined)
})

test("renders streaming, running, completed, background, error, and cancelled subagent cards", async ({ page }) => {
  await expect(page.getByRole("status", { name: "Delegating" })).toBeVisible()
  await expect(page.getByText("running-subagent task", { exact: true })).not.toHaveAttribute("href")

  const progress = page.getByRole("link", { name: "Explorer progress-subagent task Running" })
  await expect(progress).toHaveAttribute("href", "#session-00000000-0000-4000-8000-000000000010")
  await expect(progress).not.toContainText("(background)")
  await expect(page.getByRole("link", { name: "Explorer completed-subagent task Running" })).not.toContainText(
    "(background)",
  )
  await expect(
    page.getByRole("link", { name: "Explorer background-subagent task Running in background" }),
  ).toContainText("(background)")
  await expect(page.getByRole("link", { name: /failed-subagent task Error: Provider quota exhausted/ })).toContainText(
    "Provider quota exhausted",
  )
  await expect(page.getByRole("link", { name: /cancelled-subagent task Cancelled/ })).toBeVisible()
})

test("navigates from retained failure metadata and ends the spinner with child activity", async ({ page }) => {
  await page.getByRole("link", { name: /failed-subagent task Error: Provider quota exhausted/ }).click()
  await expect(page.locator("[data-opened-session]")).toHaveText("00000000-0000-4000-8000-000000000010")

  const background = page.getByRole("link", { name: "Explorer background-subagent task Running in background" })
  await expect(background.locator('[data-component="loader"]')).toBeVisible()
  await page.evaluate(() => window.timelineHarness.completeSubagents())
  const completed = page.getByRole("link", { name: "Explorer background-subagent task Completed" })
  await expect(completed).toBeVisible()
  await expect(completed.locator('[data-component="loader"]')).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Explorer completed-subagent task Completed" })).toBeVisible()
})

test("preserves native modifier and middle-click behavior", async ({ page, context }) => {
  const progress = page.getByRole("link", { name: "Explorer progress-subagent task Running" })
  const ctrlPage = context.waitForEvent("page")
  await progress.click({ modifiers: ["Control"] })
  await (await ctrlPage).close()
  await expect(page.locator("[data-opened-session]")).toHaveText("")

  const middlePage = context.waitForEvent("page")
  await progress.click({ button: "middle" })
  await (await middlePage).close()
  await expect(page.locator("[data-opened-session]")).toHaveText("")
})

test("places one hint in the bottom spacer and presents mixed active details", async ({ page }) => {
  await expect(page.locator('[data-timeline-key="subagent-background-hint"]')).toHaveCount(0)
  await expect(page.getByRole("status", { name: /Continue in background Ctrl\+B/ })).toBeVisible()
  const tasks = page.getByRole("group")
  await expect(tasks.getByText("2 tasks in background")).toBeVisible()
  await tasks.getByText("2 tasks in background").click()
  await expect(tasks).toContainText("background-subagent task")
  await expect(tasks).toContainText("bun test")

  const geometry = await page.evaluate(() => {
    const footer = document.querySelector('[data-slot="timeline-bottom-footer"]')?.getBoundingClientRect()
    const composer = document.querySelector('[data-slot="session-workspace-composer"]')?.getBoundingClientRect()
    return { footerBottom: footer?.bottom, composerTop: composer?.top }
  })
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.composerTop ?? 0)
})
