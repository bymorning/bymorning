import type { Session } from "@bymorning/schema/session"
import { expect, test } from "../fixtures/app.js"
import { confirmArchive, expectSessionReady, seedSessions, sessionPath, sidebar, sidebarOrder } from "./sessions.js"

test("renames a Session and archives it out of Overview", async ({ page, app }) => {
  const header = page.locator('[data-component="session-header"]')
  await expect(header.getByRole("button", { name: "Rename session Untitled", exact: true })).toBeVisible()
  await header.getByRole("button", { name: "Rename session Untitled", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Session title", exact: true })
  await expect(editor).toBeFocused()
  await editor.fill("Planning notes")
  await editor.press("Enter")
  await expect(header.getByRole("heading", { name: "Rename session Planning notes", exact: true })).toBeVisible()

  await header.getByRole("button", { name: "Session actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Archive session", exact: true }).click()
  await confirmArchive(page)
  // Archiving leaves the Session: its screen would otherwise keep a live composer.
  await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  const sessions = page.getByRole("navigation", { name: "Sessions", exact: true })
  await expect(sessions.getByRole("link", { name: /Planning notes/ })).toHaveCount(0)

  await page.goto(`/w/${app.data.owner.properties.workspaceID}/session/${app.data.session.id}`)
  await expect(header.getByRole("heading", { name: "Rename session Planning notes", exact: true })).toBeVisible()
  // The header shows while the transcript loads and is rebuilt once it is ready; open its menu after that.
  await expectSessionReady(page)
  const notice = page.getByRole("status").filter({ hasText: "This session is archived." })
  await expect(notice).toBeVisible()
  await header.getByRole("button", { name: "Session actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Restore session", exact: true }).click()
  await expect(notice).toHaveCount(0)
  await header.getByRole("button", { name: "Session actions", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Archive session", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")

  await page
    .getByRole("navigation", { name: "Workspace navigation", exact: true })
    .getByRole("button", { name: "Overview", exact: true })
    .click()
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  await expect(sessions.getByRole("link", { name: /Planning notes/ })).toBeVisible()

  const listed = await app.client.session.list({
    workspace: app.data.owner.properties.workspaceID,
    archived: false,
    parentID: null,
  })
  expect(
    listed.data.some(
      (session: { readonly id: string; readonly title: string }) =>
        session.id === app.data.session.id && session.title === "Planning notes",
    ),
  ).toBe(true)
})

test("archiving the open Session confirms with Undo, which restores its sidebar position", async ({ page, app }) => {
  const [, bravo, charlie] = await seedSessions(app, ["Alpha budget", "Bravo roadmap", "Charlie hiring"])
  const header = page.locator('[data-component="session-header"]')
  const workspace = app.data.owner.properties.workspaceID
  await expect.poll(() => sidebarOrder(page)).toHaveLength(3)
  const before = await sidebarOrder(page)
  expect(before[0]).toBe(sessionPath(app, charlie!.id))

  await sidebar(page)
    .locator(`a[href="${sessionPath(app, bravo!.id)}"]`)
    .click()
  await expectSessionReady(page)
  await header.getByRole("button", { name: "Session actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Archive session", exact: true }).click()
  await confirmArchive(page)

  await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  const toast = page.locator("[data-sonner-toast]", { hasText: "Session archived" })
  await expect(toast.getByText("Bravo roadmap", { exact: true })).toBeVisible()
  await expect.poll(() => sidebarOrder(page)).toEqual(before.filter((href) => href !== sessionPath(app, bravo!.id)))

  await toast.getByRole("button", { name: "Undo", exact: true }).click()
  await expect.poll(() => sidebarOrder(page)).toEqual(before)
  await expect(toast).toHaveCount(0)
  await expect.poll(async () => (await app.client.session.get({ sessionID: bravo!.id })).archivedAt).toBeUndefined()
})

test("an archived Session open in another page shows a Restore notice and a disabled composer", async ({
  page,
  app,
}) => {
  const [alpha] = await seedSessions(app, ["Alpha budget"])
  const other = await page.context().newPage()
  const failures: string[] = []
  other.on("pageerror", (error) => failures.push(error.message))
  await other.goto(sessionPath(app, alpha!.id))
  await expectSessionReady(other)
  await other
    .locator('[data-component="session-header"]')
    .getByRole("button", { name: "Session actions", exact: true })
    .click()
  await other.getByRole("menuitem", { name: "Archive session", exact: true }).click()
  await confirmArchive(other)
  await expect(other.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()

  const notice = page.getByRole("status").filter({ hasText: "This session is archived." })
  const composer = page.getByRole("combobox", { name: "Message", exact: true })
  await expect(notice).toBeVisible()
  await expect(composer).not.toBeEditable()
  await page.reload()
  await expect(notice).toBeVisible()
  await expect(composer).not.toBeEditable()

  await notice.getByRole("button", { name: "Restore session", exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect(composer).toBeEditable()
  await expect.poll(async () => (await app.client.session.get({ sessionID: alpha!.id })).archivedAt).toBeUndefined()
  expect(failures).toEqual([])
})

test("renaming a Session to nothing keeps its previous title", async ({ page, app }) => {
  const [alpha] = await seedSessions(app, ["Alpha budget"])
  const header = page.locator('[data-component="session-header"]')
  const rename = header.getByRole("button", { name: "Rename session Alpha budget", exact: true })
  await rename.click()
  const editor = page.getByRole("textbox", { name: "Session title", exact: true })
  await expect(editor).toBeFocused()
  await editor.fill("   ")
  await editor.press("Enter")

  await expect(editor).toHaveCount(0)
  await expect(rename).toBeVisible()
  await expect(sidebar(page).getByRole("link", { name: /Alpha budget/ })).toBeVisible()
  expect((await app.client.session.get({ sessionID: alpha!.id })).title).toBe("Alpha budget")
})

test("archiving asks first from the header and the sidebar, and Cancel keeps the Session", async ({ page, app }) => {
  const [alpha, bravo] = await seedSessions(app, ["Alpha budget", "Bravo roadmap"])
  const header = page.locator('[data-component="session-header"]')
  const dialog = page.getByRole("dialog", { name: "Archive session?", exact: true })
  const archived = async (id: Session.ID) => (await app.client.session.get({ sessionID: id })).archivedAt

  await header.getByRole("button", { name: "Session actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Archive session", exact: true }).click()
  await expect(dialog).toContainText("“Alpha budget” will be hidden from session lists")
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(header.getByRole("heading", { name: "Rename session Alpha budget", exact: true })).toBeVisible()
  expect(await archived(alpha!.id)).toBeUndefined()

  const row = sidebar(page).locator(`a[href="${sessionPath(app, bravo!.id)}"]`)
  await row.hover()
  await sidebar(page).getByRole("button", { name: "Session actions", exact: true }).first().click()
  await page.getByRole("menuitem", { name: "Archive session", exact: true }).click()
  await expect(dialog).toContainText("“Bravo roadmap” will be hidden from session lists")
  await confirmArchive(page)
  await expect(row).toHaveCount(0)
  await expect.poll(() => archived(bravo!.id)).toBeDefined()
  expect(await archived(alpha!.id)).toBeUndefined()
})

test("a project page lists its archived Sessions and restores one", async ({ page, app }) => {
  const [alpha, bravo] = await seedSessions(app, ["Alpha budget", "Bravo roadmap"])
  const workspace = app.data.owner.properties.workspaceID
  await app.client.session.update({ sessionID: bravo!.id, archived: true })
  await page.goto(`/w/${workspace}/prj/${app.data.project.id}`)
  await expect(page.getByRole("heading", { name: app.data.project.name ?? "Untitled", exact: true })).toBeVisible()
  const active = page.getByRole("navigation", { name: "Sessions", exact: true })
  await expect(active.getByRole("link", { name: /Alpha budget/ })).toBeVisible()
  await expect(active.getByRole("link", { name: /Bravo roadmap/ })).toHaveCount(0)

  await page.getByRole("button", { name: "Archived", exact: true }).click()
  const list = page.getByRole("navigation", { name: "Archived", exact: true })
  await expect(list.getByRole("link", { name: /Bravo roadmap/ })).toBeVisible()
  await expect(list.getByRole("link", { name: /Alpha budget/ })).toHaveCount(0)

  // An archived Session opens read-only, with its Restore notice.
  await list.getByRole("link", { name: /Bravo roadmap/ }).click()
  await expect(page).toHaveURL(new URL(sessionPath(app, bravo!.id), app.web).href)
  await expect(page.getByRole("status").filter({ hasText: "This session is archived." })).toBeVisible()
  await page.goBack()

  await page.getByRole("button", { name: "Archived", exact: true }).click()
  await list.getByRole("button", { name: "Restore session: Bravo roadmap", exact: true }).click()
  await expect(list.getByText("No archived sessions", { exact: true })).toBeVisible()
  await expect.poll(async () => (await app.client.session.get({ sessionID: bravo!.id })).archivedAt).toBeUndefined()

  // A Session archived elsewhere appears in the open archive without reloading.
  await app.client.session.update({ sessionID: alpha!.id, archived: true })
  await expect(list.getByRole("link", { name: /Alpha budget/ })).toBeVisible()

  await page.getByRole("button", { name: "Active", exact: true }).click()
  await expect(active.getByRole("link", { name: /Bravo roadmap/ })).toBeVisible()
})
