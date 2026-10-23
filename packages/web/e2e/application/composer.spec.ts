import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

test("keeps typing in the composer after sending, after the reply completes, and after Stop", async ({ page, app }) => {
  const sessionID = app.data.session.id
  const composer = page.getByRole("combobox", { name: "Message", exact: true })
  const timeline = page.locator('[data-component="message-timeline"]')
  const answered = {
    prompt: "Summarize the plan",
    answer: "Here is the plan.",
    title: "Plan summary",
    gate: "plan:answer",
  }
  const stopped = { prompt: "Keep researching", partial: "Researching the options...", gate: "plan:stop" }
  await Effect.runPromise(Chat.reply(app, sessionID, answered))
  await Effect.runPromise(
    app.llm.expect(sessionID, "assistant", [
      {
        expect: (request) =>
          assert.ok(
            request.messages.some(
              (message) => message.role === "user" && JSON.stringify(message.content).includes(stopped.prompt),
            ),
          ),
        response: { type: "cancel", gate: stopped.gate, text: [stopped.partial] },
      },
    ]),
  )

  // Sending with Enter drops the editor out of its editable state while the prompt is admitted.
  await composer.fill(answered.prompt)
  await Promise.all([Effect.runPromise(app.llm.waitGate(answered.gate)), composer.press("Enter")])
  await expect(timeline.getByText(answered.prompt, { exact: true })).toBeVisible()
  await expect(composer).toBeFocused()
  await page.keyboard.type("after sending")
  await expect(composer).toHaveText("after sending")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("Backspace")
  await expect(composer).toHaveText("")

  await Effect.runPromise(app.llm.release(answered.gate))
  await expect(timeline.getByText(answered.answer, { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect(composer).toBeFocused()
  await page.keyboard.type("after the reply")
  await expect(composer).toHaveText("after the reply")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("Backspace")
  await Effect.runPromise(app.llm.settled(sessionID, "title"))

  // Stop swaps its own button for Send, which would otherwise take focus with it.
  await composer.fill(stopped.prompt)
  await Promise.all([Effect.runPromise(app.llm.waitGate(stopped.gate)), composer.press("Enter")])
  await expect(timeline.getByText(stopped.partial, { exact: true })).toBeVisible()
  await Promise.all([
    Effect.runPromise(app.llm.settled(sessionID, "assistant", 1)),
    page.getByRole("button", { name: "Stop", exact: true }).click(),
  ])
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible()
  await expect(composer).toBeFocused()
  await page.keyboard.type("after stop")
  await expect(composer).toHaveText("after stop")
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.verify())
})

test("Escape closes the @ picker and keeps the draft", async ({ page, app }) => {
  const composer = page.getByRole("combobox", { name: "Message", exact: true })
  const picker = page.getByRole("listbox", { name: "References", exact: true })
  await composer.click()
  await page.keyboard.type(`Compare with @`)
  await expect(picker).toBeVisible()
  await page.keyboard.type("note")
  await expect(picker.getByRole("option", { name: app.data.path })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(picker).toHaveCount(0)
  await expect(composer).toBeFocused()
  await expect(composer).toHaveText("Compare with @note")
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
})
