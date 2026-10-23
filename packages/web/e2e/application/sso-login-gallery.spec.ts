import { AuthScenario } from "@bymorning/testing/scenario/auth"
import { Effect } from "effect"
import { copyFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { start } from "../../../server/test/oidc-idp.js"
import { expect, makeTest } from "../fixtures/app.js"

const test = makeTest(AuthScenario.loginLocal)

const gallery = "/tmp/opencode/sso-gallery-2026-09-14/screenshots"

test.setTimeout(240_000)
test.use({ trace: "off", screenshot: "off" })

test("SSO sign-in gallery", async ({ app, browser }, testInfo) => {
  testInfo.setTimeout(240_000)
  const fixture = await start()
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    const microsoft = await Effect.runPromise(
      AuthScenario.createProvider(app, {
        fixture,
        displayName: "Contoso Microsoft",
        kind: "microsoft",
        domains: ["bymorning.ai"],
      }),
    )
    await Effect.runPromise(
      AuthScenario.createProvider(app, {
        fixture,
        displayName: "Contoso Okta",
        kind: "okta",
        domains: ["bymorning.ai"],
      }),
    )
    const disabled = await Effect.runPromise(
      AuthScenario.createProvider(app, {
        fixture,
        displayName: "Retired Contoso Ping",
        kind: "ping",
        domains: ["bymorning.ai"],
      }),
    )
    await app.client["api.auth-provider"].authProvider.update({
      providerID: disabled.id,
      id: disabled.id,
      revision: disabled.revision,
      displayName: disabled.displayName,
      kind: disabled.kind,
      domains: disabled.domains,
      status: "disabled",
    })

    const browserProfile = {
      baseURL: app.web.href,
      viewport: { width: 1440, height: 900 },
      colorScheme: "light" as const,
      reducedMotion: "reduce" as const,
      locale: "en-US",
      timezoneId: "UTC",
    }
    context = await browser.newContext(browserProfile)
    await context.addInitScript(() => {
      localStorage.setItem("bymorning-theme-id", "ink")
      localStorage.setItem("bymorning-color-scheme", "light")
    })
    let page = await context.newPage()
    const errors: string[] = []
    const artifacts: Array<{ readonly name: string; readonly path: string }> = []
    page.on("pageerror", (error) => errors.push(error.message))

    const capture = async (name: string) => {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "ink")
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
      await page.evaluate("document.fonts.ready")
      const artifact = testInfo.outputPath(name)
      await page.screenshot({ path: artifact, animations: "disabled", caret: "hide" })
      artifacts.push({ name, path: artifact })
    }

    await page.goto("/login?auth=failed")
    await expect(page.getByRole("link", { name: "Continue with Contoso Microsoft", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Continue with Contoso Okta", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Continue locally", exact: true })).toBeVisible()
    await expect(page.getByText("Retired Contoso Ping", { exact: true })).toHaveCount(0)
    await capture("20-provider-chooser.png")

    await page.getByRole("link", { name: "Continue with Contoso Microsoft", exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp(`^${fixture.issuer.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}authorize\\?`),
    )
    const denied = await fixture.authorize(new URL(page.url()), {
      sub: "contoso-unverified",
      email: "unverified@bymorning.ai",
      extra: { email_verified: false },
    })
    await page.goto(denied.redirect.href)
    // email_verified: false is a claims failure; the redirect carries only the reason code.
    await expect(page).toHaveURL(new URL("/login?auth=failed&reason=claims", app.web).href)
    const alert = page.getByRole("alert")
    await expect(alert).toContainText("That sign-in attempt failed. Choose a provider below to try again.")
    await expect(alert).toContainText("Your identity provider did not send a verified email address.")
    await expect(alert).not.toContainText("unverified@bymorning.ai")
    await expect(page.getByRole("link", { name: "Continue with Contoso Microsoft", exact: true })).toBeVisible()
    await capture("21-real-oidc-failure.png")

    const accepted = await Effect.runPromise(
      AuthScenario.loginOidc(app, fixture, microsoft.id, {
        sub: "contoso-alex",
        email: "alex@bymorning.ai",
        extra: { email_verified: true },
      }),
    )
    expect(accepted.account.email).toBe("alex@bymorning.ai")
    await context.addCookies(
      accepted.cookie.split("; ").map((pair) => {
        const separator = pair.indexOf("=")
        return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: app.web.href }
      }),
    )
    await page.goto("/")
    await expect(page).toHaveURL(/\/w\/wrk_[a-z0-9]+$/i)
    // A Workspace with no Session yet shows Overview without a Sessions list.
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
    const account = page.getByRole("button", { name: "Open account menu", exact: true })
    await expect(account.getByText("alex@bymorning.ai", { exact: true })).toBeVisible()
    await account.click()
    await expect(page.getByRole("menu").getByText("alex@bymorning.ai", { exact: true })).toBeVisible()
    await capture("22-real-oidc-signed-in.png")

    expect(errors).toEqual([])
    await mkdir(gallery, { recursive: true })
    await Promise.all(artifacts.map((artifact) => copyFile(artifact.path, join(gallery, artifact.name))))
  } finally {
    await context?.close()
    await fixture.close()
  }
})
