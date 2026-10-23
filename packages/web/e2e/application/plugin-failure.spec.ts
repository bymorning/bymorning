import { TestApp } from "@bymorning/testing/application"
import { Chat } from "@bymorning/testing/scenario/chat"
import { PluginAuthoring } from "@bymorning/testing/scenario/plugin-authoring"
import { Effect } from "effect"
import { expect, makeTest } from "../fixtures/app.js"
import { sidebar } from "./sessions.js"

// The production incident: a Project plugin whose OAuth method has no authorize function sits beside a
// valid one before the browser ever opens the Workspace.
const test = makeTest((app) =>
  Effect.gen(function* () {
    const data = yield* Chat.make(app)
    const installed = yield* PluginAuthoring.install(app, data, [PluginAuthoring.sibling, PluginAuthoring.incident])
    expect(installed.rows).toContainEqual(
      expect.objectContaining({
        id: "project.integration.google-workspace",
        status: "failed",
        error: PluginAuthoring.incidentError,
      }),
    )
    return data
  }),
)

// Project plugins import `effect` and `@bymorning/plugin`, which resolve only beneath the repository.
test.use({ appOptions: { parent: TestApp.repository } })

test("a Workspace with a malformed Project plugin loads and the sidebar creates a project", async ({ page, app }) => {
  const workspace = app.data.owner.properties.workspaceID
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const nav = sidebar(page)

  await page.goto("/login")
  await expect(page).toHaveURL(new URL(`/w/${workspace}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  await expect(nav.getByRole("button", { name: /^(Expand|Collapse) sessions for Conversation fixture$/ })).toBeVisible()

  const create = page.getByRole("dialog", { name: "Create project", exact: true })
  await nav.getByRole("button", { name: "Create project", exact: true }).click()
  const name = create.getByRole("textbox", { name: "Name", exact: true })
  await expect(name).toBeFocused()
  await name.fill("Roadmap")
  const created = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/project",
  )
  await create.getByRole("button", { name: "Create project", exact: true }).click()
  const project = (await (await created).json()) as { readonly id: string; readonly name: string }

  await expect(create).toBeHidden()
  expect(project.name).toBe("Roadmap")
  await expect(page).toHaveURL(new URL(`/w/${workspace}/prj/${project.id}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Roadmap", exact: true })).toBeVisible()
  await expect(nav.getByRole("button", { name: /^(Expand|Collapse) sessions for Roadmap$/ })).toBeVisible()
  expect(errors).toEqual([])
})
