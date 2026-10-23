import { ProjectFile } from "@bymorning/testing/scenario/project-file"
import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"

test("refreshes the file tree, open preview, and @file references when the model writes Project files", async ({
  page,
  app,
}) => {
  const created = { path: "summary.md", content: "# Summary\n\nWritten by the model." }
  const revised = { path: app.data.path, content: "Revised by the model." }
  const sidebar = page.getByRole("complementary", { name: "Right sidebar", exact: true })
  const preview = sidebar.getByRole("region", { name: "File preview", exact: true })
  const tree = sidebar.getByRole("tree", { name: "Project files", exact: true })
  const timeline = page.locator('[data-component="message-timeline"]')
  const editor = page.getByRole("combobox", { name: "Message", exact: true })

  await page.getByRole("button", { name: "Right sidebar", exact: true }).click()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole("button", { name: "Hide file tree", exact: true })).toBeVisible()
  const existing = tree.getByRole("treeitem", { name: app.data.path, exact: true })
  await expect(existing).toBeVisible()
  await expect(tree.getByRole("treeitem")).toHaveCount(1)
  await existing.click()
  await expect(preview).toContainText(app.data.content)

  const script = await Effect.runPromise(ProjectFile.script(app, app.data, [created, revised]))
  await editor.fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])

  // The model reaches its final gate only after both real writes completed. Nothing reloads here:
  // the live project.file.changed Events alone must bring the tree and the open preview current.
  await expect(tree.getByRole("treeitem", { name: created.path, exact: true })).toBeVisible()
  await expect(tree.getByRole("treeitem")).toHaveCount(2)
  await expect(existing).toHaveAttribute("aria-selected", "true")
  await expect(preview).toContainText(revised.content)
  await expect(preview).not.toContainText(app.data.content)

  await editor.fill("@")
  const references = page.getByRole("listbox", { name: "References", exact: true })
  await expect(references.getByRole("option", { name: created.path, exact: true })).toBeVisible()
  await expect(references.getByRole("option", { name: app.data.path, exact: true })).toBeVisible()
  await editor.fill("")
  await expect(references).toBeHidden()

  await Effect.runPromise(app.llm.release(script.gate))
  await expect(timeline.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
