import assert from "node:assert/strict"

import { Effect } from "effect"

import { expect, test } from "./fixture.js"

test("renders a real streamed rich Markdown answer only after its model stream settles", async ({ page, app }) => {
  const gate = `${app.data.session.id}:rich-markdown`
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "assistant", [
      {
        expect: (request) =>
          assert.ok(
            request.messages.some((message) => JSON.stringify(message.content).includes("Render rich Markdown")),
          ),
        response: {
          type: "success",
          events: [{ text: "# Result\n\n- one\n" }, { text: "- two\n\n```ts\nconst value = 1\n```" }, { gate }],
        },
      },
    ]),
  )
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "title", [
      { expect: () => undefined, response: { type: "success", events: [{ text: "Result" }] } },
    ]),
  )

  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Render rich Markdown")
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  const answerView = page
    .locator("[data-component='assistant-message']")
    .filter({ has: page.getByRole("heading", { name: "Result", exact: true }) })
  await expect(answerView.getByRole("heading", { name: "Result", exact: true })).toBeVisible()
  await expect(answerView.getByRole("list")).toContainText("one")
  await expect(answerView.locator("script")).toHaveCount(0)
  await Effect.runPromise(app.llm.release(gate))
  await expect(answerView.getByText("const value = 1", { exact: true })).toBeVisible()
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
