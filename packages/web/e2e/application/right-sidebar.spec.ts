import { ProjectFile } from "@bymorning/testing/scenario/project-file"
import type { Page } from "@playwright/test"
import { Effect } from "effect"
import { readFile } from "node:fs/promises"

import { expect, test } from "../fixtures/app.js"

/** Open a tree row's action menu the way a pointer user does, then choose one action. */
const choose = async (page: Page, row: string, menu: string, action: string) => {
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  await sidebar.getByRole("treeitem", { name: row, exact: true }).hover()
  await sidebar.getByRole("button", { name: menu, exact: true }).click()
  await page.getByRole("menuitem", { name: action, exact: true }).click()
}

test("shows named file preview loading with a spinner", async ({ page, app }) => {
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  const { promise: release, resolve } = Promise.withResolvers<void>()
  await page.route(`**/api/project/${app.data.project.id}/directory/file*`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    await release
    await route.continue()
  })
  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole("button", { name: "Hide file tree", exact: true })).toBeVisible()
  const file = sidebar.getByRole("treeitem", { name: app.data.path, exact: true })
  await expect(file).toBeVisible()
  await file.click()
  const status = preview.getByRole("status").filter({ hasText: "Loading file…" })
  await expect(status).toBeVisible()
  await expect(status.locator('[data-component="spinner"]')).toBeVisible()
  resolve()
  await expect(preview).toContainText(app.data.content)
})

test("shows the file tree by default and remembers hiding it across reload", async ({ page, app }) => {
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const file = sidebar.getByRole("treeitem", { name: app.data.path, exact: true })
  const key = `bymorning.workspace:${app.data.owner.properties.workspaceID}:layout`
  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await expect(file).toBeVisible()
  await sidebar.getByRole("button", { name: "Hide file tree", exact: true }).click()
  await expect(file).toHaveCount(0)
  await expect(sidebar.getByRole("button", { name: "Show file tree", exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).rightSidebar.tree, key))
    .toBe(false)
  await page.reload()
  await expect(sidebar.getByRole("button", { name: "Show file tree", exact: true })).toBeVisible()
  await expect(file).toHaveCount(0)
  await sidebar.getByRole("button", { name: "Show file tree", exact: true }).click()
  await expect(file).toBeVisible()
})

test("uploads files into the root or the selected folder and downloads files from the tree", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const projectID = app.data.project.id
  const read = async (path: string) =>
    Buffer.from(await app.client.project.directory.read({ workspace, projectID, path })).toString()
  await app.client.project.directory.write({
    workspace,
    projectID,
    path: "docs/seed.txt",
    contentType: "text/plain",
    payload: new TextEncoder().encode("seed"),
  })
  await page.reload()
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const upload = sidebar.getByLabel("Choose files to upload", { exact: true })
  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await expect(sidebar.getByRole("treeitem", { name: "seed.txt", exact: true })).toBeVisible()

  // No folder chosen: the file lands in the Project root and the tree refreshes.
  await upload.setInputFiles({ name: "root-upload.txt", mimeType: "text/plain", buffer: Buffer.from("to the root") })
  await expect(sidebar.getByRole("treeitem", { name: "root-upload.txt", exact: true })).toBeVisible()
  await expect(page.getByText("File uploaded", { exact: true })).toBeVisible()
  expect(await read("root-upload.txt")).toBe("to the root")

  // A chosen folder becomes the target.
  await sidebar.getByRole("treeitem", { name: "docs", exact: true }).click()
  await expect(sidebar.getByText("Uploads go to docs/", { exact: true })).toBeVisible()
  await sidebar.getByRole("treeitem", { name: "docs", exact: true }).click()
  await upload.setInputFiles({ name: "folder-upload.txt", mimeType: "text/plain", buffer: Buffer.from("to docs") })
  await expect(sidebar.getByRole("treeitem", { name: "folder-upload.txt", exact: true })).toBeVisible()
  expect(await read("docs/folder-upload.txt")).toBe("to docs")

  // Download from the preview header.
  await sidebar.getByRole("treeitem", { name: app.data.path, exact: true }).click()
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  await expect(preview).toContainText(app.data.content)
  const [fromPreview] = await Promise.all([
    page.waitForEvent("download"),
    preview.getByRole("button", { name: `Download ${app.data.path}`, exact: true }).click(),
  ])
  expect(fromPreview.suggestedFilename()).toBe(app.data.path)
  expect((await readFile((await fromPreview.path())!)).toString()).toBe(app.data.content)

  // Download from a file row menu; nested files are named after the file, not the folder path.
  const row = sidebar.getByRole("treeitem", { name: "folder-upload.txt", exact: true })
  await row.hover()
  await sidebar.getByRole("button", { name: "Actions for docs/folder-upload.txt", exact: true }).click()
  const [fromRow] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download", exact: true }).click(),
  ])
  expect(fromRow.suggestedFilename()).toBe("folder-upload.txt")
  expect((await readFile((await fromRow.path())!)).toString()).toBe("to docs")
})

test("renames a file to a full path from its row menu, refusing an occupied path inline and following the open preview", async ({
  page,
  app,
}) => {
  const workspace = app.data.owner.properties.workspaceID
  const projectID = app.data.project.id
  await Effect.runPromise(
    ProjectFile.seed(app, app.data, [
      { path: "docs/guide.md", content: "# Guide" },
      { path: "docs/taken.md", content: "# Taken" },
    ]),
  )
  await page.reload()
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await sidebar.getByRole("treeitem", { name: "guide.md", exact: true }).click()
  await expect(preview).toContainText("Guide")

  await choose(page, "guide.md", "Actions for docs/guide.md", "Rename…")
  const dialog = page.getByRole("dialog", { name: "Rename guide.md", exact: true })
  const input = dialog.getByRole("textbox", { name: "File path", exact: true })
  await expect(input).toBeFocused()
  await expect(input).toHaveValue("docs/guide.md")
  // Typing replaces only the selected file name, keeping its folder and extension.
  await page.keyboard.type("taken")
  await expect(input).toHaveValue("docs/taken.md")
  await dialog.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText("A file already exists at docs/taken.md")
  await expect(dialog).toBeVisible()

  await input.fill("archive/2026/guide.md")
  await dialog.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("File moved", { exact: true })).toBeVisible()
  await expect(page.getByText("docs/guide.md → archive/2026/guide.md", { exact: true })).toBeVisible()
  await expect(sidebar.getByRole("treeitem", { name: "guide.md", exact: true })).toHaveAttribute(
    "title",
    "archive/2026/guide.md",
  )
  await expect(sidebar.getByRole("treeitem", { name: "taken.md", exact: true })).toBeVisible()
  await expect(preview.locator('[data-slot="file-browser-preview-title"]')).toHaveText("archive/2026/guide.md")
  await expect(preview).toContainText("Guide")
  const listed = await app.client.project.directory.list({ workspace, projectID })
  expect(listed.paths).toEqual(["archive/2026/guide.md", "docs/taken.md", app.data.path])
})

test("deletes a file only after confirming, clearing its open preview", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const projectID = app.data.project.id
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  const file = sidebar.getByRole("treeitem", { name: app.data.path, exact: true })
  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await file.click()
  await expect(preview).toContainText(app.data.content)

  await choose(page, app.data.path, `Actions for ${app.data.path}`, "Delete…")
  const confirm = page.getByRole("dialog", { name: `Delete ${app.data.path}?`, exact: true })
  await expect(confirm).toContainText("This cannot be undone.")
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(confirm).toBeHidden()
  await expect(file).toBeVisible()

  await choose(page, app.data.path, `Actions for ${app.data.path}`, "Delete…")
  await confirm.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByText("File deleted", { exact: true })).toBeVisible()
  await expect(file).toHaveCount(0)
  await expect(sidebar.getByText("This Project has no files.", { exact: true })).toBeVisible()
  await expect(preview.getByText("Select a file to preview.", { exact: true })).toBeVisible()
  expect((await app.client.project.directory.list({ workspace, projectID })).paths).toEqual([])
})

test("renames a folder by moving every file under it, then deletes it after confirming its file count", async ({
  page,
  app,
}) => {
  const workspace = app.data.owner.properties.workspaceID
  const projectID = app.data.project.id
  const read = async (path: string) =>
    Buffer.from(await app.client.project.directory.read({ workspace, projectID, path })).toString()
  await Effect.runPromise(
    ProjectFile.seed(app, app.data, [
      { path: "docs/a.md", content: "# Alpha" },
      { path: "docs/nested/b.md", content: "# Beta" },
    ]),
  )
  await page.reload()
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await sidebar.getByRole("treeitem", { name: "b.md", exact: true }).click()
  await expect(preview).toContainText("Beta")

  await choose(page, "docs", "Actions for folder docs", "Rename folder…")
  const rename = page.getByRole("dialog", { name: "Rename folder docs", exact: true })
  await rename.getByRole("textbox", { name: "Folder path", exact: true }).fill("guides")
  await rename.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(rename).toBeHidden()
  await expect(page.getByText("Folder renamed", { exact: true })).toBeVisible()
  await expect(sidebar.getByRole("treeitem", { name: "docs", exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole("treeitem", { name: "guides", exact: true })).toBeVisible()
  await expect(sidebar.getByRole("treeitem", { name: "b.md", exact: true })).toHaveAttribute(
    "title",
    "guides/nested/b.md",
  )
  await expect(preview.locator('[data-slot="file-browser-preview-title"]')).toHaveText("guides/nested/b.md")
  await expect(preview).toContainText("Beta")
  expect((await app.client.project.directory.list({ workspace, projectID })).paths).toEqual([
    "guides/a.md",
    "guides/nested/b.md",
    app.data.path,
  ])
  expect(await read("guides/a.md")).toBe("# Alpha")

  await choose(page, "guides", "Actions for folder guides", "Delete folder…")
  const confirm = page.getByRole("dialog", { name: "Delete guides?", exact: true })
  await expect(confirm).toContainText("This deletes 2 files in guides/. This cannot be undone.")
  await confirm.getByRole("button", { name: "Delete 2 files", exact: true }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByText("Folder deleted", { exact: true })).toBeVisible()
  await expect(sidebar.getByRole("treeitem", { name: "guides", exact: true })).toHaveCount(0)
  await expect(preview.getByText("Select a file to preview.", { exact: true })).toBeVisible()
  expect((await app.client.project.directory.list({ workspace, projectID })).paths).toEqual([app.data.path])
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`migrates and restores the right sidebar with real file previews at ${viewport.width}px`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize(viewport)
    const key = `bymorning.workspace:${app.data.owner.properties.workspaceID}:layout`
    await page.evaluate(
      (key) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            sidebar: { opened: true, width: 256 },
            session: { width: 640 },
            projectFiles: { opened: true },
          }),
        ),
      key,
    )
    await page.reload()

    const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
    const filter = sidebar.getByRole("searchbox", { name: "Filter project files", exact: true })
    const file = sidebar.getByRole("treeitem", { name: app.data.path, exact: true })
    const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
    const toggle = page.getByRole("button", { name: "Right sidebar", exact: true })
    if (viewport.width > 916)
      await expect(sidebar.getByRole("button", { name: "Hide file tree", exact: true })).toBeVisible()
    await expect(file).toBeVisible()
    await expect
      .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key))
      .toEqual({
        version: 2,
        sidebar: { opened: true, width: 256 },
        session: { width: 640 },
        rightSidebar: { opened: true, tree: true },
      })

    await file.click()
    await expect(preview).toContainText(app.data.content)
    if (viewport.width < 916) {
      const back = sidebar.getByRole("button", { name: "Back to files", exact: true })
      await expect(back).toBeFocused()
      await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeHidden()
      await back.click()
      await expect(filter).toBeFocused()
      await file.click()
      await expect(preview).toContainText(app.data.content)
    } else {
      const handle = sidebar.locator('[data-component="resize-handle"]')
      await expect(handle).toBeVisible()
      const bounds = await handle.boundingBox()
      if (!bounds) throw new Error("Sidebar resize handle has no bounds")
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width / 2 - 60, bounds.y + bounds.height / 2)
      await page.mouse.up()
      await expect
        .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).session.width, key))
        .toBe(580)
      await handle.dblclick()
      await expect
        .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).session.width, key))
        .toBe(600)

      const expand = sidebar.getByRole("button", { name: "Expand right sidebar", exact: true })
      await expand.click()
      await expect(sidebar.getByRole("button", { name: "Collapse right sidebar", exact: true })).toBeVisible()
      await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeHidden()
      await expect
        .poll(async () => {
          const panel = await sidebar.boundingBox()
          const workspace = await page.locator('[data-component="session-workspace"]').boundingBox()
          if (!panel || !workspace) return false
          return Math.abs(panel.width - workspace.width) < 2
        })
        .toBe(true)
      await expect
        .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).session.width, key))
        .toBe(600)
      await sidebar.getByRole("button", { name: "Collapse right sidebar", exact: true }).click()
      await expect(expand).toBeVisible()
      await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
      await expect(handle).toBeVisible()
    }

    await sidebar.getByRole("button", { name: "Close right sidebar", exact: true }).click()
    await expect(toggle).toBeFocused()
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
    await toggle.click()
    await expect(preview).toContainText(app.data.content)
    await page.reload()
    await expect(file).toBeVisible()
    await file.click()
    await expect(preview).toContainText(app.data.content)
    await page.screenshot({ path: test.info().outputPath(`right-sidebar-${viewport.width}.png`) })
  })
}
