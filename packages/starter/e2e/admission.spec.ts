import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "./fixture.js"

test("an Event acknowledgement before the real prompt HTTP response creates no duplicate timeline row", async ({
  page,
  app,
}) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const received = deferred<void>()
  const release = deferred<void>()
  await page.route(`**/api/session/${app.data.session.id}/prompt`, async (route) => {
    const response = await route.fetch()
    received.resolve()
    await release.promise
    await route.fulfill({ response })
  })

  await page.getByRole("textbox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    received.promise,
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  const timeline = page.getByRole("region", { name: "Conversation timeline", exact: true })
  await expect(timeline.getByText(script.prompt, { exact: true })).toHaveCount(1)
  release.resolve()
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(timeline.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(timeline.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
