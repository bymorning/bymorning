import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import type { Locator, Page } from "@playwright/test"
import { expect, test as base } from "../fixtures/app.js"

const artifacts = "/tmp/opencode/ux-probes"

const test = base.extend({
  page: async ({ context, app }, use) => {
    await mkdir(artifacts, { recursive: true })
    const page = await context.newPage()
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto("/login")
    await expect(page).toHaveURL(new URL(`/w/${app.data.owner.properties.workspaceID}`, app.web).href)
    await expect(page.getByRole("navigation", { name: "Sessions", exact: true })).toBeVisible()
    await page.evaluate(`Promise.all([import("/src/session/route.tsx"), import("/src/new-session/route.tsx")])`)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 400,
      downloadThroughput: 100 * 1024,
      uploadThroughput: 50 * 1024,
      connectionType: "cellular3g",
    })
    await use(page)
    await note("pageerrors", errors)
    const video = page.video()
    await page.close()
    if (video) {
      const path = await video.path().catch(() => undefined)
      if (path) {
        const dest = existsSync(`${artifacts}/session-open.webm`)
          ? `${artifacts}/session-new.webm`
          : `${artifacts}/session-open.webm`
        await copyFile(path, dest).catch(() => undefined)
      }
    }
  },
})
test.use({ video: "on", screenshot: "on" })
test.setTimeout(180_000)

type Snapshot = {
  readonly url: string
  readonly h1: string[]
  readonly statuses: ReadonlyArray<{ name: string | null; slot: string | null; text: string }>
  readonly alerts: string[]
  readonly loading: ReadonlyArray<{ component: string | null; slot: string | null; text: string }>
  readonly sessionLoading: string
  readonly timeline: { present: boolean; dataLoading: boolean; text: string }
  readonly workspace: { sync: string | null; transcript: string | null; composer: string }
  readonly send: { label: string | null; disabled: boolean } | null
  readonly placeholder: string | null
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(`(() => {
    const text = (el) => (el instanceof HTMLElement ? el.innerText.trim() : "")
    const editor = document.querySelector('[data-slot="session-composer-editor"]')
    const send = document.querySelector('[data-slot="session-composer-submit"]')
    return {
      url: location.pathname + location.search,
      h1: [...document.querySelectorAll("h1")].map((el) => text(el)),
      statuses: [...document.querySelectorAll('[role="status"]')].map((el) => ({
        name: el.getAttribute("aria-label"),
        slot: el.getAttribute("data-slot"),
        text: text(el),
      })),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((el) => text(el)),
      loading: [...document.querySelectorAll("[data-loading]")].map((el) => ({
        component: el.getAttribute("data-component"),
        slot: el.getAttribute("data-slot"),
        text: text(el),
      })),
      sessionLoading: text(document.querySelector('[data-slot="session-loading"]')),
      timeline: {
        present: !!document.querySelector('[data-component="session-timeline"]'),
        dataLoading: !!document.querySelector('[data-component="message-timeline"][data-loading]'),
        text: text(document.querySelector('[data-component="message-timeline"]')),
      },
      workspace: {
        sync: document.querySelector('[data-component="session-workspace"]')?.getAttribute("data-session-sync") ?? null,
        transcript:
          document.querySelector('[data-component="session-workspace"]')?.getAttribute("data-transcript-state") ?? null,
        composer: text(document.querySelector('[data-slot="session-workspace-composer"]')),
      },
      send: send instanceof HTMLButtonElement ? { label: send.getAttribute("aria-label"), disabled: send.disabled } : null,
      placeholder: editor ? editor.getAttribute("data-placeholder") : null,
    }
  })()`) as Promise<Snapshot>
}

async function note(label: string, value: unknown) {
  console.log(`PROBE ${label} ${JSON.stringify(value, null, 2)}`)
}

async function watchPhase(
  page: Page,
  started: number,
  ready: Promise<void>,
  name: string,
  locator: Locator,
  file: string,
) {
  const appeared = locator.waitFor({ state: "visible" }).then(
    () => true as const,
    () => false as const,
  )
  const hit = await Promise.race([appeared, ready.then(() => false as const)])
  if (!hit) {
    await note(name, { seen: false, ms: Date.now() - started })
    return { name, seen: false, ms: Date.now() - started }
  }
  const ms = Date.now() - started
  const copy = (await locator.innerText().catch(() => "")).trim()
  const state = await snapshot(page)
  await page.screenshot({ path: `${artifacts}/${file}`, fullPage: true })
  await note(name, { seen: true, ms, copy, state })
  return { name, seen: true, ms, copy, state }
}

test("open existing session from Overview under slow network", async ({ page, app }, testInfo) => {
  const workspaceID = app.data.owner.properties.workspaceID
  const href = `/w/${workspaceID}/session/${app.data.session.id}`
  const sessions = page.getByRole("navigation", { name: "Sessions", exact: true })
  const row = sessions.locator(`[data-component="session-list-row"][href="${href}"]`)
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  await expect(row).toBeVisible()

  const rowCopy = (await row.innerText()).trim()
  await page.screenshot({ path: `${artifacts}/session-01-overview.png`, fullPage: true })
  await note("overview", { url: page.url(), rowCopy, state: await snapshot(page) })

  const spinner = page.locator('[data-slot="session-loading"]')
  const timelineLoading = page.locator('[data-component="message-timeline"][data-loading]')
  const loadingPrompt = page.getByRole("status", { name: "Loading prompt...", exact: true })
  const composer = page.getByRole("combobox", { name: "Message", exact: true })

  const started = Date.now()
  const ready = Promise.withResolvers<void>()
  const phases = Promise.all([
    watchPhase(page, started, ready.promise, "spinner", spinner, "session-01-spinner.png"),
    watchPhase(page, started, ready.promise, "timeline-loading", timelineLoading, "session-01-timeline-loading.png"),
    watchPhase(page, started, ready.promise, "loading-prompt", loadingPrompt, "session-01-loading-prompt.png"),
  ])

  await row.click()

  const settled = page
    .locator('[data-component="session-workspace"][data-session-sync="ready"][data-transcript-state="ready"]')
    .waitFor({ state: "attached", timeout: 60_000 })
    .then(async () => {
      await expect(composer).toBeEditable({ timeout: 60_000 })
      return true as const
    })
    .catch(() => false as const)

  const becameReady = await settled
  const readyMs = Date.now() - started
  const readyState = await snapshot(page)
  await page.screenshot({
    path: `${artifacts}/${becameReady ? "session-01-ready.png" : "session-01-hung.png"}`,
    fullPage: true,
  })
  ready.resolve()
  const observed = await phases
  const spinnerPhase = observed.find((phase) => phase.name === "spinner")
  const observations = {
    test: "open-existing",
    rowCopy,
    href,
    becameReady,
    readyMs,
    spinnerToReadyMs:
      becameReady && spinnerPhase?.seen && spinnerPhase.ms !== undefined ? readyMs - spinnerPhase.ms : undefined,
    observed,
    ready: readyState,
  }
  await note("open-existing-ready", observations)
  await writeFile(`${artifacts}/session-01-observations.json`, `${JSON.stringify(observations, null, 2)}\n`)
  await testInfo.attach("open-existing", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  })
})

test("new session from Overview under slow network", async ({ page, app }, testInfo) => {
  const workspaceID = app.data.owner.properties.workspaceID
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  const create = page
    .locator('[data-slot="home-layout-actions"]')
    .getByRole("button", { name: "New session", exact: true })
  await expect(create).toBeVisible()
  const header = page.locator('[data-slot="home-layout-header"]')
  const headerCopy = (await header.innerText()).trim()
  await page.screenshot({ path: `${artifacts}/session-01-new-overview.png`, fullPage: true })

  const enabled = await create.waitFor({ state: "visible" }).then(
    async () => {
      await expect(create).toBeEnabled({ timeout: 60_000 })
      return true
    },
    () => false,
  ).catch(() => false)
  const disabled = !enabled || (await create.isDisabled())
  await note("new-session-button", { disabled, headerCopy, state: await snapshot(page) })

  if (disabled) {
    await page.screenshot({ path: `${artifacts}/session-01-new-disabled.png`, fullPage: true })
    const nearby = {
      headerCopy,
      actions: (await page.locator('[data-slot="home-layout-actions"]').innerText()).trim(),
      description: (await page.locator('[data-slot="home-layout-heading"]').innerText()).trim(),
    }
    await note("new-session-disabled", nearby)
    await writeFile(`${artifacts}/session-02-disabled.json`, `${JSON.stringify(nearby, null, 2)}\n`)
  } else {
    const loadingPrompt = page.getByRole("status", { name: "Loading prompt...", exact: true })
    const composer = page.getByRole("combobox", { name: "Message", exact: true })
    const send = page.getByRole("button", { name: "Send", exact: true })
    const picker = page.getByRole("button", { name: "Project", exact: true })
    const started = Date.now()
    const ready = Promise.withResolvers<void>()
    const phases = Promise.all([
      watchPhase(page, started, ready.promise, "new-loading-prompt", loadingPrompt, "session-01-new-loading-prompt.png"),
    ])

    await create.click()
    const draftUrl = await page.waitForURL(/\/new-session\?draftId=/, { timeout: 60_000 }).then(
      () => page.url(),
      () => page.url(),
    )
    const becameReady = await composer.waitFor({ state: "visible", timeout: 60_000 }).then(
      async () => {
        await expect(composer).toBeEditable()
        return true
      },
      () => false,
    )
    const readyMs = Date.now() - started
    const readyState = await snapshot(page)
    const sendDisabled = becameReady ? await send.isDisabled() : null
    const pickerCopy = becameReady ? (await picker.innerText().catch(() => "")).trim() : ""
    await page.screenshot({
      path: `${artifacts}/${becameReady ? "session-01-new-ready.png" : "session-01-new-hung.png"}`,
      fullPage: true,
    })
    ready.resolve()
    const observed = await phases
    const observations = {
      test: "new-session",
      draftUrl,
      becameReady,
      readyMs,
      sendDisabled,
      pickerCopy,
      placeholder: readyState.placeholder,
      observed,
      ready: readyState,
    }
    await note("new-session-ready", observations)
    await writeFile(`${artifacts}/session-02-observations.json`, `${JSON.stringify(observations, null, 2)}\n`)
    await testInfo.attach("new-session", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    })
  }

  await page.goto(`/w/${workspaceID}/new-session`)
  const missingHeading = page.getByRole("heading", { name: "Overview", exact: true })
  const missing = await missingHeading.waitFor({ state: "visible", timeout: 60_000 }).then(
    () => true,
    () => false,
  )
  await page.screenshot({ path: `${artifacts}/session-01-missing-draft.png`, fullPage: true })
  await note("missing-draft", { redirected: missing, url: page.url(), state: await snapshot(page) })

  await page.goto(`/w/${workspaceID}/new-session?draftId=missing-draft`)
  const unknown = await missingHeading.waitFor({ state: "visible", timeout: 60_000 }).then(
    () => true,
    () => false,
  )
  await page.screenshot({ path: `${artifacts}/session-01-unknown-draft.png`, fullPage: true })
  await note("unknown-draft", { redirected: unknown, url: page.url(), state: await snapshot(page) })
})
