import { expect, test, type BrowserType, type CDPSession } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type Mode = "paced" | "burst"
type BrowserResult = {
  readonly mode: Mode
  readonly eventCount: number
  readonly wallTime: number
  readonly applyLatency: ReadonlyArray<number>
  readonly longTaskCount: number
  readonly longTaskDuration: number
  readonly checksum: string
  readonly mountedRowCount: number
  readonly rowIdentityPreserved: boolean
  readonly markdownIdentityPreserved: boolean
}
type Run = BrowserResult & {
  readonly TaskDuration: number
  readonly ScriptDuration: number
  readonly LayoutDuration: number
  readonly RecalcStyleDuration: number
  readonly latencyP50: number
  readonly latencyP95: number
  readonly latencyMax: number
}

const metricNames = ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"] as const
const transport = process.env.TRANSCRIPT_TRANSPORT === "typed" ? "typed" : "sse"
const harnessURL = `/test-browser/transcript-performance-harness.html?transport=${transport}`
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined)
const median = (values: ReadonlyArray<number>) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!
const percentile = (values: ReadonlyArray<number>, fraction: number) =>
  [...values].sort((left, right) => left - right)[Math.ceil(values.length * fraction) - 1]!

async function run(browserType: BrowserType, mode: Mode): Promise<Run> {
  const browser = await browserType.launch(executablePath ? { executablePath } : {})
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } })
  const page = await context.newPage()
  page.on("pageerror", (error) => console.error(error))
  page.on("console", (message) => message.type() === "error" && console.error(message.text()))
  await page.goto(harnessURL)
  await page.waitForFunction(() => window.transcriptPerformance?.ready === true, undefined, { timeout: 60_000 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const before = await metrics(cdp)
  await page.evaluate((selectedMode) => window.transcriptPerformance.start(selectedMode), mode)
  const result = await page
    .waitForFunction(() => {
      if (window.transcriptPerformance.error) throw new Error(window.transcriptPerformance.error)
      return window.transcriptPerformance.result
    })
    .then((handle) => handle.jsonValue())
  if (!result) throw new Error("Transcript benchmark completed without a result")
  const after = await metrics(cdp)
  await context.close()
  await browser.close()
  return {
    ...result,
    ...Object.fromEntries(metricNames.map((name) => [name, after[name] - before[name]])),
    latencyP50: percentile(result.applyLatency, 0.5),
    latencyP95: percentile(result.applyLatency, 0.95),
    latencyMax: Math.max(...result.applyLatency),
  } as Run
}

async function metrics(cdp: CDPSession) {
  const sampled = await cdp.send("Performance.getMetrics")
  const values = Object.fromEntries(sampled.metrics.map((metric) => [metric.name, metric.value]))
  return Object.fromEntries(metricNames.map((name) => [name, values[name] ?? 0])) as Record<
    (typeof metricNames)[number],
    number
  >
}

test("records the transcript hot-path benchmark", async ({ browser, browserName }) => {
  const browserType = browser.browserType()
  const warm = await run(browserType, "burst")
  expect(warm.eventCount).toBe(1_000)
  const paced: Run[] = []
  const burst: Run[] = []
  for (let index = 0; index < 5; index++) paced.push(await run(browserType, "paced"))
  for (let index = 0; index < 5; index++) burst.push(await run(browserType, "burst"))
  const all = [...paced, ...burst]
  for (const result of all) {
    expect(result.eventCount).toBe(result.mode === "paced" ? 500 : 1_000)
    expect(result.mountedRowCount).toBeLessThan(80)
    expect(result.rowIdentityPreserved).toBe(true)
    expect(result.markdownIdentityPreserved).toBe(true)
  }
  expect(new Set(paced.map((result) => result.checksum)).size).toBe(1)
  expect(new Set(burst.map((result) => result.checksum)).size).toBe(1)

  const summarize = (runs: ReadonlyArray<Run>) => ({
    wallTime: median(runs.map((result) => result.wallTime)),
    latencyP50: median(runs.map((result) => result.latencyP50)),
    latencyP95: median(runs.map((result) => result.latencyP95)),
    latencyMax: median(runs.map((result) => result.latencyMax)),
    longTaskCount: median(runs.map((result) => result.longTaskCount)),
    longTaskDuration: median(runs.map((result) => result.longTaskDuration)),
    TaskDuration: median(runs.map((result) => result.TaskDuration)),
    ScriptDuration: median(runs.map((result) => result.ScriptDuration)),
    LayoutDuration: median(runs.map((result) => result.LayoutDuration)),
    RecalcStyleDuration: median(runs.map((result) => result.RecalcStyleDuration)),
  })
  const summary = { paced: summarize(paced), burst: summarize(burst) }
  const artifact = {
    transport,
    capturedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    browserName,
    browserVersion: browser.version(),
    cpu: os.cpus()[0]?.model ?? "unknown",
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    viewport: { width: 1100, height: 700 },
    fixture: await browser.newPage().then(async (page) => {
      await page.goto(harnessURL)
      const fixture = await page.evaluate(() => window.transcriptPerformance.parameters)
      await page.close()
      return fixture
    }),
    summary,
    runs: { paced, burst },
  }
  const output = path.resolve(process.env.TRANSCRIPT_RESULT ?? "test-results/transcript-hot-path/baseline.json")
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`)
  await test.info().attach("transcript-hot-path-results", { path: output, contentType: "application/json" })

  if (!process.env.TRANSCRIPT_BASELINE) return
  const baseline = JSON.parse(await readFile(process.env.TRANSCRIPT_BASELINE, "utf8")) as typeof artifact
  expect(paced.map((result) => result.eventCount)).toEqual(baseline.runs.paced.map((result) => result.eventCount))
  expect(burst.map((result) => result.eventCount)).toEqual(baseline.runs.burst.map((result) => result.eventCount))
  expect(new Set(paced.map((result) => result.checksum))).toEqual(
    new Set(baseline.runs.paced.map((result) => result.checksum)),
  )
  expect(new Set(burst.map((result) => result.checksum))).toEqual(
    new Set(baseline.runs.burst.map((result) => result.checksum)),
  )
  expect(summary.burst.TaskDuration).toBeLessThanOrEqual(baseline.summary.burst.TaskDuration * 0.35)
  expect(summary.paced.latencyP95).toBeLessThanOrEqual(32)
  expect(Math.max(...paced.map((result) => result.latencyMax))).toBeLessThan(100)
  expect(summary.burst.longTaskDuration).toBeLessThanOrEqual(baseline.summary.burst.longTaskDuration * 0.25)
})
