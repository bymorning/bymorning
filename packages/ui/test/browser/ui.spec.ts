import { expect, test } from "@playwright/test"

test("loads every public primitive and package assets under a nested base path", async ({ page }) => {
  const failures: string[] = []
  const assets: string[] = []
  page.on("pageerror", (error) => failures.push(error.message))
  page.on("requestfailed", (request) => failures.push(request.url()))
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
    if (/\.(?:woff2|ttf|svg)$/.test(response.url())) assets.push(response.url())
  })
  await page.goto("./")
  await expect(page.getByRole("heading", { name: "ByMorning UI", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Primary action", exact: true })).toHaveCSS("height", "28px")
  await expect(page.getByRole("button", { name: "Disabled", exact: true })).toBeDisabled()
  await page.evaluate(async () => {
    await document.fonts.load('400 13px "Inter"')
    await document.fonts.load('400 13px "JetBrains Mono"')
    await document.fonts.load('400 13px "Atkinson Hyperlegible Next"')
    await document.fonts.ready
  })
  expect(assets.every((url) => new URL(url).pathname.startsWith("/ui/assets/"))).toBe(true)
  expect(failures).toEqual([])
})

test("preloads a saved theme before application JavaScript executes", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bymorning-theme-id", "ink")
    localStorage.setItem("bymorning-color-scheme", "light")
  })
  await page.route("**/assets/*.js", (route) => route.abort())
  await page.goto("./")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ink")
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  await expect(page.locator("#root")).toBeEmpty()
  await expect
    .poll(() => page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--color-bg-deep").trim()))
    .not.toBe("")
})

test("applies all six theme combinations, system changes, and cross-tab changes", async ({ page, context }) => {
  await page.goto("./")
  const colors = new Set<string>()
  for (const theme of ["bymorning", "ink", "paper"]) {
    for (const scheme of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme)
      await page.getByRole("combobox", { name: "Scheme", exact: true }).selectOption(scheme)
      await expect(page.getByLabel("Theme state", { exact: true })).toHaveText(`${theme}:${scheme}:${scheme}`)
      await expect(page.locator("html")).toHaveCSS("color-scheme", scheme)
      colors.add(
        await page.getByRole("button", { name: "Primary action", exact: true }).evaluate((el) => {
          const css = getComputedStyle(el)
          return `${css.backgroundColor}|${css.backgroundImage}|${css.color}`
        }),
      )
    }
  }
  expect(colors.size).toBeGreaterThan(1)
  await page.getByRole("combobox", { name: "Scheme", exact: true }).selectOption("system")
  await page.emulateMedia({ colorScheme: "light" })
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")

  const other = await context.newPage()
  await other.goto("./")
  await other.getByRole("combobox", { name: "Theme", exact: true }).selectOption("bymorning")
  await other.getByRole("combobox", { name: "Scheme", exact: true }).selectOption("light")
  await expect(page.getByLabel("Theme state", { exact: true })).toHaveText("bymorning:light:light")
  await other.close()
})

test("preserves controlled inputs, selection, disclosure, tree and scrolling", async ({ page }) => {
  await page.goto("./")
  await page.getByRole("textbox", { name: "Account name", exact: true }).fill("Ada")
  await page.getByText("Accept terms", { exact: true }).click()
  await expect(page.getByRole("checkbox", { name: "Accept terms", exact: true })).toBeChecked()
  await page.getByText("Push", { exact: true }).click()
  await expect(page.getByRole("radio", { name: "Push", exact: true })).toBeChecked()
  await page.getByRole("button", { name: "List", exact: true }).click()
  await expect(page.getByLabel("Control state", { exact: true })).toHaveText("Ada|checked|two|two")
  await page.getByRole("button", { name: "Search selection", exact: true }).click()
  await page.getByRole("combobox", { name: "Search options", exact: true }).fill("Beta")
  await page.getByRole("combobox", { name: "Search options", exact: true }).press("Enter")
  await expect(page.getByLabel("Selection state", { exact: true })).toContainText("Alpha|beta")
  await page.getByRole("button", { name: "Accordion details", exact: true }).click()
  await expect(page.getByText("Accordion content", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Collapsible details", exact: true }).click()
  await expect(page.getByText("Collapsible content", { exact: true })).toBeVisible()
  await page.getByRole("treeitem", { name: "index.ts", exact: true }).click()
  await expect(page.getByLabel("Selected file", { exact: true })).toHaveText("src/index.ts")
  const scroll = page.locator('[data-slot="scroll-view-viewport"]')
  await scroll.focus()
  await scroll.press("End")
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(500)
})

test("composes menus and selects inside stacked dialogs and restores focus", async ({ page }) => {
  await page.goto("./")
  const trigger = page.getByRole("button", { name: "Open dialog", exact: true })
  await trigger.click()
  const first = page.getByRole("dialog", { name: "Dialog 1", exact: true })
  await expect(first.getByRole("textbox", { name: "Dialog text", exact: true })).toBeFocused()
  await first.getByRole("button", { name: "Actions for Dialog row", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit row", exact: true }).click()
  await expect(first.getByText("Edited", { exact: true })).toBeVisible()
  // The host owns viewport sizing (fixture.css), so the document has nothing to scroll. If it did, Playwright
  // would scroll it and a menu portaled to <body> would move on screen before its popper re-measures, so a
  // click could land where the item used to be: this step failed that way on slow CI runners.
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight),
  ).toBe(0)
  await first.locator('[data-component="select"]').click()
  await page.getByRole("option", { name: "Beta", exact: true }).click()
  await expect(first.locator('[data-component="select"]')).toContainText("Beta")
  await first.getByRole("button", { name: "Push dialog", exact: true }).click()
  const top = page.getByRole("dialog", { name: "Dialog 2", exact: true })
  await expect(top.getByRole("textbox", { name: "Dialog text", exact: true })).toBeFocused()
  await top.getByRole("button", { name: "Actions for Dialog row", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit row", exact: true }).click()
  await expect(top.getByText("Edited", { exact: true })).toBeVisible()
  await top.getByText("Help", { exact: true }).hover()
  await expect(page.getByRole("tooltip")).toHaveText("Dialog help")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await top.press("Escape")
  await expect(top).toHaveCount(0)
  await expect(first).toBeVisible()
  await first.getByRole("button", { name: "Close dialog", exact: true }).click()
  await expect(first).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test("confirmation, toasts and provider teardown use the public contracts", async ({ page }) => {
  await page.goto("./")
  await page.getByRole("button", { name: "Open confirmation", exact: true }).click()
  await page.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Show toast", exact: true }).click()
  await expect(page.getByText("The action completed", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Dismiss", exact: true }).click()
  await expect(page.getByText("The action completed", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Open dialog", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  // The fixture's host can unmount a subtree while that subtree traps input.
  await page.getByTestId("mount").evaluate((el) => (el as HTMLButtonElement).click())
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator('[data-component="dialog-stack"]')).toHaveCount(0)
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await page.getByRole("button", { name: "Mount gallery", exact: true }).click()
  await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeVisible()
})
