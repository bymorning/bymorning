import { ProjectArchive } from "@bymorning/testing/scenario/project-archive"
import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"
import { expectSessionReady, sessionPath, sidebar } from "./sessions.js"

const projectPath = (workspace: string, projectID: string) => `/w/${workspace}/prj/${projectID}`

test("archiving a project from its settings asks first, leaves for Overview, and Undo restores it", async ({
  page,
  app,
}) => {
  const workspace = app.data.owner.properties.workspaceID
  const name = app.data.project.name!
  const nav = sidebar(page)
  const row = nav.getByRole("button", { name: new RegExp(`^(Expand|Collapse) sessions for ${name}$`) })
  const overviewSession = page
    .getByRole("navigation", { name: "Sessions", exact: true })
    .locator(`a[href="${sessionPath(app, app.data.session.id)}"]`)
  await expect(row).toBeVisible()

  // The Default project explains why it cannot be archived.
  await nav.getByRole("link", { name: "Project settings for Default", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Default", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit project", exact: true }).click()
  const edit = page.getByRole("dialog", { name: "Edit project", exact: true })
  const archiveDefault = edit.getByRole("button", { name: "Archive project", exact: true })
  await expect(archiveDefault).toBeDisabled()
  await expect(archiveDefault).toHaveAccessibleDescription("The Default project can't be archived.")
  await edit.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(edit).toBeHidden()

  await nav.getByRole("link", { name: `Project settings for ${name}`, exact: true }).click()
  await expect(page).toHaveURL(new URL(projectPath(workspace, app.data.project.id), app.web).href)
  await page.getByRole("button", { name: "Edit project", exact: true }).click()
  await edit.getByRole("button", { name: "Archive project", exact: true }).click()
  const confirm = page.getByRole("dialog", { name: `Archive ${name}?`, exact: true })
  await expect(confirm).toContainText(
    "It will be hidden with its sessions and become read-only. You can restore it from Create project.",
  )
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(confirm).toBeHidden()
  expect((await app.client.project.get({ projectID: app.data.project.id })).archivedAt).toBeUndefined()

  await page.getByRole("button", { name: "Edit project", exact: true }).click()
  await edit.getByRole("button", { name: "Archive project", exact: true }).click()
  await confirm.getByRole("button", { name: "Archive project", exact: true }).click()
  await expect(confirm).toBeHidden()

  await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  const toast = page.locator("[data-sonner-toast]", { hasText: "Project archived" })
  await expect(toast.getByText(name, { exact: true })).toBeVisible()
  await expect(row).toHaveCount(0)
  await expect(nav.locator(`a[href="${sessionPath(app, app.data.session.id)}"]`)).toHaveCount(0)
  await expect(overviewSession).toHaveCount(0)
  expect((await app.client.project.get({ projectID: app.data.project.id })).archivedAt).toBeInstanceOf(Date)

  await toast.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(row).toBeVisible()
  await expect(toast).toHaveCount(0)
  await expect(overviewSession).toBeVisible()
  expect((await app.client.project.get({ projectID: app.data.project.id })).archivedAt).toBeUndefined()
})

test("Create project offers restoring an archived project, which opens it", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const name = app.data.project.name!
  const nav = sidebar(page)
  const create = page.getByRole("dialog", { name: "Create project", exact: true })
  const restore = page.getByRole("dialog", { name: "Restore an archived project", exact: true })

  await nav.getByRole("button", { name: "Create project", exact: true }).click()
  await create.getByRole("button", { name: "Restore an archived project", exact: true }).click()
  await expect(restore.getByText("No archived projects", { exact: true })).toBeVisible()
  await restore.getByRole("button", { name: "Back", exact: true }).click()
  await expect(create).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(create).toBeHidden()

  await Effect.runPromise(ProjectArchive.archive(app, app.data.project.id))
  await page.goto(`/w/${workspace}`)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  await expect(nav.getByRole("button", { name: new RegExp(`sessions for ${name}$`) })).toHaveCount(0)

  await nav.getByRole("button", { name: "Create project", exact: true }).click()
  await create.getByRole("button", { name: "Restore an archived project", exact: true }).click()
  const archived = restore.getByRole("list", { name: "Archived projects", exact: true }).getByRole("listitem")
  await expect(archived).toHaveCount(1)
  await expect(archived).toContainText(name)
  await expect(archived).toContainText(/Archived [A-Z][a-z]{2} \d{1,2}, \d{4}/)
  await archived.getByRole("button", { name: `Restore ${name}`, exact: true }).click()

  await expect(restore).toBeHidden()
  await expect(page).toHaveURL(new URL(projectPath(workspace, app.data.project.id), app.web).href)
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New session", exact: true })).toBeEnabled()
  await expect(nav.getByRole("button", { name: new RegExp(`sessions for ${name}$`) })).toBeVisible()
  expect((await app.client.project.get({ projectID: app.data.project.id })).archivedAt).toBeUndefined()
})

test("an archived project's page and its sessions show a Restore notice and a disabled composer", async ({
  page,
  app,
}) => {
  const workspace = app.data.owner.properties.workspaceID
  const composer = page.getByRole("combobox", { name: "Message", exact: true })
  await Effect.runPromise(ProjectArchive.archive(app, app.data.project.id))

  await page.reload()
  await expectSessionReady(page)
  const sessionNotice = page.getByRole("status").filter({ hasText: "This project is archived" })
  await expect(sessionNotice).toBeVisible()
  await expect(composer).not.toBeEditable()

  await page.goto(projectPath(workspace, app.data.project.id))
  const projectNotice = page.getByRole("status").filter({ hasText: "This project is archived" })
  await expect(page.getByRole("heading", { name: app.data.project.name!, exact: true })).toBeVisible()
  await expect(projectNotice).toBeVisible()
  await expect(page.getByRole("button", { name: "New session", exact: true })).toHaveCount(0)
  await projectNotice.getByRole("button", { name: "Restore", exact: true }).click()

  await expect(projectNotice).toHaveCount(0)
  await expect(page.getByRole("button", { name: "New session", exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await app.client.project.get({ projectID: app.data.project.id })).archivedAt)
    .toBeUndefined()
  await page.goto(sessionPath(app, app.data.session.id))
  await expectSessionReady(page)
  await expect(composer).toBeEditable()
  await expect(sessionNotice).toHaveCount(0)
})
