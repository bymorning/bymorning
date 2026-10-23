import { expect, test } from "./fixture.js"

test("keeps the desktop session rail within its resize bounds", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const rail = page.locator(".shell-rail")
  const handle = page.locator("[data-component='resize-handle']")

  await expect(rail).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error("Session rail resize handle is missing")

  await handle.dispatchEvent("mousedown", { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })
  await page.mouse.move(1, box.y + box.height / 2)
  await page.mouse.up()
  await expect(rail).toHaveCSS("width", "140px")

  const bounded = await handle.boundingBox()
  if (!bounded) throw new Error("Session rail resize handle is missing")
  await handle.dispatchEvent("mousedown", {
    clientX: bounded.x + bounded.width / 2,
    clientY: bounded.y + bounded.height / 2,
  })
  await page.mouse.move(1000, bounded.y + bounded.height / 2)
  await page.mouse.up()
  await expect(rail).toHaveCSS("width", "520px")
})

test("opens the mobile session drawer, restores focus, and closes after selection", async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const trigger = page.getByRole("button", { name: "Open sessions", exact: true })
  const drawer = page.locator("[data-slot='mobile-drawer-content']")

  await trigger.click()
  await expect(drawer).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".shell")).toHaveAttribute("data-mobile-open", "false")
  await expect(page.locator("[data-slot='mobile-drawer-overlay']")).toHaveCount(0)
  await expect(drawer).toBeHidden()
  await expect(page.getByRole("complementary", { name: "Sessions", exact: true })).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")

  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await drawer.getByRole("navigation").getByRole("button").first().click()
  await expect(page.locator(".shell")).toHaveAttribute("data-mobile-open", "false")
  await expect(page).toHaveURL(new RegExp(`session=${app.data.session.id}`))

  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByRole("complementary", { name: "Sessions", exact: true })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable()
})

test("cleans up a reduced-motion drawer and closes it when the viewport becomes desktop", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 390, height: 844 })
  const trigger = page.getByRole("button", { name: "Open sessions", exact: true })
  const overlay = page.locator("[data-slot='mobile-drawer-overlay']")

  await trigger.click()
  await expect(overlay).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(overlay).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(overlay).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator(".shell")).toHaveAttribute("data-mobile-open", "false")
  await expect(overlay).toHaveCount(0)
  await expect(page.getByRole("complementary", { name: "Sessions", exact: true })).toHaveCount(1)
})

test("dismisses the drawer by dragging its handle immediately after opening", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const trigger = page.getByRole("button", { name: "Open sessions", exact: true })
  const handle = page.locator("[data-slot='mobile-drawer-handle']")
  const overlay = page.locator("[data-slot='mobile-drawer-overlay']")

  await trigger.click()
  const box = await handle.boundingBox()
  if (!box) throw new Error("Mobile drawer handle is missing")

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 300)
  await page.mouse.up()

  await expect(page.locator(".shell")).toHaveAttribute("data-mobile-open", "false")
  await expect(overlay).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test("closes the drawer on browser history navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const trigger = page.getByRole("button", { name: "Open sessions", exact: true })
  const overlay = page.locator("[data-slot='mobile-drawer-overlay']")

  await page.evaluate("history.pushState({}, '', location.href)")
  await trigger.click()
  await expect(overlay).toBeVisible()
  await page.goBack()

  await expect(page.locator(".shell")).toHaveAttribute("data-mobile-open", "false")
  await expect(overlay).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test("keeps shell chrome and rail sizing while navigating sessions", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const header = await page.locator(".shell-header").elementHandle()
  if (!header) throw new Error("Shell header is missing")
  const handle = page.locator("[data-component='resize-handle']")
  const box = await handle.boundingBox()
  if (!box) throw new Error("Session rail resize handle is missing")
  await handle.dispatchEvent("mousedown", { clientX: box.x, clientY: box.y + 20 })
  await page.mouse.move(360, box.y + 20)
  await page.mouse.up()
  const width = await page.locator(".shell-rail").evaluate((element) => element.getBoundingClientRect().width)

  await page.getByRole("button", { name: "Create session", exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`session=${app.data.session.id}`))
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable()
  expect(await header.evaluate((element) => element.isConnected)).toBe(true)
  await expect(page.locator(".shell-rail")).toHaveCSS("width", `${width}px`)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`session=${app.data.session.id}`))
  expect(await header.evaluate((element) => element.isConnected)).toBe(true)
  await expect(page.getByRole("complementary", { name: "Sessions", exact: true })).toHaveCount(1)
})
