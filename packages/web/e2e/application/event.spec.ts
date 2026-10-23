import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"

test("reconnects a live conversation by reading the current saved timeline and activity", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const timeline = page.locator('[data-component="message-timeline"]')
  const editor = page.getByRole("combobox", { name: "Message", exact: true })
  await editor.fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])

  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  await expect(timeline.getByRole("button", { name: "Explored Collapsed", exact: true })).toBeVisible()

  // Reload closes the volatile Event stream. The new stream's connected marker must
  // cause state to be read again rather than relying on replayed deltas.
  await page.reload()
  await expect(editor).toBeEditable()
  await expect(timeline.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(timeline.getByRole("button", { name: "Explored Collapsed", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()

  await Effect.runPromise(app.llm.release(script.gate))
  await expect(timeline.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await Effect.runPromise(app.llm.verify())
})
