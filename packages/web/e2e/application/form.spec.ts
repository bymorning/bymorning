import { FormScenario } from "@bymorning/testing/scenario/form"
import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"

test("an authenticated member answers a caller-bound Form without a Session", async ({ page, app }) => {
  const form = await Effect.runPromise(FormScenario.createCaller(app, app.data))
  const workspace = app.data.owner.properties.workspaceID
  await page.goto(`/w/${workspace}/form/${form.id}`)
  const response = page.getByRole("form", { name: "Authorize connection", exact: true })
  await expect(response.getByRole("link", { name: /Open link.*Authorization page/ })).toHaveAttribute(
    "href",
    "https://example.test/authorize",
  )
  await expect(response.getByRole("checkbox", { name: /I opened and reviewed this page/ })).toBeVisible()
  const decision = response.locator('[data-component="select"]')
  await expect(decision).toBeVisible()
  await response.locator('[data-slot="checkbox-control"]').click()
  await decision.click()
  await expect(page.getByRole("option", { name: "Continue", exact: true })).toBeVisible()
  await expect(page.getByRole("option", { name: "Decline", exact: true })).toBeVisible()
  await page.getByRole("option", { name: "Continue", exact: true }).click()
  await response.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${workspace}/form$`))
  await expect(page.getByText("No forms need your response.", { exact: true })).toBeVisible()
  await expect.poll(() => app.client.form.caller.state({ workspace, formID: form.id })).toEqual({
    status: "answered",
    answer: { review: true, action: "continue" },
  })
  await page.reload()
  await expect(page.getByText("No forms need your response.", { exact: true })).toBeVisible()
})
