import { expect, test } from "../fixtures/app.js"

test("changing the default model moves the Default tag without a reload", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const rows = (await app.client.model.list({ workspace })).filter(
    (row) => row.enabled && row.unavailableReason === undefined,
  )
  const [first, second] = rows
  if (!first || !second) throw new Error("The scenario needs two usable models")
  await page.goto(`/w/${workspace}/gateway/models`)
  const list = page.getByRole("list", { name: "Workspace models", exact: true })
  const row = (name: string) =>
    list.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Actions for ${name}`, exact: true }) })
  const tagged = list.getByRole("listitem").filter({ has: page.getByText("Default", { exact: true }) })

  for (const next of [first, second, first]) {
    await row(next.info.name)
      .getByRole("button", { name: `Actions for ${next.info.name}`, exact: true })
      .click()
    await page.getByRole("menuitem", { name: "Set as default", exact: true }).click()
    await expect(page.getByText(`${next.info.name} set as the default model.`)).toBeVisible()
    await expect(tagged).toHaveCount(1)
    await expect(row(next.info.name).getByText("Default", { exact: true })).toBeVisible()
    expect(
      (await app.client.model.list({ workspace }))
        .filter((item) => item.isPreferredDefault)
        .map((item) => item.info.id),
    ).toEqual([next.info.id])
  }
})
