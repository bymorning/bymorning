import { docsFixture, expect, test } from "./fixtures"

const root = `/w/${docsFixture.workspace.id}`

test("sign in", async ({ page, capture }) => {
  await page.goto("/login")
  await expect(page.getByRole("link", { name: "Continue", exact: true })).toBeVisible()
  await capture("sign-in.png", page.locator('[data-slot="card-page-card"]'))
})

test("account menu", async ({ page, capture }) => {
  await page.goto(root)
  await page.getByRole("button", { name: "Open account menu" }).click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem", { name: /Theme/ })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "Log Out" })).toBeVisible()
  await capture("account-menu.png", page.locator(".account-menu-popover"))
})

test("project files", async ({ page, capture }) => {
  await page.goto(`${root}/prj/${docsFixture.project.id}`)
  await expect(page.getByRole("heading", { level: 2, name: "Files" })).toBeVisible()
  await expect(page.getByRole("button", { name: "src/app.tsx", exact: true })).toBeVisible()
  await capture("project-files.png", page.locator('[data-slot="workspace-page-content"]'))
})

test("session composer", async ({ page, capture }) => {
  await page.goto(`${root}/session/${docsFixture.session.id}`)
  await expect(page.getByRole("heading", { name: docsFixture.session.title })).toBeVisible()
  await expect(page.locator('[data-component="session-composer"]')).toBeVisible()
  await capture("session-composer.png", page.locator('[data-slot="session-workspace-page"]'))
})

test("session permission", async ({ page, gateway, capture }) => {
  await page.goto(`${root}/session/${docsFixture.session.id}`)
  await expect(page.locator('[data-component="session-composer"]')).toBeVisible()
  await gateway.emit({
    id: "8446f76c-3709-43e9-9727-1456999dfdda",
    type: "permission.v2.asked",
    created: 1_756_132_800_000,
    data: {
      id: "per_publish_release",
      sessionID: docsFixture.session.id,
      action: "filesystem.write",
      resources: ["src/pages/onboarding.tsx", "src/styles/onboarding.css"],
      save: ["src/pages/onboarding.tsx"],
      metadata: {},
    },
  })
  await expect(page.getByRole("region", { name: "Permission required" })).toBeVisible()
  await capture("session-permission.png", page.locator('[data-slot="session-workspace-page"]'))
})

test("session tools", async ({ page, gateway, capture }) => {
  gateway.setMessages(docsFixture.timelineMessages)
  await page.goto(`${root}/session/${docsFixture.session.id}`)
  await expect(page).toHaveURL(`${root}/session/${docsFixture.session.id}`)
  await expect(page.getByText("Inspect and update the onboarding flow.")).toBeVisible()
  await expect(page.getByRole("button", { name: "deploy preview environment" })).toBeVisible()
  await capture("session-tools.png", page.locator('[data-slot="session-workspace-page"]'))
})

test("session subagent", async ({ page, gateway, capture }) => {
  gateway.setMessages(docsFixture.subagentMessages)
  await page.goto(`${root}/session/${docsFixture.session.id}`)
  await expect(page).toHaveURL(`${root}/session/${docsFixture.session.id}`)
  await expect(page.getByText("Delegate the independent accessibility checks.")).toBeVisible()
  await expect(page.getByText("Audit keyboard flow", { exact: true })).toBeVisible()
  await capture("session-subagent.png", page.locator('[data-slot="session-workspace-page"]'))
})

test("skills", async ({ page, capture }) => {
  await page.goto(`${root}/skills`)
  await expect(page.getByRole("button", { name: "Open Accessibility review details" })).toBeVisible()
  await capture("skills.png", page.locator('[data-slot="workspace-page-content"]'))
})

test("members", async ({ page, capture }) => {
  await page.goto(`${root}/members`)
  await expect(page.getByRole("table", { name: "Workspace members" })).toBeVisible()
  await capture("members.png", page.locator('[data-slot="workspace-page-content"]'))
})

test("gateway usage", async ({ page, capture }) => {
  await page.goto(`${root}/gateway`)
  await expect(page.getByRole("heading", { name: "Daily total cost" })).toBeVisible()
  await expect(page.getByRole("img", { name: /Daily total cost/ })).toBeVisible()
  await capture("gateway-usage.png")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390)
  await expect(page.getByRole("table", { name: "Model usage" })).toContainText("vertex/aurora-3-2")
})

test("gateway models", async ({ page, capture }) => {
  await page.goto(`${root}/gateway/models`)
  await expect(page.getByRole("list", { name: "Workspace models" })).toContainText("Aurora 3.2")
  await capture("gateway-models.png", page.locator('[data-slot="gateway-content"]'))
})

test("gateway providers", async ({ page, capture }) => {
  await page.goto(`${root}/gateway/models?tab=providers`)
  await expect(page.getByRole("list", { name: "Connected providers" })).toContainText("Vertex AI")
  await capture("gateway-providers.png", page.locator('[data-slot="gateway-content"]'))
})

test("MCP integrations", async ({ page, capture }) => {
  await page.goto(`${root}/mcp`)
  const integrations = page.getByRole("region", { name: "Connected" })
  await expect(integrations.getByRole("heading", { name: "Connected" })).toBeVisible()
  await expect(integrations.getByRole("button", { name: "Add integration" })).toBeVisible()
  const integration = integrations.getByRole("listitem").filter({ hasText: "linear" })
  await expect(integration).toContainText("https://mcp.linear.app/mcp")
  const detail = integration.getByRole("button", { name: "View tools for linear" })
  await expect(detail).toBeVisible()
  await capture("outbound-mcp.png", integration)

  await detail.click()
  await expect(page).toHaveURL(`${root}/mcp/linear`)
  await expect(page.getByRole("heading", { level: 1, name: "MCP linear" })).toBeVisible()
  await expect(page.getByText("linear_search_issues", { exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Permission for search_issues" })).toHaveValue("ask")
})
