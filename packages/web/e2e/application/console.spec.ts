import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"

const ownerEmail = "owner@bymorning.ai"

test.describe("Members", () => {
  test("inviting your own email as Member explains the refusal and keeps you admin", async ({ page, app }) => {
    const workspace = app.data.owner.properties.workspaceID
    await page.goto(`/w/${workspace}/members`)
    const table = page.getByRole("table", { name: "Workspace members", exact: true })
    const own = table.getByRole("row").filter({ hasText: ownerEmail })
    await expect(own).toBeVisible()

    await page.getByRole("button", { name: "Invite member", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Invite member", exact: true })
    await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(ownerEmail)
    await expect(dialog.getByText("Member", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Invite member", exact: true }).click()
    await expect(dialog.getByRole("alert")).toHaveText(
      `${ownerEmail} is already the Workspace's only admin; an invitation cannot change their role.`,
    )
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(dialog).toBeHidden()

    // The refused invitation changed nothing: the Console is still reachable after a reload.
    await page.reload()
    await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible()
    await expect(own).toBeVisible()
    await expect(own.getByText("Admin", { exact: true })).toBeVisible()
    const members = await app.client.user.list({ workspace })
    expect(members.members.find((member) => member.email === ownerEmail)).toMatchObject({ role: "admin" })
  })

  test("your own row is marked You and offers no Remove or Suspend", async ({ page, app }) => {
    await page.goto(`/w/${app.data.owner.properties.workspaceID}/members`)
    const own = page
      .getByRole("table", { name: "Workspace members", exact: true })
      .getByRole("row")
      .filter({ hasText: ownerEmail })
    await expect(own.getByText("You", { exact: true })).toBeVisible()
    await expect(own.getByText("You are the only admin", { exact: true })).toBeVisible()
    await expect(own.getByRole("button", { name: /^Remove / })).toHaveCount(0)
    await expect(own.getByRole("button", { name: /^Suspend / })).toHaveCount(0)
  })
})

test("Installation surfaces the server's reason when granting admin to an unknown Account", async ({ page, app }) => {
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/installation`)
  await page.getByRole("textbox", { name: "Account ID", exact: true }).fill("acc_doesnotexist")
  await page.getByRole("button", { name: "Grant admin", exact: true }).click()
  await expect(page.getByText("Account was not found")).toBeVisible()
})

test.describe("Agents", () => {
  test("a created subagent appears in the list at once and a rename updates its row", async ({ page, app }) => {
    await page.goto(`/w/${app.data.owner.properties.workspaceID}/agents`)
    await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible()
    const subagents = page.getByRole("list", { name: "Subagents", exact: true })
    await expect(page.getByRole("button", { name: "Open Reviewer details", exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: "Add subagent", exact: true }).click()
    const create = page.getByRole("dialog", { name: "Create subagent", exact: true })
    await create.getByRole("textbox", { name: "Name", exact: true }).fill("Reviewer")
    await create.getByRole("button", { name: "Create subagent", exact: true }).click()
    await expect(create).toBeHidden()
    // No reload: the catalog refresh after create must reach the rendered list.
    await expect(subagents.getByRole("button", { name: "Open Reviewer details", exact: true })).toBeVisible()

    await subagents.getByRole("button", { name: "Open Reviewer details", exact: true }).click()
    await page.getByRole("button", { name: "Edit subagent", exact: true }).click()
    const edit = page.getByRole("dialog", { name: "Edit subagent", exact: true })
    await edit.getByRole("textbox", { name: "Name", exact: true }).fill("Auditor")
    await edit.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Auditor", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(subagents.getByRole("button", { name: "Open Auditor details", exact: true })).toBeVisible()
    await expect(subagents.getByRole("button", { name: "Open Reviewer details", exact: true })).toHaveCount(0)
  })
})

test.describe("Installation Policy", () => {
  test("validates invitation domains and keeps Save disabled until something changes", async ({ page, app }) => {
    await page.goto(`/w/${app.data.owner.properties.workspaceID}/installation/policy`)
    const save = page.getByRole("button", { name: "Save policy", exact: true })
    const domains = page.getByRole("textbox", { name: "Invitation domains", exact: true })
    await expect(domains).toBeEditable()
    await expect(save).toBeDisabled()

    await domains.fill("not a domain")
    await expect(page.getByRole("alert").filter({ hasText: "is not a valid email domain" })).toBeVisible()
    await expect(save).toBeDisabled()

    await domains.fill("example.com")
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expect(save).toBeEnabled()
  })

  test("asks before discarding unsaved changes and Cancel keeps the edits", async ({ page, app }) => {
    const workspace = app.data.owner.properties.workspaceID
    const policy = new URL(`/w/${workspace}/installation/policy`, app.web).href
    await page.goto(policy)
    const domains = page.getByRole("textbox", { name: "Invitation domains", exact: true })
    await expect(domains).toBeEditable()
    await domains.fill("example.com")

    await page.getByRole("button", { name: "Members", exact: true }).click()
    const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(page).toHaveURL(policy)
    await expect(domains).toHaveValue("example.com")

    await page.getByRole("button", { name: "Members", exact: true }).click()
    await page
      .getByRole("dialog", { name: "Discard unsaved changes?", exact: true })
      .getByRole("button", { name: "Discard changes", exact: true })
      .click()
    await expect(page).toHaveURL(new URL(`/w/${workspace}/members`, app.web).href)
  })

  test("turning off web search hides Add web search on Overview until it is restored", async ({ page, app }) => {
    const workspace = app.data.owner.properties.workspaceID
    const checklist = page.getByRole("region", { name: "Getting started", exact: true })
    const addWebSearch = checklist.getByRole("button", { name: "Add web search", exact: true })

    await page.goto(`/w/${workspace}`)
    await expect(addWebSearch).toBeVisible()

    await page.goto(`/w/${workspace}/installation/policy`)
    const websearch = page.getByRole("switch", { name: "Allow web search", exact: true })
    await expect(websearch).toBeChecked()
    await page.getByText("Allow web search", { exact: true }).click()
    await page.getByRole("button", { name: "Save policy", exact: true }).click()
    await expect(page.getByText("Installation Policy updated", { exact: true })).toBeVisible()

    await page.goto(`/w/${workspace}`)
    await expect(checklist).toBeVisible()
    await expect(
      checklist.getByText("Web search is disabled by the Installation Policy.", { exact: true }),
    ).toBeVisible()
    await expect(addWebSearch).toHaveCount(0)

    // Restore, so the Installation Policy is left as it was found.
    await page.goto(`/w/${workspace}/installation/policy`)
    await expect(websearch).not.toBeChecked()
    await page.getByText("Allow web search", { exact: true }).click()
    await page.getByRole("button", { name: "Save policy", exact: true }).click()
    await expect(page.getByText("Installation Policy updated", { exact: true }).last()).toBeVisible()
    await page.goto(`/w/${workspace}`)
    await expect(addWebSearch).toBeVisible()
    await expect(checklist.getByText("Web search is disabled by the Installation Policy.")).toHaveCount(0)
  })
})

test.describe("Projects", () => {
  test("the Create project button appears when the Projects heading is hovered", async ({ page, app }) => {
    await page.goto(`/w/${app.data.owner.properties.workspaceID}`)
    const create = page.getByRole("button", { name: "Create project", exact: true })
    await expect(create).toBeEnabled()
    await expect(create).toHaveCSS("opacity", "0")
    await page.getByRole("button", { name: "Projects", exact: true }).hover()
    await expect(create).toHaveCSS("opacity", "1")
  })

  test("Create project stays disabled for an empty or whitespace name", async ({ page, app }) => {
    await page.goto(`/w/${app.data.owner.properties.workspaceID}`)
    await page.getByRole("button", { name: "Create project", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Create project", exact: true })
    const submit = dialog.getByRole("button", { name: "Create project", exact: true })
    const name = dialog.getByRole("textbox", { name: "Name", exact: true })
    await expect(name).toBeFocused()
    await expect(submit).toBeDisabled()
    await name.fill("   ")
    await expect(submit).toBeDisabled()
    await name.fill("Roadmap")
    await expect(submit).toBeEnabled()
  })

  test("Edit project stays disabled once the name is cleared or whitespace", async ({ page, app }) => {
    await page.goto(`/w/${app.data.owner.properties.workspaceID}/prj/${app.data.project.id}`)
    await page.getByRole("button", { name: "Edit project", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Edit project", exact: true })
    const submit = dialog.getByRole("button", { name: "Save changes", exact: true })
    const name = dialog.getByRole("textbox", { name: "Name", exact: true })
    await expect(name).toHaveValue("Conversation fixture")
    await expect(submit).toBeEnabled()
    await name.fill("")
    await expect(submit).toBeDisabled()
    await name.fill("   ")
    await expect(submit).toBeDisabled()
    await name.fill("Renamed")
    await expect(submit).toBeEnabled()
  })
})

test.describe("Gateway", () => {
  test("Budgets flags a Workspace that has spent past its limit", async ({ page, app }) => {
    const workspace = app.data.owner.properties.workspaceID
    // Real spend: one scripted turn through the model, then a limit below what it cost.
    const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
    await app.client.session.prompt({ sessionID: app.data.session.id, text: script.prompt })
    await Effect.runPromise(app.llm.waitGate(script.gate))
    await Effect.runPromise(app.llm.release(script.gate))
    await expect.poll(() => app.client.session.active()).toEqual({})
    await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
    await app.client.budget.limit({ workspace, target: { type: "workspace" }, amount: 0 })
    const status = await app.client.budget.status({ workspace })
    expect(status.standings.find(({ target }) => target.type === "workspace")?.spent).toBeGreaterThan(0)

    await page.goto(`/w/${workspace}/gateway/budgets`)
    await expect(page.getByRole("heading", { name: "Workspace monthly limit", exact: true })).toBeVisible()
    await expect(page.getByText("Over limit", { exact: true })).toBeVisible()
    await expect(page.getByRole("progressbar", { name: /Workspace limit used \(over limit\)$/ })).toBeVisible()
    await Effect.runPromise(app.llm.verify())
  })

  test("Models search with no match says so and Clear search resets it", async ({ page, app }) => {
    await page.goto(`/w/${app.data.owner.properties.workspaceID}/gateway/models`)
    const search = page.getByRole("searchbox", { name: "Search models", exact: true })
    await expect(search).toBeVisible()
    await search.fill("zzzz-no-such-model")
    await expect(page.getByText('No models match "zzzz-no-such-model".', { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Clear search", exact: true }).click()
    await expect(search).toHaveValue("")
    await expect(page.getByText("No models match", { exact: false })).toHaveCount(0)
  })
})
