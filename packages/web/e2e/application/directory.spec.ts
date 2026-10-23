import { ProjectFile } from "@bymorning/testing/scenario/project-file"
import type { Page } from "@playwright/test"
import { Effect } from "effect"

import { expect, test } from "../fixtures/app.js"

/** Choose a file through the sidebar's Upload files button and its native file chooser. */
const upload = async (page: Page, name: string, text: string) => {
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const button = sidebar.getByRole("button", { name: "Upload files", exact: true })
  await expect(button).toBeEnabled()
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.click()])
  await chooser.setFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) })
  // Dismiss the confirmation so the next identical upload shows its own.
  const toast = page.locator("[data-sonner-toast]", { hasText: "File uploaded" })
  await expect(toast).toContainText("To docs/")
  await toast.getByRole("button", { name: "Dismiss", exact: true }).click()
  await expect(toast).toHaveCount(0)
}

test("uploads and overwrites a real Project file and refreshes its cached preview", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const projectID = app.data.project.id
  const path = "docs/upload.txt"
  const read = async () =>
    Buffer.from(await app.client.project.directory.read({ workspace, projectID, path })).toString()
  await Effect.runPromise(ProjectFile.seed(app, app.data, [{ path: "docs/seed.txt", content: "seed" }]))
  await page.reload()
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  const folder = sidebar.getByRole("treeitem", { name: "docs", exact: true })
  const file = sidebar.getByRole("treeitem", { name: "upload.txt", exact: true })
  /** Make docs/ the upload target; a folder click also toggles it, so the second click re-expands it. */
  const target = async () => {
    await folder.click()
    await expect(sidebar.getByText("Uploads go to docs/", { exact: true })).toBeVisible()
    await folder.click()
    await expect(folder).toHaveAttribute("aria-expanded", "true")
  }
  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await expect(sidebar.getByRole("treeitem", { name: "seed.txt", exact: true })).toBeVisible()

  await target()
  await upload(page, "upload.txt", "Original uploaded content")
  await expect(file).toHaveCount(1)
  expect(await read()).toBe("Original uploaded content")
  await file.click()
  await expect(preview).toContainText("Original uploaded content")

  // Uploading the same name into the same folder overwrites the file, and the open preview follows.
  await target()
  await upload(page, "upload.txt", "Overwritten uploaded content")
  await expect(preview).toContainText("Overwritten uploaded content")
  await expect(preview).not.toContainText("Original uploaded content")
  await expect(file).toHaveCount(1)
  expect(await read()).toBe("Overwritten uploaded content")
})
