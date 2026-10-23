import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "./fixture.js"

test("loads an older real Message page without losing chronological identity", async ({ page, app }) => {
  const session = await app.client.session.create({ projectID: app.data.project.id })
  const prompts = Array.from({ length: 51 }, (_, index) => `Pagination prompt ${index + 1}`)
  await Effect.runPromise(
    app.llm.expect(session.id, "title", [
      {
        expect: (request) => assert.ok(JSON.stringify(request.messages).includes(prompts[0]!)),
        response: { type: "success", events: [{ text: "Pagination" }] },
      },
    ]),
  )
  await Effect.runPromise(
    app.llm.expect(
      session.id,
      "assistant",
      prompts.map((prompt, index) => ({
        expect: (request) =>
          assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(prompt))),
        response: { type: "success", events: [{ text: `Pagination reply ${index + 1}` }] },
      })),
    ),
  )
  for (const prompt of prompts) await app.client.session.prompt({ sessionID: session.id, text: prompt })
  await Effect.runPromise(app.llm.settled(session.id, "assistant", prompts.length - 1))

  await page.goto(`/?workspace=${app.data.owner.properties.workspaceID}&session=${session.id}`)
  const timeline = page.getByRole("region", { name: "Conversation timeline", exact: true })
  await expect(timeline.getByText("Pagination reply 51", { exact: true })).toBeVisible()
  await expect(timeline.getByRole("button", { name: "Load earlier messages", exact: true })).toBeEnabled()
  await timeline.getByRole("button", { name: "Load earlier messages", exact: true }).click()
  await expect(timeline.getByRole("button", { name: "Load earlier messages", exact: true })).toBeEnabled()
  await timeline.getByRole("button", { name: "Load earlier messages", exact: true }).click()
  await expect(timeline.getByText("Pagination prompt 1", { exact: true })).toHaveCount(1)
  await expect(timeline.getByText("Pagination reply 51", { exact: true })).toHaveCount(1)
  await Effect.runPromise(app.llm.settled(session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
