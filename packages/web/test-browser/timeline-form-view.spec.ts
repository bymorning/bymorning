import { expect, test } from "@playwright/test"

test("keeps a long form compact and operable within a narrow viewport", async ({ page }) => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  await page.setViewportSize({ width: 300, height: 844 })
  await page.goto("/test-browser/form-view-harness.html")
  const form = page.getByRole("form", { name: "Add an external server" })
  const fields = form.locator("[data-slot='form-view-scroll']")
  const actions = form.locator("[data-slot='form-view-actions']")
  await expect(form).toBeVisible()
  const deploymentMode = form.getByRole("radiogroup", { name: "Deployment mode" })
  await expect(deploymentMode).toBeVisible()
  await expect(deploymentMode).toHaveAttribute("aria-labelledby", /field-label-/)
  await expect(form.getByRole("radio", { name: "MCP server (Recommended)" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: /Configuration notes/ })).toBeVisible()
  await expect(
    page.getByRole("link", { name: /Review the external deployment guide, opens in a new tab/i }),
  ).toHaveAttribute("target", "_blank")
  await expect(
    page.getByRole("checkbox", { name: /I opened and reviewed this page.*Review the external deployment guide/i }),
  ).toBeVisible()
  const custom = page.getByLabel(/Optional capabilities.* custom values/)
  const conditional = page.getByRole("textbox", { name: "Retention details" })
  await expect(custom).toBeAttached()
  await expect(conditional).toBeAttached()
  await custom.scrollIntoViewIfNeeded()
  await expect(custom).toBeVisible()
  await conditional.scrollIntoViewIfNeeded()
  await expect(conditional).toBeVisible()

  const geometry = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    formClientWidth: document.querySelector<HTMLElement>("[data-component='form-view']")?.clientWidth,
    formScrollWidth: document.querySelector<HTMLElement>("[data-component='form-view']")?.scrollWidth,
    fieldsClientWidth: document.querySelector<HTMLElement>("[data-slot='form-view-scroll']")?.clientWidth,
    fieldsScrollWidth: document.querySelector<HTMLElement>("[data-slot='form-view-scroll']")?.scrollWidth,
    fieldsClientHeight: document.querySelector<HTMLElement>("[data-slot='form-view-scroll']")?.clientHeight,
    fieldsScrollHeight: document.querySelector<HTMLElement>("[data-slot='form-view-scroll']")?.scrollHeight,
  }))
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth)
  expect(geometry.formScrollWidth).toBe(geometry.formClientWidth)
  expect(geometry.fieldsScrollWidth).toBe(geometry.fieldsClientWidth)
  expect(geometry.fieldsScrollHeight).toBeGreaterThan(geometry.fieldsClientHeight ?? Number.POSITIVE_INFINITY)
  expect(page.getByRole("textbox", { name: "Short name" })).not.toHaveAttribute("pattern")
  expect(errors.filter((message) => message.includes("pattern"))).toEqual([])

  const [cancel, submit, actionBox, scrollBox] = await Promise.all([
    form.getByRole("button", { name: "Cancel" }).boundingBox(),
    form.getByRole("button", { name: "Submit" }).boundingBox(),
    actions.boundingBox(),
    fields.boundingBox(),
  ])
  expect(cancel).not.toBeNull()
  expect(submit).not.toBeNull()
  expect(actionBox).not.toBeNull()
  expect(scrollBox).not.toBeNull()
  expect(Math.round((submit?.x ?? 0) - ((cancel?.x ?? 0) + (cancel?.width ?? 0)))).toBe(6)
  expect(Math.round(cancel?.y ?? 0)).toBe(Math.round(submit?.y ?? 0))
  expect((actionBox?.y ?? 0) >= (scrollBox?.y ?? 0) + (scrollBox?.height ?? 0)).toBe(true)
  expect((submit?.x ?? 0) + (submit?.width ?? 0)).toBeLessThanOrEqual((actionBox?.x ?? 0) + (actionBox?.width ?? 0))

  const short = page.getByRole("form", { name: "Quick choice" })
  await short.scrollIntoViewIfNeeded()
  const shortGeometry = await short.evaluate((element) => {
    const scroll = element.querySelector<HTMLElement>("[data-slot='form-view-scroll']")
    return {
      formHeight: element.clientHeight,
      fieldsClientHeight: scroll?.clientHeight,
      fieldsScrollHeight: scroll?.scrollHeight,
    }
  })
  expect(shortGeometry.fieldsScrollHeight).toBe(shortGeometry.fieldsClientHeight)
  expect(shortGeometry.formHeight).toBeLessThan(180)
})
