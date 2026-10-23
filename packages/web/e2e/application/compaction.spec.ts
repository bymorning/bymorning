import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

test("shows queued compaction, its lifecycle, and the persisted context checkpoint", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const compactionGate = `${app.data.session.id}:compaction`
  const summary = [
    "## Objective",
    "- Read the project notes.",
    "",
    "## Work State",
    "- The requested file was read successfully.",
  ].join("\n")
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "compaction", [
      {
        expect: (request) => {
          const content = JSON.stringify(request.messages)
          assert.ok(content.includes(script.prompt), content)
          assert.ok(content.includes(script.answer), content)
          assert.equal(request.tools?.length ?? 0, 0)
        },
        response: {
          type: "success",
          events: [{ gate: compactionGate }, { text: summary }],
          usage: { input: 20, output: 10 },
        },
      },
    ]),
  )

  const timeline = page.locator('[data-component="message-timeline"]')
  const editor = page.getByRole("combobox", { name: "Message", exact: true })
  await editor.fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])

  await editor.fill("/compact")
  await page
    .getByRole("listbox", { name: "Commands", exact: true })
    .getByRole("option", { name: "/compact Summarize the session to reduce context size", exact: true })
    .click()
  const queued = timeline.getByRole("status").filter({ hasText: "Compaction queued" })
  await expect(queued).toContainText("Waiting for current work to finish.")
  await expect(queued).toContainText("Manual")

  await Promise.all([
    Effect.runPromise(app.llm.waitGate(compactionGate)),
    Effect.runPromise(app.llm.release(script.gate)),
  ])
  const running = timeline.getByRole("status").filter({ hasText: "Compacting session" })
  await expect(running).toContainText("Creating a shorter context checkpoint.")

  await Effect.runPromise(app.llm.release(compactionGate))
  const completed = timeline.getByRole("status").filter({ hasText: "Session compacted" })
  await expect(completed).toContainText("Future messages will use this checkpoint.")
  await completed.getByText("View context checkpoint", { exact: true }).click()
  await expect(completed.getByText("Read the project notes.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})

  await page.reload()
  await expect(editor).toBeEditable()
  const persisted = timeline.getByRole("status").filter({ hasText: "Session compacted" })
  await expect(persisted).toContainText("Future messages will use this checkpoint.")
  await persisted.getByText("View context checkpoint", { exact: true }).click()
  await expect(persisted.getByText("Read the project notes.", { exact: true })).toBeVisible()
  await expect(timeline.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(timeline.getByText(script.answer, { exact: true })).toHaveCount(1)

  const messages = await app.client.message.list({ sessionID: app.data.session.id, order: "asc", limit: 200 })
  expect(messages.data).toContainEqual(
    expect.objectContaining({ type: "compaction", reason: "manual", status: "completed", summary }),
  )
  await Effect.runPromise(app.llm.verify())
})
