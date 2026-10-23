import { Effect } from "effect"
import { expect } from "@playwright/test"
import { makeTest } from "../fixtures/app.js"

/**
 * Login Session idle lock (NIST 3.1.10): after the installation's configured
 * inactivity limit the app hides its content behind a pattern-hiding lock
 * overlay, and signing in again restores the workspace.
 */
const test = makeTest((app) => Effect.map(app.login(), (owner) => ({ owner })))

test.describe("inactivity lock", () => {
  test.describe.configure({ timeout: 180_000 })
  // The browser's idle timer runs on the page clock below; the server's idle
  // bound runs in real time from login (activity touches are throttled to one
  // per minute). A real-time limit far beyond page load keeps the server from
  // refusing the session first, which would show "expired" instead of "locked".
  test.use({ appOptions: { config: { SESSION_IDLE_TIMEOUT: "2 minutes" } } })

  test("[SEC-SESS-11] the display locks after the idle timeout, hides content, and signs in again", async ({
    page,
    app,
  }) => {
    await page.clock.install()
    await page.goto("/")
    await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
    await expect(page.getByRole("navigation", { name: "Workspace navigation", exact: true })).toBeVisible()

    // No user activity from here on. Halfway through the limit the display is still live.
    const gate = page.locator('[data-component="session-gate"][data-reason="locked"]')
    await page.clock.fastForward("01:00")
    await expect(page.locator('[data-component="session-gate"]')).toHaveCount(0)

    // Past the limit the inactivity lock engages and ends the Login Session.
    const logout = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/auth/logout",
    )
    await page.clock.fastForward("01:01")
    await expect(gate).toBeVisible()
    await expect(gate.getByRole("heading", { name: "Session locked", exact: true })).toBeVisible()
    await expect(gate.getByRole("link", { name: "Sign in again", exact: true })).toBeVisible()
    // Pattern-hiding: the application beneath is inert behind the opaque overlay.
    await expect(page.locator('[data-component="session-gate-content"]')).toHaveJSProperty("inert", true)
    expect((await logout).ok()).toBe(true)

    // The server agrees the session ended: a fresh request with the same jar is refused.
    const status = await page.evaluate(async () => (await fetch("/api/account", { credentials: "include" })).status)
    expect(status).toBe(401)

    await gate.getByRole("link", { name: "Sign in again", exact: true }).click()
    await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
    await expect(page.getByRole("navigation", { name: "Workspace navigation", exact: true })).toBeVisible()
  })
})
test.describe("server-side revocation", () => {
  test.describe.configure({ timeout: 180_000 })

  test("[SEC-SESS-12] a server-side revocation replaces the app with the session-expired screen", async ({
    page,
    app,
  }) => {
    await page.goto("/")
    await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
    await expect(page.getByRole("navigation", { name: "Workspace navigation", exact: true })).toBeVisible()

    // Open "Login sessions" while the session is live and hold its list request
    // in the network layer. Every interaction then precedes the revocation, so a
    // late background read refused first cannot cover the controls with the gate.
    const list = (url: URL) => url.pathname === "/api/account/sessions"
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(list, async (route) => {
      await released
      await route.continue()
    })
    const held = page.waitForRequest((request) => request.method() === "GET" && list(new URL(request.url())))
    const refused = page.waitForResponse(
      (response) => response.request().method() === "GET" && list(new URL(response.url())),
    )
    await page.getByRole("button", { name: "Open account menu", exact: true }).click()
    await page.getByRole("menuitem", { name: "Login sessions", exact: true }).click()
    await held

    // The fixture SDK client is a second session of the same Account; revoking
    // the browser's session through the public API is the server-side action.
    const sessions = await app.client.account.session.list()
    const browser = sessions.filter((session) => !session.current)
    expect(browser).toHaveLength(1)
    await app.client.account.session.revoke({ sessionID: browser[0]!.id })

    // The held request reaches the server unchanged; it is refused and ends the display.
    release()
    expect((await refused).status()).toBe(401)
    const gate = page.locator('[data-component="session-gate"][data-reason="expired"]')
    await expect(gate).toBeVisible()
    await expect(gate.getByRole("heading", { name: "Session expired", exact: true })).toBeVisible()
    await expect(page.locator('[data-component="session-gate-content"]')).toHaveJSProperty("inert", true)
  })
})
