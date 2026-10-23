import { AuthScenario } from "@bymorning/testing/scenario/auth"
import { Chat } from "@bymorning/testing/scenario/chat"
import { TestUpstream } from "@bymorning/testing/upstream"
import { Integration } from "@bymorning/schema/integration"
import type { Locator, Page } from "@playwright/test"
import { Effect, Exit, Scope } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "../fixtures/app.js"

const routed = Chat.routedModel
const solLabel = "DeepSeek V4 Pro"
const lunaLabel = "GLM-5.1"

const mcpTest = test.extend<{ upstream: Effect.Success<ReturnType<typeof TestUpstream.make>> }>({
  upstream: async ({}, use) => {
    const scope = Effect.runSync(Scope.make())
    try {
      const upstream = await Effect.runPromise(
        TestUpstream.make({
          tools: [
            {
              name: "remote",
              description: "Return the fixture remote value",
              result: "remote fixture result",
            },
          ],
        }).pipe(Scope.provide(scope)),
      )
      await use(upstream)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  },
  appOptions: async ({ upstream }, use) => {
    void upstream
    await use({})
  },
})

async function choose(page: Page, scope: Locator, label: string, option: string, description?: string) {
  const section =
    label === "Destination model"
      ? scope.getByRole("region", { name: "Use", exact: true })
      : label === "Requested model" || label === "Completed tool"
        ? scope.getByRole("region", { name: "When", exact: true })
        : scope
  const visibleLabel =
    label === "Completed tool"
      ? "Tool"
      : label.includes("model")
        ? "Model"
        : label.replace(/^(Requested|Destination) /, "")
  const trigger = section.getByRole("group", { name: visibleLabel, exact: true }).getByRole("button")
  await trigger.click()
  const listbox = page.getByRole("listbox", { name: visibleLabel, exact: true, includeHidden: true })
  await expect(listbox).toBeVisible()
  const candidate = listbox.getByRole("option", { name: option, includeHidden: true })
  await (description ? candidate.filter({ hasText: description }) : candidate).click()
  await expect(trigger).toContainText(option)
}

async function addCondition(page: Page, dialog: Locator, condition: string) {
  const when = dialog.getByRole("region", { name: "When", exact: true })
  await when.getByRole("group", { name: "Add condition", exact: true }).getByRole("button").click()
  await page.getByRole("listbox", { includeHidden: true }).getByRole("option", { includeHidden: true }).filter({ hasText: condition }).click()
  await expect(when.getByRole("group", { name: condition, exact: true })).toBeVisible()
}

async function action(page: Page, rule: number, name: "Edit" | "Remove") {
  await page.getByRole("button", { name: `Actions for routing rule ${rule}`, exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

test("adds, edits, and removes a route through Console Routing", async ({ page, app }) => {
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/policies`)
  await expect(page.getByRole("heading", { name: "Model routing", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add route", exact: true })).toBeEnabled()
  await expect(page.getByRole("status", { name: "No routes", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Add route", exact: true }).click()
  const create = page.getByRole("dialog", { name: "Add route" })
  await expect(create).toBeVisible()
  await expect(
    create.getByRole("region", { name: "When" }).getByRole("group", { name: "Model", exact: true }).getByRole("button"),
  ).toBeVisible()
  await expect(
    create.getByRole("region", { name: "Use" }).getByRole("group", { name: "Model", exact: true }).getByRole("button"),
  ).toBeVisible()
  await choose(page, create, "Requested model", solLabel, "opencode/deepseek-v4-pro")
  await choose(page, create, "Destination model", lunaLabel, "opencode/glm-5.1")
  await create.getByRole("button", { name: "Add route", exact: true }).click()
  await expect(create).toHaveCount(0)
  const routes = page.getByRole("list", { name: "Routes", exact: true })
  await expect(routes).toContainText(`${solLabel} → ${lunaLabel}`)

  const added = await app.client["api.config"].get()
  expect(added.routing).toEqual([{ match: { model: Chat.model }, to: routed }])

  await action(page, 1, "Edit")
  const edit = page.getByRole("dialog", { name: "Edit route" })
  await choose(page, edit, "Destination model", solLabel, "opencode/deepseek-v4-pro")
  await edit.getByRole("button", { name: "Save route", exact: true }).click()
  await expect(edit).toHaveCount(0)
  await expect(routes).toContainText(`${solLabel} → ${solLabel}`)
  const edited = await app.client["api.config"].get()
  expect(edited.routing).toEqual([{ match: { model: Chat.model }, to: Chat.model }])

  await action(page, 1, "Remove")
  const confirm = page.getByRole("dialog", { name: "Remove route?" })
  await confirm.getByRole("button", { name: "Remove", exact: true }).click()
  await expect(page.getByRole("status", { name: "No routes", exact: true })).toBeVisible()
  expect((await app.client["api.config"].get()).routing).toEqual([])
})

test("a model route remaps this turn", async ({ page, app }) => {
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/policies`)
  await expect(page.getByRole("heading", { name: "Model routing", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add route", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Add route", exact: true }).click()
  const create = page.getByRole("dialog", { name: "Add route" })
  await choose(page, create, "Requested model", solLabel, "opencode/deepseek-v4-pro")
  await choose(page, create, "Destination model", lunaLabel, "opencode/glm-5.1")
  await create.getByRole("button", { name: "Add route", exact: true }).click()
  await expect(create).toHaveCount(0)

  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/session/${app.data.session.id}`)
  const messages = page.locator('[data-component="message-timeline"]')
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
  await page.getByRole("combobox", { name: "Message", exact: true }).fill(script.prompt)
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  const requests = await Effect.runPromise(app.llm.list())
  expect(requests.length).toBeGreaterThan(0)
  for (const request of requests) expect(request.model).toBe(routed.id)
  await Effect.runPromise(app.llm.verify())
})

mcpTest("adds a discovered MCP completed-tool rule through the ToolPicker", async ({ page, app, upstream }) => {
  const workspace = app.data.owner.properties.workspaceID
  const current = await app.client["api.config"].get()
  const { default_model: _defaultModel, model_policy: _modelPolicy, ...writable } = current
  await app.client["api.config"].update({
    ...writable,
    workspace,
    mcp: {
      ...writable.mcp,
      servers: {
        ...writable.mcp?.servers,
        fixture: { type: "remote", url: upstream.url.href, codemode: false, disabled: true },
      },
    },
  })
  await expect
    .poll(async () => (await app.client.mcp.servers.list({ workspace })).find((server) => server.name === "fixture"))
    .toMatchObject({ name: "fixture", enabled: false, status: "disabled" })

  const enabled = await app.client.mcp.servers.update({ workspace, server: "fixture", enabled: true })
  assert.equal(enabled.status, "needs_auth")
  const attempt = await app.client.integration.oauth.connect({
    integrationID: Integration.ID.make(enabled.integrationID),
    methodID: Integration.MethodID.make("oauth"),
    scope: "member",
  })
  const external = await fetch(attempt.url, { redirect: "manual" })
  assert.equal(external.status, 302)
  const callback = external.headers.get("location")
  assert.ok(callback)
  const callbackURL = new URL(callback)
  const complete = await fetch(new URL(callbackURL.pathname + callbackURL.search, app.origin), { redirect: "manual" })
  assert.equal(complete.status, 303)
  await expect
    .poll(() =>
      app.client.integration.oauth.status({
        integrationID: Integration.ID.make(enabled.integrationID),
        attemptID: attempt.attemptID,
      }),
    )
    .toMatchObject({ status: "complete" })
  await expect
    .poll(async () => (await app.client.mcp.servers.list({ workspace })).find((server) => server.name === "fixture"))
    .toMatchObject({ name: "fixture", enabled: true, status: "connected" })
  expect(upstream.pkceVerified).toBe(true)
  expect(upstream.registrations).toBe(1)

  const toolsResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/mcp/tool" &&
      url.searchParams.get("workspace") === workspace
    )
  })
  await page.goto(`/w/${workspace}/policies`)
  const toolsResponse = await toolsResponsePromise
  expect(toolsResponse.ok()).toBe(true)
  expect(await toolsResponse.json()).toContainEqual(
    expect.objectContaining({
      server: "fixture",
      name: "remote",
      action: "fixture_remote",
      description: "Return the fixture remote value",
    }),
  )
  await expect(page.getByRole("heading", { name: "Model routing", exact: true })).toBeVisible()
  const add = page.getByRole("button", { name: "Add route", exact: true })
  await expect(add).toBeEnabled()
  await add.click()

  const create = page.getByRole("dialog", { name: "Add route" })
  const when = create.getByRole("region", { name: "When", exact: true })
  await when.getByRole("button", { name: "Remove condition: Requested model", exact: true }).click()
  await addCondition(page, create, "After tool")
  const completed = when.getByRole("group", { name: "Tool", exact: true })
  const trigger = completed.getByRole("button")
  await expect(trigger).toBeEnabled()
  await trigger.click()
  const search = page.getByRole("combobox", { name: "Search tools", exact: true })
  await expect(search).toBeFocused()
  await search.fill("remote")
  const listbox = page.getByRole("listbox", { name: "Tool", exact: true })
  await expect(listbox).toBeVisible()
  const fixture = listbox.getByRole("group", { name: "fixture", exact: true })
  const remote = fixture
    .getByRole("option", { name: "remote, fixture/fixture_remote", exact: true })
    .filter({ hasText: "Return the fixture remote value" })
  await expect(remote).toBeVisible()
  await remote.click()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveText("remote (fixture/fixture_remote)")

  await choose(page, create, "Destination model", lunaLabel, "opencode/glm-5.1")
  await create.getByRole("button", { name: "Add route", exact: true }).click()
  await expect(create).toHaveCount(0)
  const routes = page.getByRole("list", { name: "Routes", exact: true })
  await expect(routes).toContainText(`After remote → ${lunaLabel}`)
  expect((await app.client["api.config"].get()).routing).toEqual([{ match: { tool: "fixture_remote" }, to: routed }])
})

test("a persisted completed-tool route remaps the next participant turn, not the current one", async ({ page, app }) => {
  const current = await app.client["api.config"].get()
  const { default_model: _defaultModel, model_policy: _modelPolicy, ...writable } = current
  await app.client["api.config"].update({
    ...writable,
    workspace: app.data.owner.properties.workspaceID,
    routing: [{ when: { tool: "read" }, to: routed }],
  })
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/policies`)
  await expect(page.getByRole("heading", { name: "Model routing", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add route", exact: true })).toBeEnabled()
  await expect(page.getByRole("list", { name: "Routes", exact: true })).toContainText(`After read → ${lunaLabel}`)

  const script = await Effect.runPromise(Chat.script(app, app.data, "read"))
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/session/${app.data.session.id}`)
  const messages = page.locator('[data-component="message-timeline"]')
  const editor = page.getByRole("combobox", { name: "Message", exact: true })
  const send = page.getByRole("button", { name: "Send", exact: true })
  await expect(editor).toBeEditable()
  await editor.fill(script.prompt)
  await Promise.all([Effect.runPromise(app.llm.waitGate(script.gate)), send.click()])
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(messages.getByText(script.answer, { exact: true })).toHaveCount(1)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  const first = (await Effect.runPromise(app.llm.list())).filter((request) => request.purpose === "assistant")
  expect(first.length).toBeGreaterThan(1)
  for (const request of first) expect(request.model).toBe(Chat.model.id)

  const secondPrompt = "What did the file say?"
  const secondAnswer = `It said ${app.data.content}.`
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "assistant", [
      {
        expect: (request) => {
          assert.equal(request.model, routed.id)
          assert.ok(
            request.messages.some(
              (message) => message.role === "user" && JSON.stringify(message.content).includes(secondPrompt),
            ),
          )
        },
        response: { type: "success", events: [{ text: secondAnswer }], usage: { input: 8, output: 4 } },
      },
    ]),
  )
  await editor.fill(secondPrompt)
  await Promise.all([Effect.runPromise(app.llm.settled(app.data.session.id, "assistant", 2)), send.click()])
  await expect(messages.getByText(secondAnswer, { exact: true })).toHaveCount(1)
  await expect.poll(() => app.client.session.active()).toEqual({})
  await Effect.runPromise(app.llm.verify())
})

test("redirects members away from Policies", async ({ page, app }) => {
  const workspaceID = app.data.owner.properties.workspaceID
  await Effect.runPromise(AuthScenario.loginMember(app))
  await page.context().clearCookies()
  await page.goto("/login")
  await expect(page).toHaveURL(new URL(`/w/${workspaceID}`, app.web).href)
  await page.goto(`/w/${workspaceID}/policies`)
  await expect(page).toHaveURL(new URL(`/w/${workspaceID}`, app.web).href)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
})

test("keeps routing controls reachable in a narrow viewport", async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/policies`)
  const add = page.getByRole("button", { name: "Add route", exact: true })
  await expect(add).toBeEnabled()
  await expect
    .poll(() => page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
    .toBe(true)

  await add.focus()
  await page.keyboard.press("Enter")
  const create = page.getByRole("dialog", { name: "Add route" })
  await expect(create).toBeVisible()
  const requested = create
    .getByRole("region", { name: "When", exact: true })
    .getByRole("group", { name: "Model", exact: true })
    .getByRole("button")
  await requested.focus()
  await expect(requested).toBeFocused()
  await requested.press("Enter")
  const requestedListbox = page.getByRole("listbox", { name: "Model", exact: true, includeHidden: true })
  await expect(requestedListbox).toBeInViewport()
  await requestedListbox
    .getByRole("option", { name: solLabel, includeHidden: true })
    .filter({ hasText: "opencode/deepseek-v4-pro" })
    .click()
  await expect(requested).toContainText(solLabel)
  await choose(page, create, "Destination model", lunaLabel, "opencode/glm-5.1")
  await expect(create.getByRole("button", { name: "Add route", exact: true })).toBeInViewport()
  await create.getByRole("button", { name: "Add route", exact: true }).click()
  await expect(create).toHaveCount(0)

  const routes = page.getByRole("list", { name: "Routes", exact: true })
  await expect(routes).toBeVisible()
  await expect(page.getByRole("list", { name: "Routes", exact: true })).toBeVisible()
  const actions = page.getByRole("button", { name: "Actions for routing rule 1", exact: true })
  await actions.scrollIntoViewIfNeeded()
  await expect(actions).toBeInViewport()
  await actions.focus()
  await page.keyboard.press("Enter")
  const editItem = page.getByRole("menuitem", { name: "Edit", exact: true })
  await expect(editItem).toBeFocused()
  await expect(editItem).toBeInViewport()
  await page.keyboard.press("Enter")
  const edit = page.getByRole("dialog", { name: "Edit route" })
  await expect(edit).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(edit).toHaveCount(0)
  await expect(actions).toBeFocused()
  await expect
    .poll(() => page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
    .toBe(true)
})

test("keeps a rule with every condition inside the viewport", async ({ page, app }) => {
  await page.setViewportSize({ width: 1280, height: 640 })
  await page.goto(`/w/${app.data.owner.properties.workspaceID}/policies`)
  const add = page.getByRole("button", { name: "Add route", exact: true })
  await expect(add).toBeEnabled()
  await add.click()
  const create = page.getByRole("dialog", { name: "Add route" })
  for (const condition of [
    "Request type",
    "Message matches",
    "Context size",
    "Images",
    "Agent",
    "After tool",
  ])
    await addCondition(page, create, condition)
  await expect(create.getByRole("group", { name: "Add condition", exact: true })).toHaveCount(0)
  const box = await create.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(640)
  await expect(create.getByRole("button", { name: "Add route", exact: true })).toBeInViewport()
})

test("creates an Auto model on its own page", async ({ page, app }) => {
  const workspaceID = app.data.owner.properties.workspaceID
  await page.goto(`/w/${workspaceID}/policies`)
  await page.getByRole("link", { name: "New Auto model", exact: true }).click()
  await expect(page).toHaveURL(new URL(`/w/${workspaceID}/policies/auto`, app.web).href)
  await expect(page.getByRole("button", { name: "Routing", exact: true })).toHaveAttribute("aria-current", "page")
  await page.getByRole("textbox", { name: "Auto model name", exact: true }).fill("general")
  const tiers = page.getByRole("region", { name: "Tiers", exact: true })
  for (const [index, label, description, text] of [
    [1, solLabel, "opencode/deepseek-v4-pro", "Short factual questions"],
    [2, lunaLabel, "opencode/glm-5.1", "Multi-step work"],
  ] as const) {
    const tier = tiers.getByRole("group", { name: `Tier ${index}`, exact: true })
    const trigger = tier.getByRole("group", { name: `Tier ${index} model`, exact: true }).getByRole("button")
    await trigger.click()
    await page.getByRole("listbox", { name: `Tier ${index} model`, exact: true, includeHidden: true })
      .getByRole("option", { name: label, includeHidden: true }).filter({ hasText: description }).click()
    await expect(trigger).toContainText(label)
    await tier.getByRole("textbox", { name: `Tier ${index} description`, exact: true }).fill(text)
  }
  const judge = page.getByRole("region", { name: "Judge", exact: true })
  const judgeTrigger = judge.getByRole("group", { name: "Judge model", exact: true }).getByRole("button")
  await judgeTrigger.click()
  await page.getByRole("listbox", { name: "Judge model", exact: true, includeHidden: true })
    .getByRole("option", { name: solLabel, includeHidden: true }).filter({ hasText: "opencode/deepseek-v4-pro" }).click()
  await page.getByRole("button", { name: "Create Auto model", exact: true }).click()
  await expect(page).toHaveURL(new URL(`/w/${workspaceID}/policies/auto/general`, app.web).href)
  await expect(page.getByRole("heading", { name: "auto/general", exact: true })).toBeVisible()
  expect((await app.client["api.config"].get()).routing).toEqual([{
    match: { model: { provider: "auto", id: "general" } },
    to: {
      tiers: [
        { name: "fast", model: Chat.model, description: "Short factual questions" },
        { name: "capable", model: routed, description: "Multi-step work" },
      ],
      default: "fast",
      judge: { model: Chat.model },
    },
  }])
  await page.getByRole("region", { name: "auto/general page", exact: true }).getByRole("link", { name: "Model routing", exact: true }).click()
  await expect(page.getByRole("list", { name: "Auto models", exact: true })).toContainText("auto/general")
})
