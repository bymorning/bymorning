import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import type { Page, TestInfo } from "@playwright/test"
import { expect, test } from "../fixtures/app.js"

test.use({ video: "on", screenshot: "on" })
test.setTimeout(180_000)

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: 100 * 1024,
    uploadThroughput: 50 * 1024,
    connectionType: "cellular3g",
  })
}

function shots(testInfo: TestInfo, name: string) {
  return testInfo.outputPath(`chat-01-${name}.png`)
}

async function note(testInfo: TestInfo, label: string, value: unknown) {
  const text = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`
  console.log(`[probe] ${text}`)
  testInfo.annotations.push({ type: "probe", description: text })
}

async function visibleCopy(page: Page, locator: ReturnType<Page["locator"]>) {
  if ((await locator.count()) === 0) return null
  if (!(await locator.isVisible())) return null
  return (await locator.innerText()).trim()
}

test("sends a message under throttled network", async ({ page, app }, testInfo) => {
  await throttle(page)
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const messages = page.locator('[data-component="message-timeline"]')
  const editor = page.getByRole("combobox", { name: "Message", exact: true })
  const send = page.getByRole("button", { name: "Send", exact: true })
  const stop = page.getByRole("button", { name: "Stop", exact: true })
  const submit = page.locator('[data-slot="session-composer-submit"]')

  await editor.fill(script.prompt)
  await expect(send).toBeEnabled()
  await page.screenshot({ path: shots(testInfo, "typed.png"), fullPage: true })
  await note(testInfo, "typed.prompt", script.prompt)
  await note(testInfo, "typed.submit", await submit.getAttribute("aria-label"))

  const t0 = Date.now()
  await send.click()
  await page.screenshot({ path: shots(testInfo, "after-send.png"), fullPage: true })
  const immediate = {
    elapsedMs: Date.now() - t0,
    userMessage: await visibleCopy(page, messages.getByText(script.prompt, { exact: true })),
    sendCount: await send.count(),
    stopCount: await stop.count(),
    submit: await submit.getAttribute("aria-label"),
    submitDisabled: await submit.isDisabled(),
    timeline: await visibleCopy(page, messages),
  }
  await note(testInfo, "afterSend", immediate)

  await expect(messages.getByText(script.prompt, { exact: true })).toBeVisible()
  const userMessageMs = Date.now() - t0
  await note(testInfo, "userMessageMs", userMessageMs)

  await expect(stop).toBeVisible()
  const stopMs = Date.now() - t0
  await page.screenshot({ path: shots(testInfo, "stop.png"), fullPage: true })
  await note(testInfo, "stopMs", stopMs)
  await note(testInfo, "stop.submit", await submit.getAttribute("aria-label"))
  await note(testInfo, "stop.timeline", await visibleCopy(page, messages))

  const exploring = messages.getByRole("button", { name: "Exploring Collapsed", exact: true })
  const explored = messages.getByRole("button", { name: "Explored Collapsed", exact: true })
  await expect(exploring.or(explored)).toBeVisible()
  const toolMs = Date.now() - t0
  await page.screenshot({ path: shots(testInfo, "tool.png"), fullPage: true })
  await note(testInfo, "toolMs", toolMs)
  await note(testInfo, "tool.exploring", await exploring.isVisible())
  await note(testInfo, "tool.explored", await explored.isVisible())
  await note(testInfo, "tool.timeline", await visibleCopy(page, messages))
  const toolStatus = messages.locator('[data-component="tool-trigger"]')
  await note(
    testInfo,
    "tool.status",
    await toolStatus.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-status"))),
  )

  await Effect.runPromise(app.llm.waitGate(script.gate))
  const gatedMs = Date.now() - t0
  await page.screenshot({ path: shots(testInfo, "gated.png"), fullPage: true })
  await note(testInfo, "gatedMs", gatedMs)
  await note(testInfo, "gated.stop", await stop.isVisible())
  await note(testInfo, "gated.answer", await messages.getByText(script.answer, { exact: true }).count())
  await note(testInfo, "gated.timeline", await visibleCopy(page, messages))
  await note(
    testInfo,
    "gated.status",
    await toolStatus.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-status"))),
  )

  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(stop).toHaveCount(0)
  const answeredMs = Date.now() - t0
  await page.screenshot({ path: shots(testInfo, "answered.png"), fullPage: true })
  await note(testInfo, "answeredMs", answeredMs)
  await note(testInfo, "answered.timeline", await visibleCopy(page, messages))
  await Effect.runPromise(app.llm.verify())
})

test("opens right sidebar files under throttled network", async ({ page, app }, testInfo) => {
  await throttle(page)
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const toggle = page.getByRole("button", { name: "Right sidebar", exact: true })
  const loadingFiles = sidebar.getByText("Loading Project files…", { exact: true })
  const waitingFiles = sidebar.getByText("Waiting for Project files…", { exact: true })
  const emptyFiles = sidebar.getByText("This Project has no files.", { exact: true })
  const file = sidebar.getByRole("treeitem", { name: app.data.path, exact: true })
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  const selectPreview = preview.getByText("Select a file to preview.", { exact: true })
  const loadingFile = preview.getByText("Loading file…", { exact: true })

  const t0 = Date.now()
  await toggle.click()
  await expect(sidebar).toBeVisible()
  await page.screenshot({ path: shots(testInfo, "sidebar-open.png"), fullPage: true })
  await expect(sidebar.getByRole("button", { name: "Hide file tree", exact: true })).toBeVisible()
  await expect(loadingFiles.or(waitingFiles).or(emptyFiles).or(file)).toBeVisible()
  const listStateMs = Date.now() - t0
  const listState = {
    elapsedMs: listStateMs,
    loading: await loadingFiles.isVisible(),
    waiting: await waitingFiles.isVisible(),
    empty: await emptyFiles.isVisible(),
    file: await file.isVisible(),
    copy: await visibleCopy(page, sidebar),
  }
  await page.screenshot({ path: shots(testInfo, "sidebar-list.png"), fullPage: true })
  await note(testInfo, "sidebar.list", listState)

  if (listState.loading || listState.waiting) {
    await page.screenshot({ path: shots(testInfo, "sidebar-loading.png"), fullPage: true })
  }

  await expect(file.or(emptyFiles)).toBeVisible()
  const listReadyMs = Date.now() - t0
  await page.screenshot({ path: shots(testInfo, "sidebar-ready.png"), fullPage: true })
  await note(testInfo, "sidebar.readyMs", listReadyMs)
  await note(testInfo, "sidebar.readyCopy", await visibleCopy(page, sidebar))
  await note(testInfo, "sidebar.previewBeforeClick", await visibleCopy(page, preview))
  await note(testInfo, "sidebar.selectPreview", await selectPreview.isVisible())

  if (await file.isVisible()) {
    const tClick = Date.now()
    await file.click()
    await expect(loadingFile.or(preview.getByText(app.data.content))).toBeVisible()
    const previewState = {
      elapsedMs: Date.now() - tClick,
      loading: await loadingFile.isVisible(),
      content: await preview.getByText(app.data.content).isVisible(),
      copy: await visibleCopy(page, preview),
    }
    await page.screenshot({ path: shots(testInfo, "sidebar-preview.png"), fullPage: true })
    await note(testInfo, "sidebar.preview", previewState)
    if (previewState.loading) {
      await page.screenshot({ path: shots(testInfo, "sidebar-preview-loading.png"), fullPage: true })
    }
    await expect(preview).toContainText(app.data.content)
    await note(testInfo, "sidebar.previewReadyMs", Date.now() - tClick)
    await note(testInfo, "sidebar.previewReadyCopy", await visibleCopy(page, preview))
  }
})
