import { expect, test } from "../fixtures/app.js"

test("an administrator adds, edits, and deletes a custom model from the Models page", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  await page.goto(`/w/${workspace}/gateway/models`)
  const list = page.getByRole("list", { name: "Workspace models", exact: true })
  await expect(list).toBeVisible()
  const row = (name: string) =>
    list.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Actions for ${name}`, exact: true }) })

  await page.getByRole("button", { name: "Add model", exact: true }).click()
  const add = page.getByRole("dialog", { name: "Add custom model" })
  await add.getByRole("textbox", { name: "Display label" }).fill("Pinned DeepSeek")
  await add.getByRole("textbox", { name: "Upstream model name" }).fill("deepseek-pinned-upstream")
  await add.getByRole("textbox", { name: "Input price" }).fill("2")
  await add.getByRole("textbox", { name: "Context limit" }).fill("64000")
  await add.getByRole("button", { name: "Add model", exact: true }).click()
  await expect(page.getByText("Pinned DeepSeek added.")).toBeVisible()
  await expect(add).toBeHidden()
  await page.getByRole("searchbox", { name: "Search models" }).fill("Pinned")
  await expect(row("Pinned DeepSeek").getByText("Custom", { exact: true })).toBeVisible()
  const created = (await app.client.model.list({ workspace })).find(
    (item) => item.info.id === "deepseek-pinned-upstream",
  )
  expect(created).toMatchObject({
    custom: true,
    info: { name: "Pinned DeepSeek", apiID: "deepseek-pinned-upstream", cost: { input: 2 }, limit: { context: 64000 } },
  })

  await row("Pinned DeepSeek").getByRole("button", { name: "Actions for Pinned DeepSeek", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const edit = page.getByRole("dialog", { name: "Edit custom model" })
  await edit.getByRole("textbox", { name: "Upstream model name" }).fill("deepseek-pinned-v2")
  await edit.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByText("Pinned DeepSeek saved.")).toBeVisible()
  await expect(edit).toBeHidden()
  await expect
    .poll(
      async () =>
        (await app.client.model.list({ workspace })).find((item) => item.info.id === "deepseek-pinned-upstream")?.info
          .apiID,
    )
    .toBe("deepseek-pinned-v2")

  await row("Pinned DeepSeek").getByRole("button", { name: "Actions for Pinned DeepSeek", exact: true }).click()
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
  const confirm = page.getByRole("dialog", { name: "Delete Pinned DeepSeek?" })
  await confirm.getByRole("button", { name: "Delete model", exact: true }).click()
  await expect(page.getByText("Pinned DeepSeek deleted.")).toBeVisible()
  await expect(row("Pinned DeepSeek")).toHaveCount(0)
  expect((await app.client.model.list({ workspace })).some((item) => item.info.id === "deepseek-pinned-upstream")).toBe(
    false,
  )
})
