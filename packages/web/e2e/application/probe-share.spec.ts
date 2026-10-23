import { ShareScenario } from "@bymorning/testing/scenario/share"
import { Effect } from "effect"
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { Page } from "@playwright/test"
import { expect, test as base } from "../fixtures/app.js"

const artifacts = "/tmp/opencode/ux-probes"
const unknownToken = "00000000-0000-4000-8000-000000000000"

const test = base.extend({
  appOptions: async ({}, use) => use({ plugins: ["@bymorning/plugin-share"] }),
})
/**
 * Cold-load probe: records screenshots, video, and phase timings for the public Share page under
 * emulated 3G into /tmp/opencode/ux-probes; the timings are reported, not asserted. Against the
 * unbundled Vite dev server the first cold load alone transfers ~600 modules and takes about three
 * minutes, so it cannot run within a gate budget. Opt in with SHARE_PROBE=1. The read-only page and
 * its invalid and unknown link alerts are gated by share.spec.ts.
 */
test.skip(process.env.SHARE_PROBE !== "1", "Set SHARE_PROBE=1 to record the public share cold-load probe")
test.use({ video: "on", screenshot: "on" })
test.setTimeout(360_000)

type ProbeNote = {
  phase: string
  ms: number
  blank: boolean
  loading: boolean
  loadingCopy: boolean
  sharePage: boolean
  visibleText: string
  title: string
  alert: string
  heading: string
  composer: number
  cookies: number
  requests: number
  finished: number
}

test.afterEach(async ({}, testInfo) => {
  await mkdir(artifacts, { recursive: true })
  const names = await readdir(testInfo.outputDir).catch(() => [])
  for (const name of names) {
    const from = join(testInfo.outputDir, name)
    if (name.endsWith(".webm")) await copyFile(from, `${artifacts}/share-cold.webm`)
    if (name.startsWith("share-01-") && name.endsWith(".png")) await copyFile(from, `${artifacts}/${name}`)
  }
})

test("public share cold load under 3g", async ({ app, browser }, testInfo) => {
  await mkdir(artifacts, { recursive: true })
  const notes: ProbeNote[] = []
  const script = await Effect.runPromise(ShareScenario.script(app, app.data, "share"))
  await Effect.runPromise(ShareScenario.complete(app, app.data, script))
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  expect(script.grant.token).toMatch(/^[0-9a-f-]{36}$/i)

  const visitorContext = await browser.newContext({
    baseURL: app.web.href,
    recordVideo: { dir: artifacts, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  })
  const visitor = await visitorContext.newPage()
  const errors: string[] = []
  let requests = 0
  let finished = 0
  visitor.on("pageerror", (error) => errors.push(error.message))
  visitor.on("request", () => {
    requests += 1
  })
  visitor.on("requestfinished", () => {
    finished += 1
  })
  visitor.on("requestfailed", (request) => {
    console.log(`PROBE requestfailed ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`)
  })
  const cdp = await visitor.context().newCDPSession(visitor)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: 100 * 1024,
    uploadThroughput: 50 * 1024,
    connectionType: "cellular3g",
  })

  const workspaceID = app.data.owner.properties.workspaceID
  const view = (page: Page) =>
    page.evaluate(`(() => {
      const text = (document.body && document.body.innerText ? document.body.innerText : "").replace(/\\s+/g, " ").trim()
      const alertNode = document.querySelector('[role="alert"]')
      const headingNode = document.querySelector("h1")
      return {
        text,
        title: document.title,
        loading: !!document.querySelector('[data-component="message-timeline"][data-loading]'),
        sharePage: !!document.querySelector("[data-share-page]"),
        alert: (alertNode && alertNode.textContent ? alertNode.textContent : "").replace(/\\s+/g, " ").trim(),
        heading: (headingNode && headingNode.textContent ? headingNode.textContent : "").replace(/\\s+/g, " ").trim(),
        composer: document.querySelectorAll('[role="combobox"][aria-label="Message"]').length,
      }
    })()`) as Promise<{
      text: string
      title: string
      loading: boolean
      sharePage: boolean
      alert: string
      heading: string
      composer: number
    }>

  const shot = async (page: Page, t0: number, phase: string) => {
    const file = testInfo.outputPath(`share-01-${phase}.png`)
    const snapshot = await view(page)
    const note: ProbeNote = {
      phase,
      ms: Date.now() - t0,
      blank: snapshot.text.length === 0,
      loading: snapshot.loading,
      loadingCopy: /loading/i.test(snapshot.text),
      sharePage: snapshot.sharePage,
      visibleText: snapshot.text.slice(0, 800),
      title: snapshot.title,
      alert: snapshot.alert,
      heading: snapshot.heading,
      composer: snapshot.composer,
      cookies: (await page.context().cookies()).length,
      requests,
      finished,
    }
    notes.push(note)
    // Capture the viewport: right after commit the document has no layout yet, and a full-page
    // capture of a zero-width document fails.
    const captured = await cdp.send("Page.captureScreenshot", { format: "png" })
    await writeFile(file, Buffer.from(captured.data, "base64"))
    await copyFile(file, `${artifacts}/${basename(file)}`)
    console.log(
      `PROBE ${phase} +${note.ms}ms blank=${note.blank} loading=${note.loading} loadingCopy=${note.loadingCopy} sharePage=${note.sharePage} composer=${note.composer} cookies=${note.cookies} net=${note.finished}/${note.requests} heading=${JSON.stringify(note.heading)} alert=${JSON.stringify(note.alert)} text=${JSON.stringify(note.visibleText.slice(0, 240))}`,
    )
    return note
  }

  const waitSharePage = async (timeout: number) => {
    try {
      await visitor.waitForSelector("[data-share-page]", { state: "attached", timeout })
      return true
    } catch {
      return false
    }
  }

  const probe = async (label: string, url: string, timeout: number, terminal: () => Promise<void>) => {
    const t0 = Date.now()
    await visitor.goto(url, { waitUntil: "commit" })
    await shot(visitor, t0, `${label}-commit`)
    const booted = await waitSharePage(timeout)
    if (!booted) {
      await shot(visitor, t0, `${label}-hung-blank`)
      throw new Error(`PROBE ${label}: the share page never attached within ${timeout}ms`)
    }
    await shot(visitor, t0, `${label}-booted`)
    if ((await view(visitor)).loading) await shot(visitor, t0, `${label}-loading`)
    try {
      await terminal()
    } catch (cause) {
      await shot(visitor, t0, `${label}-terminal-timeout`)
      throw cause
    }
    await shot(visitor, t0, `${label}-terminal`)
  }

  try {
    await probe("valid", script.grant.url, 180_000, async () => {
      await expect(visitor.getByRole("heading", { name: script.title, exact: true })).toBeVisible({ timeout: 60_000 })
      await expect(visitor.getByText(script.prompt, { exact: true })).toBeVisible()
      await expect(visitor.getByText(script.answer, { exact: true })).toBeVisible()
      await expect(visitor.getByRole("combobox", { name: "Message", exact: true })).toHaveCount(0)
      await expect(visitor.getByRole("button", { name: "Send", exact: true })).toHaveCount(0)
    })
    await probe("invalid", `/s/${workspaceID}/not-a-uuid`, 60_000, async () => {
      await expect(visitor.getByRole("alert")).toContainText("This share link is not valid", { timeout: 30_000 })
      await expect(visitor.getByRole("combobox", { name: "Message", exact: true })).toHaveCount(0)
    })
    await probe("unknown", `/s/${workspaceID}/${unknownToken}`, 60_000, async () => {
      await expect(visitor.getByRole("alert")).toContainText("This link no longer points to a shared conversation", {
        timeout: 30_000,
      })
      await expect(visitor.getByRole("combobox", { name: "Message", exact: true })).toHaveCount(0)
    })
  } finally {
    await shot(visitor, Date.now(), "final").catch(() => undefined)
    const blank = notes.filter((note) => note.blank)
    const unlabeled = notes.filter((note) => note.loading && !note.loadingCopy)
    const firstText = notes.find((note) => !note.blank)
    console.log("PROBE notes", JSON.stringify(notes, null, 2))
    console.log("PROBE pageerrors", errors)
    console.log(
      `PROBE summary blankPhases=${blank.map((note) => `${note.phase}+${note.ms}ms`).join(",") || "none"} unlabeledLoading=${unlabeled.map((note) => `${note.phase}+${note.ms}ms`).join(",") || "none"} firstVisibleText=${firstText ? `${firstText.phase}+${firstText.ms}ms ${JSON.stringify(firstText.visibleText.slice(0, 160))}` : "never"}`,
    )
    const video = visitor.video()
    await visitorContext.close()
    if (video) {
      await video.saveAs(`${artifacts}/share-cold.webm`)
    } else {
      const names = await readdir(artifacts)
      const recorded = names.find((name) => name.endsWith(".webm") && name !== "share-cold.webm")
      if (recorded) await copyFile(join(artifacts, recorded), `${artifacts}/share-cold.webm`)
    }
  }

  await Effect.runPromise(app.llm.verify())
})
