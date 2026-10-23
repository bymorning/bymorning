import { FormScenario } from "@bymorning/testing/scenario/form"
import { TestHTTP } from "@bymorning/testing/http"
import { ToolScenario } from "@bymorning/testing/scenario/tool"
import { Effect, Exit, Scope } from "effect"
import { expect, test as base } from "./fixture.js"

const content = "permission-gated HTTP result"
const test = base.extend<{ readonly http: Effect.Success<ReturnType<typeof TestHTTP.make>> }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  http: async ({}, use) => {
    const scope = Effect.runSync(Scope.make())
    try {
      const http = await Effect.runPromise(
        TestHTTP.make((_request, response) => {
          response.writeHead(200, { "content-type": "text/plain" })
          response.end(content)
        }).pipe(Scope.provide(scope)),
      )
      await use(http)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  },
  appOptions: async ({ http }, use) => use({ plugins: [ToolScenario.plugin(http.origin)] }),
  // eslint-disable-next-line no-empty-pattern -- This fixture has no dependencies.
  scenario: async ({}, use) => use(ToolScenario.make),
})

test("keeps an invalid real Form answer correctable and settles it through the public client", async ({
  page,
  app,
}) => {
  await Effect.runPromise(FormScenario.create(app, app.data))
  const form = page.getByRole("form", { name: "Fixture details", exact: true })
  await expect(form).toBeVisible()
  await form.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(form.getByRole("alert")).toBeVisible()
  await form.getByRole("textbox", { name: "Answer", exact: true }).fill("yes")
  await form.getByRole("textbox", { name: "More", exact: true }).fill("details")
  await form.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(form).toHaveCount(0)
})

test("submits a real integer Form answer as a number", async ({ page, app }) => {
  await Effect.runPromise(FormScenario.createInteger(app, app.data))
  const form = page.getByRole("form", { name: "Fixture count", exact: true })
  await expect(form).toBeVisible()
  await form.getByRole("spinbutton", { name: "Count", exact: true }).fill("3")
  await form.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(form).toHaveCount(0)
})

test("answers a real pending Permission and continues the Tool conversation", async ({ page, app, http }) => {
  const config = await app.client["api.config"].get()
  await app.client["api.config"].update({
    ...config,
    permissions: [
      { action: "execute", resource: "*", effect: "allow" },
      { action: "fixture.http", resource: "*", effect: "ask" },
    ],
  })
  const script = await Effect.runPromise(ToolScenario.script(app, app.data, content))
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(script.prompt)
  await page.getByRole("button", { name: "Send", exact: true }).click()
  const permission = page.getByRole("region", { name: "Permission required", exact: true })
  await expect(permission).toBeVisible()
  await expect(permission).toContainText("fixture.http")
  await expect(permission).toContainText(http.origin.href.replace(/\/$/, ""))
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(script.gate)),
    permission.getByRole("button", { name: "Once", exact: true }).click(),
  ])
  await expect(permission).toHaveCount(0)
  expect(http.requests()).toHaveLength(1)
  await Effect.runPromise(app.llm.release(script.gate))
  await expect(page.getByText(script.answer, { exact: true })).toHaveCount(1)
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
