import { Effect } from "effect"
import { expect, type ConsoleMessage } from "@playwright/test"
import { Chat } from "@bymorning/testing/scenario/chat"
import { makeTest } from "../fixtures/app.js"

const test = makeTest(Chat.make)

/** Collect console errors that report a Content Security Policy violation. */
const cspViolations = (messages: ConsoleMessage[]) =>
  messages
    .filter((message) => message.type() === "error")
    .map((message) => message.text())
    .filter((text) => text.includes("Content Security Policy"))

const answer = [
  "Rendering **markdown** with `inline code`, math \\( E = mc^2 \\), a diagram, and a block:",
  "",
  "```ts",
  "const answer: number = 42",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  client[Client] --> server[Server]",
  "```",
].join("\n")

test.describe("production security headers in the real UI", () => {
  test.use({ csp: true })

  test("[SEC-HDR-05] the strict CSP admits the full markdown, code, and mermaid rendering path", async ({
    page,
    app,
  }) => {
    const messages: ConsoleMessage[] = []
    const pageErrors: string[] = []
    page.on("console", (message) => messages.push(message))
    page.on("pageerror", (error) => pageErrors.push(error.message))

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* app.llm.expect(app.data.session.id, "title", [
          { expect: () => {}, response: { type: "success", events: [{ text: "Rendering probe" }] } },
        ])
        yield* app.llm.expect(app.data.session.id, "assistant", [
          { expect: () => {}, response: { type: "success", events: [{ text: answer }] } },
        ])
      }),
    )

    const document = await page.goto("/login")
    // The document response carries the production policy even under the dev server.
    expect(document?.headers()["content-security-policy"]).toContain("default-src 'self'")
    await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
    await page.goto(`/w/${app.data.owner.properties.workspaceID}/session/${app.data.session.id}`)
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
    await expect(page.locator('[data-component="session-workspace"]')).toHaveAttribute("data-session-sync", "ready")
    await expect(page.locator('[data-component="session-workspace"]')).toHaveAttribute("data-transcript-state", "ready")

    await page.getByRole("combobox", { name: "Message", exact: true }).fill("Render the probe")
    await page.getByRole("button", { name: "Send", exact: true }).click()

    const timeline = page.locator('[data-component="message-timeline"]')
    // KaTeX, Shiki highlighting in the module Worker (wasm), and Mermaid all render under the policy.
    await expect(timeline.locator(".katex").first()).toBeVisible()
    await expect(timeline.locator("code.language-ts")).toBeVisible()
    const diagram = timeline.locator('[data-component="markdown-mermaid"]')
    await expect(diagram.locator("svg")).toBeVisible()
    await expect.poll(() => app.client.session.active()).toEqual({})
    await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))

    expect(cspViolations(messages)).toEqual([])
    expect(pageErrors).toEqual([])
  })
})

test.describe("system use notification", () => {
  const banner = "This system is for authorized use only. Activity may be monitored and reported."
  test.use({ appOptions: { banner } })

  test("[SEC-BANNER-01] the sign-in page shows the banner and gates the IdP redirect on acknowledgment", async ({
    page,
    app,
  }) => {
    await page.goto("/login")
    // The local-login shortcut never bypasses a configured notice.
    await expect(page.getByRole("region", { name: "System use notification" })).toContainText(banner)
    await expect(page.getByRole("link", { name: "Continue locally", exact: true })).toHaveCount(0)

    // Kobalte renders the real input visually hidden; the label toggles it.
    await page.getByText("I have read and acknowledge this notice.", { exact: true }).click()
    await expect(page.getByRole("checkbox", { name: "I have read and acknowledge this notice." })).toBeChecked()
    await page.getByRole("link", { name: "Continue locally", exact: true }).click()
    await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
  })
})
