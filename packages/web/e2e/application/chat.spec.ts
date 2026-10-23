import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

test("reads a project file and preserves the conversation after reload", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  const gated = Effect.runPromise(app.llm.waitGate(script.gate))
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await gated
  await expect(messages.getByRole("status", { name: "Thinking" })).toBeVisible()

  const explored = messages.getByRole("button", { name: "Explored Collapsed", exact: true })
  await expect(explored).toBeEnabled()
  await explored.click()
  const read = messages.locator('[data-slot="context-tool-group-item"]', { hasText: app.data.path })
  await expect(read).toHaveCount(1)
  await expect(read.getByLabel("Read", { exact: true })).toBeVisible()
  await expect(read.locator('[data-component="tool-trigger"]')).toHaveAttribute("data-status", "succeeded")

  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  const files = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  await expect(files.getByRole("button", { name: "Hide file tree", exact: true })).toBeVisible()
  await files.getByRole("treeitem", { name: app.data.path, exact: true }).click()
  await expect(files.getByRole("region", { name: "File preview", exact: true })).toContainText(app.data.content)
  await expect
    .poll(async () => {
      const content = await messages.locator('[data-slot="session-turn-message-content"]').boundingBox()
      const composer = await page.locator('[data-slot="session-workspace-composer"] form').boundingBox()
      if (!content || !composer) return undefined
      return { left: content.x - composer.x, width: content.width - composer.width }
    })
    .toEqual({ left: 0, width: 0 })
  await files.getByRole("button", { name: "Close right sidebar", exact: true }).click()

  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await expect(messages.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(messages.getByRole("button", { name: "Explored Collapsed", exact: true })).toBeVisible()
  await Effect.runPromise(app.llm.verify())
})

test("keeps a completed assistant response before a follow-up queued during that response", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  const followUp = "Follow up after the current response"
  const followUpAnswer = "Follow-up complete."
  const followUpGate = `${app.data.session.id}:follow-up`
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "assistant", [
      {
        expect: (request) => {
          assert.ok(
            request.messages.some(
              (message) => message.role === "user" && JSON.stringify(message.content).includes(followUp),
            ),
          )
        },
        response: { type: "success", events: [{ gate: followUpGate }, { text: followUpAnswer }] },
      },
    ]),
  )
  const timeline = page.locator('[data-component="message-timeline"]')
  const editor = page.getByRole("combobox", { name: "Message", exact: true })
  const send = page.getByRole("button", { name: "Send", exact: true })

  await editor.fill(script.prompt)
  await Promise.all([Effect.runPromise(app.llm.waitGate(script.gate)), send.click()])
  await editor.fill(followUp)
  await send.click()
  await expect(timeline.getByText(followUp, { exact: true })).toBeVisible()

  await Promise.all([Effect.runPromise(app.llm.waitGate(followUpGate)), Effect.runPromise(app.llm.release(script.gate))])
  try {
    const response = timeline.getByText(script.answer, { exact: true })
    const pending = timeline.getByText(followUp, { exact: true })
    await expect(response).toBeVisible()
    await expect(pending).toBeVisible()
    await expect
      .poll(async () => {
        const responseBox = await response.boundingBox()
        const pendingBox = await pending.boundingBox()
        return responseBox !== null && pendingBox !== null && responseBox.y + responseBox.height <= pendingBox.y
      })
      .toBe(true)
  } finally {
    await Effect.runPromise(app.llm.release(followUpGate))
    await Effect.runPromise(app.llm.settled(app.data.session.id, "assistant", 2))
  }

  await expect(timeline.getByText(followUpAnswer, { exact: true })).toBeVisible()
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.verify())
})

test("shows a real missing-file Tool error and preserves its recovery answer", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "missing"))
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])

  const failure = messages.getByRole("button", { name: "Read missing.txt Failed Collapsed", exact: true })
  await expect(failure).toBeEnabled()
  await failure.click()
  await expect(messages.getByText("Project File not found: missing.txt", { exact: true })).toBeVisible()
  await expect(messages.getByRole("button", { name: /Explored/ })).toHaveCount(0)
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(failure).toBeEnabled()
  await failure.click()
  await expect(messages.getByText("Project File not found: missing.txt", { exact: true })).toBeVisible()
  await Effect.runPromise(app.llm.verify())
})

test("cancels a gated model stream and keeps the committed partial conversation", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "cancel"))
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  await Promise.all([
    Effect.runPromise(app.llm.settled(app.data.session.id, "assistant")),
    page.getByRole("button", { name: "Stop", exact: true }).click(),
  ])
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await expect(messages.getByText("Interrupted", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await expect(messages.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(messages.getByText("Interrupted", { exact: true })).toBeVisible()
  await Effect.runPromise(app.llm.verify())
})

test("shows a provider authentication error and retains its classification after reload", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "provider"))
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.wait(app.data.session.id, "assistant")),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await Effect.runPromise(app.llm.settled(app.data.session.id, "assistant"))
  await expect.poll(() => app.client.session.active()).toEqual({})
  const persisted = await app.client.message.list({ sessionID: app.data.session.id })
  expect(persisted.data).toContainEqual(
    expect.objectContaining({
      type: "assistant",
      error: expect.objectContaining({ _tag: "SessionError.ProviderError", category: "auth", status: 401 }),
    }),
  )
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await expect(messages.getByRole("alert")).toHaveCount(1)
  await expect(messages.getByRole("alert")).toContainText("authentication failed (401)")
  await expect(messages.getByRole("alert")).toContainText(script.answer)
  await expect(messages.getByRole("button", { name: "Choose a different model", exact: true })).toBeVisible()
  await messages.getByRole("button", { name: "Choose a different model", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Search models", exact: true })).toBeVisible()
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})

test("renders assistant single newlines as line breaks and labels and copies a code block", async ({
  page,
  app,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const code = "const answer = 42"
  const turn = {
    prompt: "Show me the answer",
    answer: ["First line", "Second line", "Third line", "", "```typescript", code, "```"].join("\n"),
    title: "Answer formatting",
  }
  await Effect.runPromise(Chat.reply(app, app.data.session.id, turn))
  const timeline = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(turn.prompt)
  await page.getByRole("button", { name: "Send", exact: true }).click()

  const lines = timeline.locator("p", { hasText: "First line" })
  await expect(lines.locator("br")).toHaveCount(2)
  await expect.poll(() => lines.innerText()).toBe("First line\nSecond line\nThird line")

  const block = timeline.locator('[data-component="markdown-code"]')
  await expect(block).toHaveAttribute("data-language", "typescript")
  await expect
    .poll(() =>
      page.evaluate(
        `getComputedStyle(document.querySelector('[data-component="markdown-code"]'), "::before").content`,
      ),
    )
    .toBe('"typescript"')
  await expect(block.locator("pre")).toContainText(code)
  const copy = block.getByRole("button", { name: "Copy code", exact: true })
  await copy.click()
  await expect(block.getByRole("button", { name: "Code copied", exact: true })).toHaveText("Copied")
  expect(await page.evaluate("navigator.clipboard.readText()")).toBe(code)

  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
