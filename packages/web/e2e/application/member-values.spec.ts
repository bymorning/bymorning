import { TestUpstream } from "@bymorning/testing/upstream"
import { Effect, Exit, Scope } from "effect"
import { expect, test as base } from "../fixtures/app.js"

const test = base.extend<{ upstream: Effect.Success<ReturnType<typeof TestUpstream.make>> }>({
  upstream: async ({}, use) => {
    const scope = Effect.runSync(Scope.make())
    try {
      await use(await Effect.runPromise(TestUpstream.make().pipe(Scope.provide(scope))))
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  },
})

test("an administrator adds a header-authenticated MCP server and a member connects with their own value", async ({
  page,
  app,
  upstream,
}) => {
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/mcp`)
  const integrations = page.getByRole("region", { name: "Connected", exact: true })
  await integrations.getByRole("button", { name: "Add integration", exact: true }).click()
  await page.getByRole("dialog", { name: "Add integration", exact: true }).getByRole("option", { name: /MCP server/ }).click()

  const add = page.getByRole("dialog", { name: "Add MCP server", exact: true })
  await add.getByRole("textbox", { name: "Name", exact: true }).fill("river")
  await add.getByRole("textbox", { name: "URL", exact: true }).fill(upstream.url.href)
  // The upstream accepts only `Bearer access-2`, so only the member's own value can connect it.
  await add.getByRole("textbox", { name: "Headers (optional)", exact: true }).fill("authorization: Bearer ${TOKEN}")
  await expect(add.getByRole("status")).toHaveText("Each member will be asked for: TOKEN")
  await expect(add.getByRole("radio", { name: /OAuth/ })).toBeDisabled()
  await add.getByRole("button", { name: "Add MCP server", exact: true }).click()
  await expect(add).toHaveCount(0)

  const row = integrations.getByRole("button", { name: "View tools for river", exact: true })
  await expect(row.getByText("Authentication required", { exact: true })).toBeVisible()
  expect(upstream.initializations).toBe(0)

  // The row re-renders as the server's status settles, which closes a menu opened a moment too early. Open it,
  // and open it again only while it is not open (an idempotent check, so a slow runner cannot toggle it shut).
  const actions = integrations.getByRole("button", { name: "Actions for river", exact: true })
  const authenticate = page.getByRole("menuitem", { name: "Authenticate", exact: true })
  await expect(async () => {
    if ((await actions.getAttribute("aria-expanded")) !== "true") await actions.click()
    await expect(authenticate).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await authenticate.click()
  const connect = page.getByRole("dialog", { name: "Connect river", exact: true })
  const token = connect.getByLabel(/^TOKEN/)
  await expect(token).toHaveAttribute("type", "password")
  await token.fill("access-2")
  await page.screenshot({ path: test.info().outputPath("member-values.png") })
  await connect.getByRole("button", { name: "Save values", exact: true }).click()

  await expect(connect).toHaveCount(0)
  await expect(page.getByText("Connected river", { exact: true })).toBeVisible()
  await expect(row.getByText("Connected", { exact: true })).toBeVisible()
  expect(upstream.initializations).toBeGreaterThan(0)
  await expect(page.locator("body")).not.toContainText("access-2")
  await page.screenshot({ path: test.info().outputPath("member-values-connected.png") })
})
