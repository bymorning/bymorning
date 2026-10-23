import { expect, test } from "../fixtures/app.js"

const pickerLabel = (name: string) => name.replace("(latest)", "").trim()

const day = 24 * 60 * 60 * 1000

// Enable is the only picker gate: the Models page has no personal "Show in picker" control.
test("disabling a model removes it from the session picker after reload without changing the session model", async ({
  page,
  app,
}) => {
  const workspace = app.data.owner.properties.workspaceID
  const session = app.data.session
  const rows = await app.client.model.list({ workspace })
  const selected = rows.find((row) => row.info.provider === session.model.provider && row.info.id === session.model.id)
  if (!selected) throw new Error("Scenario model is missing")
  const name = pickerLabel(selected.info.name)
  // The picker lists only each family's newest Model released within six months of the present, so a
  // fixed Model silently ages out of it. Pin the browser's present just after the scenario Model's own
  // release (read from the catalog, so a refresh cannot stale this) and let time flow from there.
  const released = Date.parse(selected.info.releaseDate)
  if (Number.isNaN(released)) throw new Error("Scenario model has no release date")
  await page.clock.install({ time: released + 30 * day })
  await page.reload()
  const trigger = page.getByRole("button", { name: `Model, ${name}`, exact: true })
  const search = page.getByRole("combobox", { name: "Search models", exact: true })

  // Pick another model the session picker currently offers.
  await expect(trigger).toBeEnabled()
  await trigger.click()
  await expect(search).toBeEditable()
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
  const candidates = rows.filter(
    (row) =>
      row.enabled &&
      !row.isPreferredDefault &&
      row.info.provider === selected.info.provider &&
      row.info.id !== selected.info.id &&
      pickerLabel(row.info.name) !== name,
  )
  let target: (typeof rows)[number] | undefined
  for (const row of candidates) {
    if ((await page.getByRole("option", { name: pickerLabel(row.info.name), exact: true }).count()) === 1) {
      target = row
      break
    }
  }
  if (!target) throw new Error("The session picker offers no other enabled model to disable")
  const label = pickerLabel(target.info.name)
  await page.keyboard.press("Escape")
  await expect(search).toHaveCount(0)

  await page.goto(`/w/${workspace}/gateway/models`)
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible()
  await expect(page.getByRole("switch", { name: /in picker/i })).toHaveCount(0)
  await page.getByRole("searchbox", { name: "Search models", exact: true }).fill(target.info.name)
  const enabled = page.getByRole("switch", { name: `Enabled ${target.info.name}`, exact: true })
  await expect(enabled).toBeChecked()
  await page.getByRole("button", { name: `Actions for ${target.info.name}`, exact: true }).click()
  await page.getByRole("menuitem", { name: "Disable", exact: true }).click()
  await expect(enabled).not.toBeChecked()
  await expect
    .poll(
      async () =>
        (await app.client.model.list({ workspace })).find(
          (row) => row.info.provider === target.info.provider && row.info.id === target.info.id,
        )?.enabled,
    )
    .toBe(false)

  await page.goto(`/w/${workspace}/session/${session.id}`)
  await expect(trigger).toBeEnabled()
  await page.reload()
  await expect(trigger).toBeEnabled()
  await trigger.click()
  await expect(search).toBeEditable()
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
  await expect(page.getByRole("option", { name: label, exact: true })).toHaveCount(0)
  await search.fill(label)
  await expect(page.getByRole("option", { name: label, exact: true })).toHaveCount(0)

  expect((await app.client.session.get({ sessionID: session.id })).model).toEqual(session.model)
  expect(
    (await app.client.model.list({ workspace })).find(
      (row) => row.info.provider === selected.info.provider && row.info.id === selected.info.id,
    )?.enabled,
  ).toBe(true)
})
