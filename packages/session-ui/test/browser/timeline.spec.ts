import { expect, test, type Page } from "@playwright/test"

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`)
  })
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`))
})

test.afterEach(({ page }) => expect(browserErrors.get(page), "browser errors").toEqual([]))

test("virtual transcript bounds DOM, retains its viewport, and resets for a new session", async ({ page }) => {
  await page.goto("/?virtual=1")
  const timeline = page.locator("[data-component='session-timeline']")
  await expect(timeline).toBeVisible()
  await expect(page.locator("[data-timeline-key='row:999']")).toBeInViewport()
  expect(await page.locator("[data-timeline-key]").count()).toBeLessThan(100)

  await timeline.evaluate((element) => {
    element.scrollTop = 2_000
    element.dispatchEvent(new Event("scroll"))
  })
  const anchor = await timeline.locator("[data-timeline-key]").evaluateAll(
    (rows, root) => {
      const rootTop = (root as HTMLElement).getBoundingClientRect().top
      const row = rows.find((item) => item.getBoundingClientRect().top >= rootTop)
      if (!row) throw new Error("A visible virtual row is required")
      return { key: (row as HTMLElement).dataset.timelineKey!, top: row.getBoundingClientRect().top }
    },
    await timeline.elementHandle(),
  )
  await page.getByRole("button", { name: "Prepend rows" }).click()
  const preserved = page.locator(`[data-timeline-key='${anchor.key}']`)
  await expect(preserved).toBeVisible()
  expect(Math.abs((await preserved.boundingBox())!.y - anchor.top)).toBeLessThan(3)

  const scrollTop = await timeline.evaluate((element) => {
    element.scrollTop = 1_000
    element.dispatchEvent(new Event("scroll"))
    return element.scrollTop
  })
  await page.getByRole("button", { name: "Append row" }).click()
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollTop, 0)

  await page.getByRole("button", { name: "Change session" }).click()
  await expect(timeline).toHaveAttribute("data-session-id", "browser-session-next")
  await expect(page.locator("[data-timeline-key='next:999']")).toBeInViewport()
  await expect(page.locator("[data-timeline-key='row:999']")).toHaveCount(0)
})

test("ordinary transcript retains all caller-owned canonical rows", async ({ page }) => {
  await page.goto("/?virtual=0")
  await expect(page.locator("[data-timeline-key]")).toHaveCount(1_000)
  await expect(page.locator("[data-timeline-key='row:0']")).toContainText("row 0")
  await expect(page.locator("[data-timeline-key='row:999']")).toContainText("row 999")
})
