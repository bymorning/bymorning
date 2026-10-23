import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "./fixture.js"

test("two public Data observers share one Event connection and Message read while the remaining observer survives disposal", async ({
  page,
  app,
}) => {
  let streams = 0
  let messageReads = 0
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/event") streams += 1
  })
  await page.route(`**/api/session/${app.data.session.id}/message*`, async (route) => {
    messageReads += 1
    await route.fulfill({ response: await route.fetch() })
  })
  await page.goto(`/e2e/observer?workspace=${app.data.owner.properties.workspaceID}&session=${app.data.session.id}`)
  await expect(page.getByTestId("connection")).toHaveText("connected")
  await expect(page.getByTestId("first-state")).toHaveText("ready")
  await expect(page.getByTestId("second-state")).toHaveText("ready")
  expect(streams).toBe(1)
  expect(messageReads).toBe(1)

  await page.getByRole("button", { name: "Dispose first", exact: true }).click()
  await expect(page.getByRole("region", { name: "first observer", exact: true })).toHaveCount(0)
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    app.client.session.prompt({ sessionID: app.data.session.id, text: script.prompt }),
  ])
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(page.getByRole("region", { name: "second observer", exact: true })).toContainText(script.answer)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})

test("app-coordinated eviction keeps a held previous Message read out of the next Session", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    app.client.session.prompt({ sessionID: app.data.session.id, text: script.prompt }),
  ])
  await Effect.runPromise(app.llm.release(script.gate))
  const next = await app.client.session.create({ projectID: app.data.project.id })
  await page.goto(`/e2e/observer?workspace=${app.data.owner.properties.workspaceID}&session=${app.data.session.id}`)
  await expect(page.getByRole("region", { name: "second observer", exact: true })).toContainText(script.answer)
  const held = deferred<void>()
  const received = deferred<void>()
  await page.route(`**/api/session/${app.data.session.id}/message*`, async (route) => {
    const response = await route.fetch()
    received.resolve()
    await held.promise
    await route.fulfill({ response })
  })
  await Promise.all([received.promise, page.getByRole("button", { name: "Refresh second", exact: true }).click()])
  await page.getByRole("textbox", { name: "Session", exact: true }).fill(next.id)
  await expect(page.getByTestId("second-state")).toHaveText("ready")
  held.resolve()
  await expect(page.getByRole("region", { name: "second observer", exact: true })).not.toContainText(script.answer)
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
