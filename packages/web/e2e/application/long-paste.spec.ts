import type { Request } from "@bymorning/testing/llm"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

// A pasted document well past the former 8,000 character composer limit is kept whole,
// sends, reaches the model intact, and renders in the transcript.
test("pastes and sends a long document through the real clipboard", async ({ page, app, context }) => {
  const document = `LONG-PASTE-START ${"The quick brown fox jumps over the lazy dog. ".repeat(6_700)}LONG-PASTE-END`
  const answer = "Summarized the long document."
  const sessionID = app.data.session.id
  const includesWholeDocument = (request: Request) =>
    assert.ok(
      request.messages.some(
        (message) => message.role === "user" && JSON.stringify(message.content).includes(document),
      ),
      "The whole pasted document must reach the model",
    )
  await Effect.runPromise(
    app.llm.expect(sessionID, "title", [
      { expect: includesWholeDocument, response: { type: "success", events: [{ text: "Long document" }] } },
    ]),
  )
  await Effect.runPromise(
    app.llm.expect(sessionID, "assistant", [
      { expect: includesWholeDocument, response: { type: "success", events: [{ text: answer }] } },
    ]),
  )

  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const editor = page.getByRole("combobox", { name: "Message", exact: true })
  await editor.click()
  await page.evaluate(
    (text) =>
      (globalThis as unknown as { navigator: { clipboard: { writeText: (value: string) => Promise<void> } } }).navigator.clipboard.writeText(text),
    document,
  )
  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(() => editor.evaluate((element) => element.textContent?.length ?? 0)).toBe(document.length)

  await page.getByRole("button", { name: "Send", exact: true }).click()
  const timeline = page.locator('[data-component="message-timeline"]')
  await expect(timeline.getByText(answer, { exact: true })).toHaveCount(1)
  await expect(timeline).toContainText("LONG-PASTE-END")
  await expect(editor).toHaveText("")
  await Effect.runPromise(app.llm.settled(sessionID, "title"))
  await Effect.runPromise(app.llm.verify())
})
