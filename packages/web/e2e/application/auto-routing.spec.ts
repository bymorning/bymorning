import { Chat } from "@bymorning/testing/scenario/chat"
import { Provider } from "@bymorning/schema/provider"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

const general = { provider: Provider.Name.make("auto"), id: "general" }
const tierRule = {
  match: { model: general },
  to: {
    tiers: [
      { name: "fast", model: Chat.model, description: "Short factual questions" },
      { name: "deep", model: Chat.routedModel, description: "Multi-step work that reads files" },
    ],
    default: "fast",
    judge: { model: Chat.model, timeout: 10_000 },
  },
}

test("a member selects an Auto model and the judge chooses its tier for the whole turn", async ({ page, app }) => {
  const current = await app.client["api.config"].get()
  await app.client["api.config"].update({ ...current, routing: [tierRule] as typeof current.routing })
  // Pickers read Auto names when the Session opens.
  await page.reload()

  await page.getByRole("button", { name: /^Model, / }).click()
  await page.getByRole("combobox", { name: "Search models", exact: true }).fill("Auto")
  await page.getByRole("option", { name: /Auto · general/ }).click()
  await expect(page.getByRole("button", { name: "Model, Auto · general", exact: true })).toBeEnabled()
  await expect.poll(async () => (await app.client.session.get({ sessionID: app.data.session.id })).model).toEqual(general)

  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "route", [
      {
        expect: (request) => {
          assert.equal(request.model, Chat.model.id)
          assert.ok(JSON.stringify(request.messages).includes(script.prompt))
        },
        response: { type: "success", events: [{ text: '{"tier":"deep"}' }] },
      },
    ]),
  )
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))

  const requests = await Effect.runPromise(app.llm.list())
  expect(requests.filter((request) => request.purpose === "route")).toHaveLength(1)
  const turn = requests.filter((request) => request.purpose === "assistant")
  expect(turn).toHaveLength(2)
  for (const request of turn) expect(request.model).toBe(Chat.routedModel.id)
  await Effect.runPromise(app.llm.verify())
})
