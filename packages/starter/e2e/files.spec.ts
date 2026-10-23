import { expect, test } from "./fixture.js"

async function files(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Files", exact: true }).click()
  return page.getByRole("region", { name: "Project files", exact: true })
}

async function selectFile(page: import("@playwright/test").Page, path: string) {
  const browser = await files(page)
  await expect(browser.getByRole("button", { name: path, exact: true })).toBeVisible()
  await browser.getByRole("button", { name: path, exact: true }).click()
  await expect(page.getByRole("region", { name: "File content", exact: true })).toBeVisible()
  return browser
}

test("filters listed project paths locally without issuing a search request", async ({ page }) => {
  const requests: URL[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname.includes("/directory")) requests.push(url)
  })

  const browser = await files(page)
  await expect(browser.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible()
  const afterList = requests.length

  await browser.getByRole("textbox", { name: "Find file", exact: true }).fill("zzzz")
  await expect(browser.getByRole("button", { name: "notes.txt", exact: true })).toHaveCount(0)
  expect(requests).toHaveLength(afterList)
  expect(
    requests.every(
      (url) => !url.searchParams.has("search") && !url.searchParams.has("filter") && !url.searchParams.has("query"),
    ),
  ).toBe(true)
})

test("does not read the directory while the Files tab is closed", async ({ page, app }) => {
  const requests: URL[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === `/api/project/${app.data.project.id}/directory`) requests.push(url)
  })
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable()
  expect(requests).toEqual([])
})

test("keeps directory cache entries isolated when the selected project changes", async ({ page, app }) => {
  const name = "File cache scope"
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(name)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible()
  const projects = await app.client.project.list({ workspace: app.data.owner.properties.workspaceID })
  const project = projects.find((item) => item.name === name)
  if (!project) throw new Error("The real project creation did not persist")
  await app.client.project.directory.write({
    workspace: app.data.owner.properties.workspaceID,
    projectID: project.id,
    path: "scoped.txt",
    payload: new TextEncoder().encode("second project"),
    contentType: "text/plain",
  })

  const browser = await files(page)
  await expect(browser.getByRole("button", { name: "scoped.txt", exact: true })).toBeVisible()
  await expect(browser.getByRole("button", { name: app.data.path, exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: app.data.project.name, exact: true }).click()
  await expect(browser.getByRole("button", { name: app.data.path, exact: true })).toBeVisible()
  await expect(browser.getByRole("button", { name: "scoped.txt", exact: true })).toHaveCount(0)
})

test("reads, saves, and reloads a listed text file through the real directory SDK", async ({ page, app }) => {
  await selectFile(page, app.data.path)
  const content = page.getByRole("textbox", { name: "File content", exact: true })
  const replacement = "saved from the real browser editor"
  await content.fill(replacement)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/api/project/${app.data.project.id}/directory/file`),
    ),
    page.getByRole("button", { name: "Save file", exact: true }).click(),
  ])
  await expect(page.getByRole("button", { name: "Save file", exact: true })).toBeEnabled()

  expect(
    await app.client.project.directory.read({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: app.data.path,
    }),
  ).toEqual(new TextEncoder().encode(replacement))

  await page.reload()
  await selectFile(page, app.data.path)
  await expect(page.getByRole("textbox", { name: "File content", exact: true })).toHaveValue(replacement)
})

test("refuses a listed binary file without changing its persisted bytes", async ({ page, app }) => {
  const path = "image.bin"
  const binary = Uint8Array.from([0, 255, 4, 12, 128])
  await app.client.project.directory.write({
    workspace: app.data.owner.properties.workspaceID,
    projectID: app.data.project.id,
    path,
    payload: binary,
    contentType: "application/octet-stream",
  })

  await selectFile(page, path)
  await expect(page.getByText("This binary file cannot be edited.", { exact: true })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "File content", exact: true })).toHaveCount(0)
  expect(
    await app.client.project.directory.read({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path,
    }),
  ).toEqual(binary)
})

test("saves the file selected when the write began even if another file is selected before its response", async ({
  page,
  app,
}) => {
  const first = "first.txt"
  const second = "second.txt"
  await Promise.all([
    app.client.project.directory.write({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: first,
      payload: new TextEncoder().encode("first"),
      contentType: "text/plain",
    }),
    app.client.project.directory.write({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: second,
      payload: new TextEncoder().encode("second"),
      contentType: "text/plain",
    }),
  ])
  await selectFile(page, first)
  await page.getByRole("textbox", { name: "File content", exact: true }).fill("first saved")
  const received = deferred<void>()
  const release = deferred<void>()
  await page.route(`**/api/project/${app.data.project.id}/directory/file*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue()
    const response = await route.fetch()
    received.resolve()
    await release.promise
    await route.fulfill({ response })
  })
  await Promise.all([received.promise, page.getByRole("button", { name: "Save file", exact: true }).click()])
  const browser = await files(page)
  await browser.getByRole("button", { name: second, exact: true }).click()
  await expect(page.getByRole("textbox", { name: "File content", exact: true })).toHaveValue("second")
  release.resolve()
  expect(
    await app.client.project.directory.read({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: first,
    }),
  ).toEqual(new TextEncoder().encode("first saved"))
  expect(
    await app.client.project.directory.read({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: second,
    }),
  ).toEqual(new TextEncoder().encode("second"))
})

test("a failed write for one file does not leave the newly selected file pending or in error", async ({
  page,
  app,
}) => {
  const first = "failed.txt"
  const second = "other.txt"
  await Promise.all([
    app.client.project.directory.write({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: first,
      payload: new TextEncoder().encode("first"),
      contentType: "text/plain",
    }),
    app.client.project.directory.write({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: second,
      payload: new TextEncoder().encode("second"),
      contentType: "text/plain",
    }),
  ])
  await selectFile(page, first)
  await page.getByRole("textbox", { name: "File content", exact: true }).fill("will fail")
  const received = deferred<void>()
  await page.route(`**/api/project/${app.data.project.id}/directory/file*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue()
    received.resolve()
    await route.abort("connectionfailed")
  })
  await Promise.all([received.promise, page.getByRole("button", { name: "Save file", exact: true }).click()])
  const browser = await files(page)
  await browser.getByRole("button", { name: second, exact: true }).click()
  await expect(page.getByRole("textbox", { name: "File content", exact: true })).toHaveValue("second")
  await expect(page.getByRole("region", { name: "File content", exact: true }).getByRole("alert")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Save file", exact: true })).toBeEnabled()
})

test("a delayed failed save for A cannot overwrite a completed save for B", async ({ page, app }) => {
  const first = "delayed-a.txt"
  const second = "completed-b.txt"
  await Promise.all([
    app.client.project.directory.write({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: first,
      payload: new TextEncoder().encode("A"),
      contentType: "text/plain",
    }),
    app.client.project.directory.write({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: second,
      payload: new TextEncoder().encode("B"),
      contentType: "text/plain",
    }),
  ])
  await selectFile(page, first)
  await page.getByRole("textbox", { name: "File content", exact: true }).fill("A draft")
  const received = deferred<void>()
  const release = deferred<void>()
  await page.route(`**/api/project/${app.data.project.id}/directory/file*`, async (route) => {
    if (route.request().method() !== "PUT" || new URL(route.request().url()).searchParams.get("path") !== first)
      return route.continue()
    received.resolve()
    await release.promise
    await route.abort("connectionfailed")
  })
  await Promise.all([received.promise, page.getByRole("button", { name: "Save file", exact: true }).click()])
  const browser = await files(page)
  await browser.getByRole("button", { name: second, exact: true }).click()
  await expect(page.getByRole("textbox", { name: "File content", exact: true })).toHaveValue("B")
  await page.getByRole("textbox", { name: "File content", exact: true }).fill("B saved")
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && new URL(response.url()).searchParams.get("path") === second,
    ),
    page.getByRole("button", { name: "Save file", exact: true }).click(),
  ])
  release.resolve()
  await expect(page.getByRole("region", { name: "File content", exact: true }).getByRole("alert")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Save file", exact: true })).toBeEnabled()
  expect(
    await app.client.project.directory.read({
      workspace: app.data.owner.properties.workspaceID,
      projectID: app.data.project.id,
      path: second,
    }),
  ).toEqual(new TextEncoder().encode("B saved"))
  await browser.getByRole("button", { name: first, exact: true }).click()
  await expect(page.getByRole("region", { name: "File content", exact: true }).getByRole("alert")).toContainText(
    "Could not save this file",
  )
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
