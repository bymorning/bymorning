import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test as base } from "../fixtures/app.js"

const artifacts = "/tmp/opencode/ux-probes"
const wait = { timeout: 120_000 } as const

const test = base.extend({
  page: async ({ context, app }, use) => {
    void app
    const page = await context.newPage()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 400,
      downloadThroughput: 100 * 1024,
      uploadThroughput: 50 * 1024,
    })
    await use(page)
    expect(errors).toEqual([])
  },
})

test.use({ video: "on", screenshot: "on", trace: "off" })
test.setTimeout(360_000)

test("first-user local login to Overview under slow 3G", async ({ page, app }) => {
  mkdirSync(artifacts, { recursive: true })
  const started = Date.now()
  const timings: Record<string, number> = {}
  const urls: string[] = []
  const failedRequests: string[] = []
  const pageErrors: string[] = []
  const findings: Record<string, unknown> = { expectedWorkspaceID: app.data.owner.properties.workspaceID }
  const mark = (name: string) => {
    timings[name] = Date.now() - started
  }
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`)
  })

  const shot = async (name: string) => {
    const path = `${artifacts}/${name}.png`
    await page.screenshot({ path, fullPage: true })
    return path
  }
  const observe = async (label: string) => {
    const url = page.url()
    const pathname = new URL(url).pathname
    const bodyText = (await page.locator("body").innerText()).trim()
    const headings = await page.getByRole("heading").allTextContents()
    const statuses = await page.getByRole("status").allTextContents()
    const alerts = await page.getByRole("alert").allTextContents()
    const loginCard = await page.locator('[data-slot="card-page-card"]').count()
    const overview = await page.getByRole("heading", { name: "Overview", exact: true }).count()
    const spinner = await page.getByRole("status").count()
    const blank = bodyText.length === 0 && headings.length === 0 && loginCard === 0 && overview === 0 && spinner === 0
    const snapshot = {
      label,
      url,
      pathname,
      bodyText,
      headings,
      statuses,
      alerts,
      loginCard,
      overview,
      spinner,
      blank,
      title: await page.title(),
      elapsedMs: Date.now() - started,
    }
    console.log(`PROBE ${label}`, JSON.stringify(snapshot))
    return snapshot
  }

  try {
    await page.goto("/login", { waitUntil: "commit", timeout: 90_000 })
    mark("loginCommit")
    findings.commit = await observe("login-commit")
    await shot("boot-00-login-commit")

    const continuing = page.getByRole("status", { name: "Loading sign-in options…" })
    findings.loginCommitStatus = await continuing.isVisible().catch(() => false)
    findings.loginCard = await observe("login-auto-continue")
    await shot("boot-01-login-auto-continue")

    await page.waitForURL((url) => {
      const pathname = new URL(url).pathname
      return pathname === "/" || pathname.startsWith("/w/")
    }, wait)
    const afterAuth = await observe("blank-or-redirect")
    findings.blankOrRedirect = afterAuth
    await shot("boot-04-blank-or-redirect")
    if (new URL(page.url()).pathname === "/") {
      mark("landedOnRoot")
      await page.waitForURL((url) => new URL(url).pathname.startsWith("/w/"), wait)
    }
    mark("workspaceURL")
    findings.workspaceURL = page.url()

    const sessions = page.getByRole("navigation", { name: "Sessions", exact: true })
    await expect(sessions).toBeVisible(wait)
    mark("sessionsNav")
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible(wait)
    const loadingSessions = sessions.getByRole("status", { name: "Loading sessions..." })
    const loadingProjects = page.getByRole("status", { name: "Loading projects" })
    const headerNewSession = page.getByRole("button", { name: "New session", exact: true })
    const sidebarNewSession = page.getByRole("button", { name: "New Session", exact: true })
    await expect(headerNewSession).toBeVisible(wait)
    const overviewLoading = {
      loadingSessions: await loadingSessions.isVisible(),
      loadingProjects: await loadingProjects.isVisible(),
      headerNewSessionDisabled: await headerNewSession.isDisabled(),
      sidebarNewSessionDisabled: await sidebarNewSession.isDisabled(),
      headerTitle: await headerNewSession.getAttribute("title"),
      headerAriaDescription: await headerNewSession.getAttribute("aria-description"),
      sidebarTitle: await sidebarNewSession.getAttribute("title"),
      explanation: (await page.getByText(/bootstrap|not ready|unavailable/i).allTextContents()).filter(Boolean),
    }
    findings.overviewLoading = { ...(await observe("overview-loading")), ...overviewLoading }
    await shot("boot-05-overview-loading")

    if (overviewLoading.headerNewSessionDisabled) {
      await expect(headerNewSession).toBeEnabled(wait)
    }
    mark("newSessionEnabled")
    await expect(loadingSessions).toHaveCount(0, wait)
    await expect(sessions).not.toHaveAttribute("aria-busy", "true")
    mark("sessionListReady")
    findings.overviewReady = await observe("overview-ready")
    findings.overviewReadyCopy = {
      description: await page.getByText("Find and continue sessions across this workspace.", { exact: true }).count(),
      loadingSessions: await loadingSessions.count(),
      loadingProjects: await loadingProjects.count(),
      headerNewSessionDisabled: await headerNewSession.isDisabled(),
      sidebarNewSessionDisabled: await sidebarNewSession.isDisabled(),
      sessionRows: await sessions.locator('[data-component="session-list-row"]').count(),
      empty: await page.getByText("Nothing here yet", { exact: true }).count(),
    }
    await shot("boot-06-overview-ready")
  } finally {
    findings.timingsMs = timings
    findings.navigatedURLs = urls
    findings.pageErrors = pageErrors
    findings.failedRequests = failedRequests.slice(0, 50)
    findings.finalURL = page.url()
    writeFileSync(`${artifacts}/boot-findings.json`, `${JSON.stringify(findings, null, 2)}\n`)
    console.log("PROBE FINDINGS", JSON.stringify(findings, null, 2))
    await shot("boot-99-final").catch(() => undefined)
  }
})
