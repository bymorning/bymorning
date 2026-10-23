import type { Page, Response } from "@playwright/test"
import { Chat } from "@bymorning/testing/scenario/chat"
import { FormScenario } from "@bymorning/testing/scenario/form"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

const recovery = test.extend<{ eventResponse: Response[] }>({
  eventResponse: [async ({ context }, use) => {
    const responses: Response[] = []
    const record = (response: Response) => {
      if (new URL(response.url()).pathname === "/api/event" && response.ok()) responses.push(response)
    }
    context.on("response", record)
    try { await use(responses) } finally { context.off("response", record) }
  }, { auto: true }],
})

/** Navigate through the real SPA inventory, preserving the workspace runtime. */
async function select(page: Page, workspace: string, session: string) {
  await page.getByRole("navigation", { name: "Workspace navigation", exact: true })
    .getByRole("button", { name: "Overview", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  const sessions = page.getByRole("navigation", { name: "Sessions", exact: true })
  await sessions.locator(`a[href="/w/${workspace}/session/${session}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/session/${session}$`))
  await expect(page.locator('[data-component="session-workspace"]')).toHaveAttribute("data-session-sync", "ready")
  await expect(page.locator('[data-component="session-workspace"]')).toHaveAttribute("data-transcript-state", "ready")
}

test("returns to an active Session through A to B to A without reloading its workspace", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const second = await app.client.session.create({ workspace, projectID: app.data.project.id, model: Chat.model })
  const script = await Effect.runPromise(Chat.script(app, app.data, "cancel"))
  const timeline = page.locator('[data-component="message-timeline"]')
  const document = await page.locator("html").elementHandle()
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await expect(timeline.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()

  await select(page, workspace, second.id)
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await expect(timeline.getByText(script.prompt, { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(async () => (await app.client.session.active())[app.data.session.id]).toEqual({ type: "running" })

  await select(page, workspace, app.data.session.id)
  await expect(timeline.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(timeline.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  expect(await document?.evaluate((element) => element === element.ownerDocument.documentElement)).toBe(true)
  await Promise.all([
    Effect.runPromise(app.llm.settled(app.data.session.id, "assistant")),
    page.getByRole("button", { name: "Stop", exact: true }).click(),
  ])
  await expect.poll(() => app.client.session.active()).toEqual({})
  await expect(timeline.getByText("Interrupted", { exact: true })).toBeVisible()
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})

test("rehydrates a Session Form on return and keeps its accepted answer after another round trip", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const second = await app.client.session.create({ workspace, projectID: app.data.project.id, model: Chat.model })
  const form = await Effect.runPromise(FormScenario.createInteger(app, app.data))
  const response = page.getByRole("form", { name: "Fixture count", exact: true })
  await expect(response.getByRole("spinbutton", { name: "Count", exact: true })).toBeEditable()

  await select(page, workspace, second.id)
  await expect(response).toHaveCount(0)
  await select(page, workspace, app.data.session.id)
  await expect(response.getByRole("spinbutton", { name: "Count", exact: true })).toBeEditable()
  await response.getByRole("spinbutton", { name: "Count", exact: true }).fill("7")
  await response.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(response).toHaveCount(0)
  await expect.poll(() => app.client.form.state({ sessionID: app.data.session.id, formID: form.id })).toEqual({
    status: "answered", answer: { count: 7 },
  })
  await select(page, workspace, second.id)
  await select(page, workspace, app.data.session.id)
  await expect(response).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  expect(await app.client.form.list({ sessionID: app.data.session.id })).toEqual([])
})

recovery("recovers an actually disconnected event stream in the same browser runtime", async ({ page, context, app, eventResponse }) => {
  const sessionID = app.data.session.id
  const workspace = app.data.owner.properties.workspaceID
  const offlineGate = `${sessionID}:before-offline`
  const completionGate = `${sessionID}:after-offline`
  const prompt = "Continue this response through a network interruption."
  const before = "Before offline."
  const progress = " Recovered offline progress."
  const final = " Complete."
  await Effect.runPromise(app.llm.expect(sessionID, "title", [{
    expect: (request) => assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes(prompt))),
    response: { type: "success", events: [{ text: "Offline recovery" }] },
  }]))
  await Effect.runPromise(app.llm.expect(sessionID, "assistant", [{
    expect: (request) => assert.ok(request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes(prompt))),
    response: { type: "success", events: [{ text: before }, { gate: offlineGate }, { text: progress }, { gate: completionGate }, { text: final }] },
  }]))
  const timeline = page.locator('[data-component="message-timeline"]')
  const document = await page.locator("html").elementHandle()
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(offlineGate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await expect(timeline.getByText(before, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  const established = eventResponse.at(-1)
  assert.ok(established, "The browser must have an established real event response before disconnecting")
  expect(established.headers()["content-type"]).toContain("text/event-stream")
  expect(established.request().failure()).toBeNull()

  const observer = new AbortController()
  const events = app.client.event.subscribe({ workspace }, { signal: observer.signal })[Symbol.asyncIterator]()
  const connected = await events.next()
  expect(connected.value?.type).toBe("server.connected")
  try {
    // Require failure of the existing request, not merely navigator.onLine or a failed retry.
    // Offline emulation fails new requests but leaves an established stream flowing, so go offline
    // and then cut the stream's real connection at the web server.
    const disconnected = page.waitForEvent("requestfailed", { predicate: (request) => request === established.request() })
    await context.setOffline(true)
    expect(app.disconnect("/api/event")).toBeGreaterThan(0)
    const failed = await disconnected
    expect(failed.failure()).not.toBeNull()

    const progressed = (async () => {
      for (;;) {
        const next = await events.next()
        assert.ok(!next.done, "The real backend observer ended before offline progress")
        if (next.value.type === "session.text.delta" && next.value.data.sessionID === sessionID && next.value.data.text.includes(progress)) return
      }
    })()
    await Effect.runPromise(app.llm.release(offlineGate))
    await Promise.all([progressed, Effect.runPromise(app.llm.waitGate(completionGate))])
    // The backend observer has served its purpose; close it now rather than racing fixture teardown.
    observer.abort()
    await expect(timeline.getByText(before, { exact: true })).toHaveCount(1)
    await expect(timeline.getByText(before + progress, { exact: true })).toHaveCount(0)

    const reconnected = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/event" && response.ok())
    const recovered = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${sessionID}/message` && response.ok())
    await context.setOffline(false)
    const [stream] = await Promise.all([reconnected, recovered])
    expect(stream.request()).not.toBe(established.request())
    await expect(page.locator('[data-component="session-workspace"]')).toHaveAttribute("data-session-sync", "ready")
    await expect(timeline.getByText(before + progress, { exact: true })).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
    expect(await document?.evaluate((element) => element === element.ownerDocument.documentElement)).toBe(true)
    await Effect.runPromise(app.llm.release(completionGate))
    await expect(timeline.getByText(before + progress + final, { exact: true })).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
    await expect.poll(() => app.client.session.active()).toEqual({})
    await Effect.runPromise(app.llm.settled(sessionID, "title"))
    await Effect.runPromise(app.llm.verify())
  } finally {
    observer.abort()
    await context.setOffline(false)
  }
})
