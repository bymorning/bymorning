import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

/** A second Catalog Model on the fixture Provider; the fixture plugin still sends it to TestLLM. */
const routed = Chat.routedModel

test("empty providers.allow refuses in the browser", async ({ page, app }) => {
  const current = await app.client["api.config"].get()
  await app.client["api.config"].update({ ...current, providers: { allow: [] } })

  const prompt = "Refuse inference"
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(prompt)
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(messages.getByText(prompt, { exact: true })).toHaveCount(1)
  const alert = messages.getByRole("alert")
  await expect(alert).toHaveCount(1)
  await expect(alert).toContainText("content filter blocked the response")
  await expect(alert).toContainText("Session inference refused or unavailable")
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  expect(await Effect.runPromise(app.llm.list())).toEqual([])

  const persisted = await app.client.message.list({ sessionID: app.data.session.id })
  expect(persisted.data).toContainEqual(
    expect.objectContaining({
      type: "assistant",
      error: expect.objectContaining({
        _tag: "SessionError.ProviderError",
        category: "content-filter",
      }),
    }),
  )

  await page.reload()
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await expect(alert).toHaveCount(1)
  await expect(alert).toContainText("content filter blocked the response")
  await expect(alert).toContainText("Session inference refused or unavailable")
  expect(await Effect.runPromise(app.llm.list())).toEqual([])
  await Effect.runPromise(app.llm.verify())
})

test("routing from remaps this turn", async ({ page, app }) => {
  const current = await app.client["api.config"].get()
  await app.client["api.config"].update({ ...current, routing: [{ from: Chat.model, to: routed }] })
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))

  const requests = await Effect.runPromise(app.llm.list())
  expect(requests.length).toBeGreaterThan(0)
  for (const request of requests) expect(request.model).toBe(routed.id)

  const listed = await app.client.message.list({ sessionID: app.data.session.id })
  const assistants = listed.data.filter((message) => message.type === "assistant")
  expect(assistants.length).toBeGreaterThan(0)
  for (const message of assistants) {
    expect(message.model).toEqual(routed)
    expect(message.requestedModel).toEqual(Chat.model)
  }

  await Effect.runPromise(app.llm.verify())
})

test("routing when.tool remaps the next assistant turn", async ({ page, app }) => {
  const current = await app.client["api.config"].get()
  await app.client["api.config"].update({ ...current, routing: [{ when: { tool: "read" }, to: routed }] })
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const messages = page.locator('[data-component="message-timeline"]')
  const editor = page.getByRole("combobox", { name: "Message", exact: true })
  const send = page.getByRole("button", { name: "Send", exact: true })
  await editor.fill(script.prompt)
  await Promise.all([Effect.runPromise(app.llm.waitGate(script.gate)), send.click()])
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))

  const first = (await Effect.runPromise(app.llm.list())).filter((request) => request.purpose === "assistant")
  expect(first[0]?.model).toBe(Chat.model.id)
  const listed = await app.client.message.list({ sessionID: app.data.session.id, order: "asc" })
  const firstAssistants = listed.data.filter((message) => message.type === "assistant")
  expect(firstAssistants[0]).toMatchObject({ model: Chat.model })
  expect(firstAssistants[0]?.requestedModel).toBeUndefined()

  const secondPrompt = "What did the file say?"
  const secondAnswer = `It said ${app.data.content}.`
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "assistant", [
      {
        expect: (request) => {
          assert.equal(request.model, routed.id)
          assert.ok(
            request.messages.some(
              (message) => message.role === "user" && JSON.stringify(message.content).includes(secondPrompt),
            ),
          )
        },
        response: { type: "success", events: [{ text: secondAnswer }], usage: { input: 8, output: 4 } },
      },
    ]),
  )
  await editor.fill(secondPrompt)
  await Promise.all([Effect.runPromise(app.llm.settled(app.data.session.id, "assistant", 2)), send.click()])
  await expect(messages.getByText(secondAnswer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})

  const after = await app.client.message.list({ sessionID: app.data.session.id, order: "asc" })
  const assistants = after.data.filter((message) => message.type === "assistant")
  expect(assistants[0]).toMatchObject({ model: Chat.model })
  expect(assistants.slice(1)).toContainEqual(
    expect.objectContaining({ type: "assistant", model: routed, requestedModel: Chat.model }),
  )
  await Effect.runPromise(app.llm.verify())
})
