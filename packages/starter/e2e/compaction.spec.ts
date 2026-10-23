import { Chat } from "@bymorning/testing/scenario/chat"
import { Session } from "@bymorning/core/session"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "./fixture.js"

test("admits a manual compaction behind real work and retains its completed control Message", async ({ page, app }) => {
  const chat = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const gate = `${app.data.session.id}:compaction`
  const summary = "Pagination-safe context checkpoint"
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "compaction", [
      {
        expect: (request) => {
          assert.ok(JSON.stringify(request.messages).includes(chat.prompt))
          assert.equal(request.tools?.length ?? 0, 0)
        },
        response: { type: "success", events: [{ gate }, { text: summary }] },
      },
    ]),
  )
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(chat.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(chat.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await page.getByRole("button", { name: "Compact", exact: true }).click()
  await Promise.all([Effect.runPromise(app.llm.waitGate(gate)), Effect.runPromise(app.llm.release(chat.gate))])
  await Effect.runPromise(app.llm.release(gate))
  await Effect.runPromise(
    app.workspace(
      { account: app.data.account },
      Session.Service.use((sessions) => sessions.awaitIdle(app.data.session.id)),
    ),
  )
  const messages = await app.client.message.list({ sessionID: app.data.session.id, order: "asc", limit: 200 })
  expect(messages.data).toContainEqual(expect.objectContaining({ type: "compaction", status: "completed", summary }))
  await page.reload()
  await expect(page.getByRole("region", { name: "Conversation timeline", exact: true })).toContainText(summary)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
