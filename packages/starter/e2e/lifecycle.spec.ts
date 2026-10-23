import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "./fixture.js"

test("stops an active real Run and keeps its durable partial output", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "cancel"))
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await expect(page.getByText(script.answer, { exact: true })).toBeVisible()
  await Promise.all([
    Effect.runPromise(app.llm.settled(app.data.session.id, "assistant")),
    page.getByRole("button", { name: "Stop", exact: true }).click(),
  ])
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(script.answer, { exact: true })).toHaveCount(1)
  await Effect.runPromise(app.llm.verify())
})

test("shows a real provider failure while retaining readable history", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "provider"))
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.wait(app.data.session.id, "assistant")),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await Effect.runPromise(app.llm.settled(app.data.session.id, "assistant"))
  await expect(page.getByRole("alert")).toContainText(script.answer)
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable()
  await page.reload()
  await expect(page.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
