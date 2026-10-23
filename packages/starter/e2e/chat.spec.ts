import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "./fixture.js"

test("logs in, creates a Session, and restores it from its URL", async ({ page, app }) => {
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable()
  const sessions = page.getByRole("complementary", { name: "Sessions", exact: true })
  await expect(sessions).toBeVisible()
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("session") !== app.data.session.id),
    page.getByRole("button", { name: "Create session", exact: true }).click(),
  ])
  expect(new URL(page.url()).searchParams.get("session")).not.toBe(app.data.session.id)
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable()
  await expect(page).toHaveURL(/\?workspace=.*&project=.*&session=.+/)
})

test("renders a real Tool result and persisted answer exactly once", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const editor = page.getByRole("textbox", { name: "Message", exact: true })
  let released = false
  try {
    await editor.fill(script.prompt)
    await Promise.all([
      Effect.runPromise(app.llm.waitGate(script.gate)),
      page.getByRole("button", { name: "Send", exact: true }).click(),
    ])
    await expect(page.getByText(app.data.content, { exact: true })).toBeVisible()
    await Effect.runPromise(app.llm.release(script.gate))
    released = true
  } finally {
    if (!released) await Effect.runPromise(app.llm.release(script.gate)).catch(() => undefined)
  }
  await expect(page.getByText(script.answer, { exact: true })).toHaveCount(1)
  await page.reload()
  await expect(page.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(script.answer, { exact: true })).toHaveCount(1)
  await Effect.runPromise(app.llm.verify())
})
