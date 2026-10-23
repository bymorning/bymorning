import { ShareScenario } from "@bymorning/testing/scenario/share"
import { Effect } from "effect"
import { expect, test as base } from "../fixtures/app.js"

const test = base.extend({
  appOptions: async ({}, use) => use({ plugins: ["@bymorning/plugin-share"] }),
})

test.use({ video: "on", screenshot: "on" })

test("rejects an invalid share token without a composer", async ({ page, app }) => {
  const workspaceID = app.data.owner.properties.workspaceID
  await page.goto(`/s/${workspaceID}/not-a-uuid`)
  await expect(page.getByRole("alert")).toContainText("This share link is not valid")
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0)
})

test("rejects an unknown share token without a composer", async ({ page, app }) => {
  const workspaceID = app.data.owner.properties.workspaceID
  await page.goto(`/s/${workspaceID}/00000000-0000-4000-8000-000000000000`)
  await expect(page.getByRole("alert")).toContainText("This link no longer points to a shared conversation")
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0)
})

test("shares from the session composer and opens the public page", async ({ page, app }, testInfo) => {
  const script = await Effect.runPromise(ShareScenario.script(app, app.data, "share"))
  const messages = page.locator('[data-component="message-timeline"]')
  const shots = (name: string) => testInfo.outputPath(name)
  await page.screenshot({ path: shots("01-session.png"), fullPage: true })
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await page.screenshot({ path: shots("02-typed.png"), fullPage: true })
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  const activity = messages.getByRole("button", { name: /Called share .*Collapsed/ })
  await expect(activity).toBeEnabled()
  await expect(activity.locator('[data-component="tool-trigger"]')).toHaveAttribute("data-status", "succeeded")
  await page.screenshot({ path: shots("03-share-tool.png"), fullPage: true })
  await activity.click()
  await page.screenshot({ path: shots("04-share-tool-open.png"), fullPage: true })
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  expect(script.grant.token).toMatch(/^[0-9a-f-]{36}$/i)
  await page.screenshot({ path: shots("05-share-url.png"), fullPage: true })
  const shareLink = page.getByRole("link", { name: script.grant.url })
  if ((await shareLink.count()) > 0) await shareLink.click()
  else await page.goto(script.grant.url)
  await expect(page).toHaveURL(new RegExp(`/s/${app.data.owner.properties.workspaceID}/${script.grant.token}$`))
  await expect(page.getByRole("heading", { name: script.title, exact: true })).toBeVisible()
  await expect(page.getByText(script.prompt, { exact: true })).toBeVisible()
  await expect(page.getByText(script.answer, { exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0)
  await page.screenshot({ path: shots("06-public.png"), fullPage: true })
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
