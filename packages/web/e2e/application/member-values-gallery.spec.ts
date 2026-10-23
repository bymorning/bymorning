import { Auth } from "@bymorning/schema/auth"
import { Chat } from "@bymorning/testing/scenario/chat"
import { TestUpstream } from "@bymorning/testing/upstream"
import { Effect, Exit, Scope } from "effect"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { expect, makeTest } from "../fixtures/app.js"

/**
 * Page-by-page review gallery for Member Values. Not a regression test: it drives the
 * real application through every screen of the feature as an administrator and as a
 * non-admin member, and writes numbered screenshots for human review.
 *
 *   MEMBER_VALUES_GALLERY=/tmp/gallery bun run test:application -- --timeout=900000 e2e/application/member-values-gallery.spec.ts
 */
const root = process.env.MEMBER_VALUES_GALLERY
const test = makeTest(Chat.make).extend<{ upstream: Effect.Success<ReturnType<typeof TestUpstream.make>> }>({
  upstream: async ({}, use) => {
    const scope = Effect.runSync(Scope.make())
    try {
      await use(await Effect.runPromise(TestUpstream.make().pipe(Scope.provide(scope))))
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  },
})

test.skip(root === undefined, "Set MEMBER_VALUES_GALLERY to a directory to capture the gallery")
test.setTimeout(900_000)

const HEADERS = [
  "Authorization: Bearer ${JIRA_TOKEN}",
  "X-Confluence-Token: ${CONFLUENCE_TOKEN}",
  "X-User-Email: ${member.email}",
  "X-Team: platform",
].join("\n")

test("Member Values screenshot gallery", async ({ app, browser, upstream }) => {
  const directory = root!
  await rm(directory, { recursive: true, force: true })
  for (const group of ["light", "dark", "mobile"]) await mkdir(join(directory, group), { recursive: true })
  const workspace = app.data.owner.properties.workspaceID
  const errors: string[] = []

  const context = async (scheme: "light" | "dark", viewport = { width: 1440, height: 900 }) => {
    const created = await browser.newContext({
      baseURL: app.web.href,
      colorScheme: scheme,
      reducedMotion: "reduce",
      viewport,
    })
    await created.addInitScript((value) => {
      localStorage.setItem("bymorning-color-scheme", value)
      localStorage.setItem("bymorning-theme-id", "ink")
    }, scheme)
    return created
  }
  const capture = async (page: Page, group: string, name: string) => {
    await page.evaluate("document.fonts.ready")
    await page.screenshot({ path: join(directory, group, `${name}.png`), animations: "disabled", caret: "hide" })
  }
  const open = async (context: Awaited<ReturnType<typeof browser.newContext>>) => {
    const page = await context.newPage()
    // Actions have no default timeout here; a stall must fail instead of waiting for the test to end.
    page.setDefaultTimeout(30_000)
    page.on("pageerror", (error) => errors.push(error.message))
    return page
  }

  /** Open the command palette's Connect integration picker, as any member can. */
  const connectIntegration = async (target: Page) => {
    // Shortcuts only work once the application shell has mounted.
    await expect(target.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
    await target.keyboard.press("Control+k")
    const palette = target.getByRole("dialog", { name: "Commands", exact: true })
    await palette.getByRole("combobox", { name: "Search commands", exact: true }).fill("connect")
    await palette.getByRole("option", { name: /Connect integration/ }).click()
    await expect(target.getByText("river MCP", { exact: true })).toBeVisible()
  }

  // ── Administrator ────────────────────────────────────────────────────────────────
  const admin = await context("light")
  const page = await open(admin)
  await page.goto("/login")
  await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await page.goto(`/w/${workspace}/mcp`)
  const integrations = page.getByRole("region", { name: "Connected", exact: true })
  await expect(integrations.getByRole("button", { name: "Add integration", exact: true })).toBeVisible()
  await capture(page, "light", "01-admin-integrations-empty")

  await integrations.getByRole("button", { name: "Add integration", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Add integration", exact: true })
  await expect(picker.getByRole("option", { name: /MCP server/ })).toBeVisible()
  await capture(page, "light", "02-admin-add-integration-picker")
  await picker.getByRole("option", { name: /MCP server/ }).click()

  const add = page.getByRole("dialog", { name: "Add MCP server", exact: true })
  await expect(add.getByRole("textbox", { name: "Name", exact: true })).toBeEditable()
  await capture(page, "light", "03-admin-add-dialog-empty")

  await add.getByRole("textbox", { name: "Name", exact: true }).fill("river")
  await add.getByRole("textbox", { name: "URL", exact: true }).fill(upstream.url.href)
  await capture(page, "light", "04-admin-add-dialog-oauth-default")

  const headers = add.getByRole("textbox", { name: "Headers (optional)", exact: true })
  await headers.fill(HEADERS)
  await expect(add.getByRole("status")).toContainText("JIRA_TOKEN, CONFLUENCE_TOKEN")
  await capture(page, "light", "05-admin-add-dialog-member-values")

  await headers.fill("not a header line")
  await add.getByRole("button", { name: "Add MCP server", exact: true }).click()
  await expect(add.getByRole("alert")).toBeVisible()
  await capture(page, "light", "06-admin-add-dialog-invalid-header")

  await headers.fill(HEADERS)
  await add.getByRole("button", { name: "Add MCP server", exact: true }).click()
  await expect(add).toHaveCount(0)

  const row = integrations.getByRole("button", { name: "View tools for river", exact: true })
  await expect(row.getByText("Authentication required", { exact: true })).toBeVisible()
  await capture(page, "light", "07-admin-row-authentication-required")

  await integrations.getByRole("button", { name: "Actions for river", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Authenticate", exact: true })).toBeVisible()
  await capture(page, "light", "08-admin-row-menu-authenticate")
  await page.getByRole("menuitem", { name: "Authenticate", exact: true }).click()

  const connect = page.getByRole("dialog", { name: "Connect river", exact: true })
  await expect(connect.getByLabel(/^JIRA_TOKEN/)).toBeVisible()
  await capture(page, "light", "09-admin-values-form-empty")

  await connect.getByLabel(/^JIRA_TOKEN/).fill("access-2")
  await connect.getByRole("button", { name: "Save values", exact: true }).click()
  await expect(connect.getByRole("alert")).toContainText("Enter CONFLUENCE_TOKEN")
  await capture(page, "light", "10-admin-values-form-missing-value")

  await connect.getByLabel(/^JIRA_TOKEN/).fill("wrong-token")
  await connect.getByLabel(/^CONFLUENCE_TOKEN/).fill("confluence-secret")
  await capture(page, "light", "11-admin-values-form-filled-masked")
  await connect.getByRole("button", { name: "Save values", exact: true }).click()
  await expect(connect.getByText("Server rejected your values", { exact: true })).toBeVisible()
  await capture(page, "light", "12-admin-values-form-rejected")

  await connect.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(connect).toHaveCount(0)
  await expect(row.getByText("Server rejected your values", { exact: true })).toBeVisible()
  await capture(page, "light", "13-admin-row-failed-rejected")

  await integrations.getByRole("button", { name: "Actions for river", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Update values", exact: true })).toBeVisible()
  await capture(page, "light", "14-admin-row-menu-update-values")
  await page.getByRole("menuitem", { name: "Update values", exact: true }).click()

  const replace = page.getByRole("dialog", { name: "Connect river", exact: true })
  await expect(replace.getByLabel(/^JIRA_TOKEN/)).toHaveAttribute("placeholder", /Leave blank to keep/)
  await capture(page, "light", "15-admin-values-form-replace-saved")
  await replace.getByLabel(/^JIRA_TOKEN/).fill("access-2")
  await replace.getByRole("button", { name: "Replace values", exact: true }).click()
  await expect(replace).toHaveCount(0)
  await expect(page.getByText("Connected river", { exact: true })).toBeVisible()
  await capture(page, "light", "16-admin-toast-connected")
  await expect(row.getByText("Connected", { exact: true })).toBeVisible()
  await capture(page, "light", "17-admin-row-connected")

  await row.click()
  await expect(page.getByRole("region", { name: "river page", exact: true })).toBeVisible()
  await expect(page.getByRole("list", { name: "river tools" })).toBeVisible()
  await capture(page, "light", "18-admin-server-detail-tools")

  // ── Member (not an administrator) ────────────────────────────────────────────────
  await app.client.user.invite({ email: Auth.Email.make("member@bymorning.ai"), role: "member" })
  await Effect.runPromise(app.login(app.clientFor(), { subject: Auth.Sub.make("test-member"), email: Auth.Email.make("member@bymorning.ai") }))
  const memberContext = await context("light")
  const member = await open(memberContext)
  await member.goto("/login")
  await expect(member).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await capture(member, "light", "19-member-overview")

  await member.goto(`/w/${workspace}/mcp`)
  // The Console is administrator-only: a member lands on the overview instead.
  await expect(member).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await capture(member, "light", "20-member-console-redirects-to-overview")

  await expect(member.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
  await member.keyboard.press("Control+k")
  const palette = member.getByRole("dialog", { name: "Commands", exact: true })
  await palette.getByRole("combobox", { name: "Search commands", exact: true }).fill("connect")
  await expect(palette.getByRole("option", { name: /Connect integration/ })).toBeVisible()
  await capture(member, "light", "21-member-command-palette")
  await palette.getByRole("option", { name: /Connect integration/ }).click()
  await expect(member.getByText("river MCP", { exact: true })).toBeVisible()
  await capture(member, "light", "22-member-connect-integration-picker")
  await member.getByText("river MCP", { exact: true }).click()

  const own = member.getByRole("dialog", { name: "Connect river", exact: true })
  await expect(own.getByLabel(/^JIRA_TOKEN/)).toBeVisible()
  await capture(member, "light", "23-member-values-form-empty")
  await own.getByLabel(/^JIRA_TOKEN/).fill("access-2")
  await own.getByLabel(/^CONFLUENCE_TOKEN/).fill("member-confluence")
  await own.getByRole("button", { name: "Save values", exact: true }).click()
  await expect(own).toHaveCount(0)
  await expect(member.getByText("Connected river", { exact: true })).toBeVisible()
  await capture(member, "light", "24-member-toast-connected")

  // The member's connection is independent of the administrator's, and can be replaced later.
  await connectIntegration(member)
  await member.getByText("river MCP", { exact: true }).click()
  const manage = member.getByRole("dialog", { name: "Connect river", exact: true })
  await expect(manage.getByLabel(/^JIRA_TOKEN/)).toHaveAttribute("placeholder", /Leave blank to keep/)
  await capture(member, "light", "25-member-values-form-replace-saved")
  await manage.getByRole("button", { name: "Cancel", exact: true }).click()

  // The administrator sees who has connected, never their values.
  await page.goto(`/w/${workspace}/mcp/river`)
  const members = page.getByRole("region", { name: "Members", exact: true })
  await expect(members.getByText("2 of 2 members have saved their own values.")).toBeVisible()
  await expect(members.getByText("member@bymorning.ai")).toBeVisible()
  await capture(page, "light", "26-admin-detail-members-connected")

  // ── Dark: administrator, then member ─────────────────────────────────────────────
  await Effect.runPromise(app.login(app.clientFor()))
  const darkAdmin = await open(await context("dark"))
  await darkAdmin.goto("/login")
  await expect(darkAdmin).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await darkAdmin.goto(`/w/${workspace}/mcp`)
  const darkIntegrations = darkAdmin.getByRole("region", { name: "Connected", exact: true })
  await expect(darkIntegrations.getByText("Connected", { exact: true }).first()).toBeVisible()
  await capture(darkAdmin, "dark", "01-admin-integrations-connected")
  await darkIntegrations.getByRole("button", { name: "Add integration", exact: true }).click()
  await darkAdmin.getByRole("option", { name: /MCP server/ }).click()
  const darkAdd = darkAdmin.getByRole("dialog", { name: "Add MCP server", exact: true })
  await darkAdd.getByRole("textbox", { name: "Name", exact: true }).fill("crm")
  await darkAdd.getByRole("textbox", { name: "URL", exact: true }).fill("https://crm.example/mcp")
  await darkAdd.getByRole("textbox", { name: "Headers (optional)", exact: true }).fill(HEADERS)
  await capture(darkAdmin, "dark", "02-admin-add-dialog-member-values")
  await darkAdd.getByRole("button", { name: "Cancel", exact: true }).click()
  await darkIntegrations.getByRole("button", { name: "Actions for river", exact: true }).click()
  await darkAdmin.getByRole("menuitem", { name: "Update values", exact: true }).click()
  const darkValues = darkAdmin.getByRole("dialog", { name: "Connect river", exact: true })
  await darkValues.getByLabel(/^JIRA_TOKEN/).fill("wrong-token")
  await darkValues.getByRole("button", { name: "Replace values", exact: true }).click()
  await expect(darkAdmin.getByText("Server rejected your values", { exact: true }).first()).toBeVisible()
  await capture(darkAdmin, "dark", "03-admin-values-form-rejected")

  await Effect.runPromise(app.login(app.clientFor(), { subject: Auth.Sub.make("test-member"), email: Auth.Email.make("member@bymorning.ai") }))
  const darkMember = await open(await context("dark"))
  await darkMember.goto("/login")
  await expect(darkMember).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await connectIntegration(darkMember)
  await capture(darkMember, "dark", "04-member-connect-integration-picker")
  await darkMember.getByText("river MCP", { exact: true }).click()
  await expect(darkMember.getByRole("dialog", { name: "Connect river", exact: true })).toBeVisible()
  await capture(darkMember, "dark", "05-member-values-form")

  // ── Mobile: administrator, then member ───────────────────────────────────────────
  await Effect.runPromise(app.login(app.clientFor()))
  const phoneAdmin = await open(await context("light", { width: 390, height: 844 }))
  await phoneAdmin.goto("/login")
  await expect(phoneAdmin).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await phoneAdmin.goto(`/w/${workspace}/mcp`)
  await expect(phoneAdmin.getByRole("button", { name: "Add integration", exact: true })).toBeVisible()
  await capture(phoneAdmin, "mobile", "01-admin-integrations")
  await phoneAdmin.goto(`/w/${workspace}/mcp/river`)
  await expect(phoneAdmin.getByRole("region", { name: "Members", exact: true })).toBeVisible()
  await capture(phoneAdmin, "mobile", "05-admin-detail-members")
  await phoneAdmin.goto(`/w/${workspace}/mcp`)
  await phoneAdmin.getByRole("button", { name: "Add integration", exact: true }).click()
  await phoneAdmin.getByRole("option", { name: /MCP server/ }).click()
  const phoneAdd = phoneAdmin.getByRole("dialog", { name: "Add MCP server", exact: true })
  await phoneAdd.getByRole("textbox", { name: "Name", exact: true }).fill("crm")
  await phoneAdd.getByRole("textbox", { name: "URL", exact: true }).fill("https://crm.example/mcp")
  await phoneAdd.getByRole("textbox", { name: "Headers (optional)", exact: true }).fill(HEADERS)
  await capture(phoneAdmin, "mobile", "02-admin-add-dialog-member-values")

  await Effect.runPromise(app.login(app.clientFor(), { subject: Auth.Sub.make("test-member"), email: Auth.Email.make("member@bymorning.ai") }))
  const phoneMember = await open(await context("light", { width: 390, height: 844 }))
  await phoneMember.goto("/login")
  await expect(phoneMember).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await capture(phoneMember, "mobile", "03-member-overview")
  await connectIntegration(phoneMember)
  await phoneMember.getByText("river MCP", { exact: true }).click()
  await expect(phoneMember.getByRole("dialog", { name: "Connect river", exact: true })).toBeVisible()
  await capture(phoneMember, "mobile", "04-member-values-form")

  expect(errors).toEqual([])
})
