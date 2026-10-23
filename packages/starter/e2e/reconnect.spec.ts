import { Chat } from "@bymorning/testing/scenario/chat"
import { Effect } from "effect"
import { expect, test } from "./fixture.js"

test("recovers missed saved history through a real Event transport reconnection", async ({ page, app }) => {
  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))

  // This only cuts the browser's Event transport. The independent fixture SDK
  // remains a real public consumer and drives real server execution.
  await page.route("**/api/event*", (route) => route.abort("connectionfailed"))
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "Stream:" })).toContainText("Stream: reconnecting")

  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    app.client.session.prompt({ sessionID: app.data.session.id, text: script.prompt }),
  ])
  await Effect.runPromise(app.llm.release(script.gate))
  await Effect.runPromise(app.llm.settled(app.data.session.id, "assistant"))

  await page.unroute("**/api/event*")
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(page.getByText(script.prompt, { exact: true })).toHaveCount(1)
  await expect(page.getByText(script.answer, { exact: true })).toHaveCount(1)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})

test("does not refetch file queries while disconnected, then explicitly refreshes the mounted directory on reconnect", async ({
  page,
  app,
}) => {
  let directoryReads = 0
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === `/api/project/${app.data.project.id}/directory`
    )
      directoryReads += 1
  })
  await page.route("**/api/event*", (route) => route.abort("connectionfailed"))
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "Stream:" })).toContainText("Stream: reconnecting")
  await page.getByRole("tab", { name: "Files", exact: true }).click()
  const filesLoading = page.getByRole("status").filter({ hasText: "Loading files" })
  await expect(filesLoading).toBeVisible()
  const whileDisconnected = directoryReads

  await page.evaluate("dispatchEvent(new Event('focus'))")
  await expect(filesLoading).toBeVisible()
  expect(directoryReads).toBe(whileDisconnected)

  await page.unroute("**/api/event*")
  await Promise.all([
    page.waitForRequest(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/api/project/${app.data.project.id}/directory`,
    ),
    page.getByRole("button", { name: "Retry", exact: true }).click(),
  ])
  expect(directoryReads).toBeGreaterThan(whileDisconnected)
  await expect(page.getByRole("button", { name: app.data.path, exact: true })).toBeVisible()
})

test("opens an offline-selected project with exactly one directory read after reconnect recovery", async ({
  page,
  app,
}) => {
  const name = "Offline project"
  const path = "offline.txt"
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(name)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible()
  const project = (await app.client.project.list({ workspace: app.data.owner.properties.workspaceID })).find(
    (item) => item.name === name,
  )
  if (!project) throw new Error("The real project creation did not persist")
  await app.client.project.directory.write({
    workspace: app.data.owner.properties.workspaceID,
    projectID: project.id,
    path,
    payload: new TextEncoder().encode("offline project"),
    contentType: "text/plain",
  })
  await page.getByRole("button", { name: app.data.project.name, exact: true }).click()
  await page.getByRole("tab", { name: "Files", exact: true }).click()
  await expect(page.getByRole("button", { name: app.data.path, exact: true })).toBeVisible()

  let secondProjectReads = 0
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === `/api/project/${project.id}/directory`)
      secondProjectReads += 1
  })
  await page.route("**/api/event*", (route) => route.abort("connectionfailed"))
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "Stream:" })).toContainText("Stream: reconnecting")
  await page.getByRole("button", { name, exact: true }).click()
  await page.getByRole("tab", { name: "Files", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Loading files" })).toBeVisible()
  expect(secondProjectReads).toBe(0)

  await page.unroute("**/api/event*")
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/project/${project.id}/directory`,
    ),
    page.getByRole("button", { name: "Retry", exact: true }).click(),
  ])
  await expect(page.getByRole("button", { name: path, exact: true })).toBeVisible()
  expect(secondProjectReads).toBe(1)
})
