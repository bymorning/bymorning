import { TestHTTP } from "@bymorning/testing/http"
import { ToolScenario } from "@bymorning/testing/scenario/tool"
import { Effect, Exit, Scope } from "effect"
import { expect, test as base } from "../fixtures/app.js"

const content = "browser-scoped HTTP Tool value"
const test = base.extend<{ http: Effect.Success<ReturnType<typeof TestHTTP.make>> }>({
  http: async ({}, use) => {
    const scope = Effect.runSync(Scope.make())
    try {
      const http = await Effect.runPromise(
        TestHTTP.make((request, response) => {
          response.writeHead(request.url === "/value" ? 200 : 404, { "content-type": "text/plain" })
          response.end(content)
        }).pipe(Scope.provide(scope)),
      )
      await use(http)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  },
  appOptions: async ({ http }, use) => use({ plugins: [ToolScenario.plugin(http.origin)] }),
  scenario: async ({}, use) => use(ToolScenario.make),
})

test("approves a registered HTTP Tool in the browser and preserves its real result", async ({ page, app, http }) => {
  const config = await app.client["api.config"].get()
  expect(config.plugins).toContainEqual(ToolScenario.plugin(http.origin))
  expect(config.plugins).toContainEqual(expect.objectContaining({ package: expect.stringContaining("model-plugin.ts") }))
  await app.client["api.config"].update({
    ...config,
    permissions: [
      { action: "execute", resource: "*", effect: "allow" },
      { action: "fixture.http", resource: "*", effect: "ask" },
    ],
  })
  const script = await Effect.runPromise(ToolScenario.script(app, app.data, content))
  const messages = page.locator('[data-component="message-timeline"]')
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await page.getByRole("button", { name: "Send", exact: true }).click()

  const permission = page.getByRole("region", { name: "Permission required", exact: true })
  await expect(permission.getByText("fixture.http", { exact: true })).toBeVisible()
  await expect(permission.getByText(http.origin.origin, { exact: true })).toBeVisible()
  await expect(permission.getByRole("button", { name: "Once", exact: true })).toBeEnabled()
  expect(http.requests()).toEqual([])
  await page.screenshot({ path: test.info().outputPath("tool-approval.png") })
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    permission.getByRole("button", { name: "Once", exact: true }).click(),
  ])
  await expect(permission).toHaveCount(0)
  expect(http.requests()).toEqual([{ method: "GET", url: "/value", authorization: undefined }])

  const activity = messages.getByRole("button", { name: "Called fixture_http Collapsed", exact: true })
  await expect(activity).toBeEnabled()
  await expect(activity.locator('[data-component="tool-trigger"]')).toHaveAttribute("data-status", "succeeded")
  await activity.click()
  await expect(messages.getByRole("region", { name: "Tool output", exact: true })).toHaveText(content)
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await expect(messages.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await activity.click()
  await expect(messages.getByRole("region", { name: "Tool output", exact: true })).toHaveText(content)
  expect(http.requests()).toHaveLength(1)
  await page.screenshot({ path: test.info().outputPath("tool-result.png") })
  await Effect.runPromise(app.llm.verify())
})

test("retains MCP connection controls without default Context7 or stale catalog navigation", async ({ page, app }) => {
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/mcp`)
  await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy endpoint", exact: true })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Package plugins", exact: true })).toHaveCount(0)
  const integrations = page.getByRole("region", { name: "Connected", exact: true })
  await expect(integrations.getByRole("button", { name: "Actions for context7", exact: true })).toHaveCount(0)
  await expect(integrations.getByRole("link", { name: /context7/ })).toHaveCount(0)
  await expect(page.getByRole("link", { name: /catalog/i })).toHaveCount(0)
  await expect(page.locator('a[href*="/mcp/catalog"]')).toHaveCount(0)
  await expect(page.getByRole("link", { name: "test.tool", exact: true })).toHaveCount(0)
  await integrations.getByRole("button", { name: "Add integration", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Add integration", exact: true })
  await picker.getByRole("option", { name: /MCP server/ }).click()
  const dialog = page.getByRole("dialog", { name: "Add MCP server", exact: true })
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeEditable()
  await expect(dialog.getByRole("textbox", { name: "URL", exact: true })).toBeEditable()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("mcp-controls.png") })
})
