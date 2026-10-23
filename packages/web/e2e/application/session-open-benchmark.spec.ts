import { Effect } from "effect"
import { expect, test } from "../fixtures/app.js"

/**
 * Session open latency: navigation to `[data-transcript-state="ready"]` for a Session with
 * 50 persisted Messages, idle versus while another Session streams 3,000 text deltas.
 * Opt in with SESSION_OPEN_BENCHMARK=1; the numbers are reported, not asserted.
 */
test.skip(process.env.SESSION_OPEN_BENCHMARK !== "1", "Set SESSION_OPEN_BENCHMARK=1 to record session open timings")

const turns = 25
const deltas = 3_000
const runs = 3
/** Emulated round-trip latency so request serialization is visible against a local Application. */
const latency = Number(process.env.SESSION_OPEN_LATENCY ?? 60)

const median = (values: ReadonlyArray<number>) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!

test.setTimeout(600_000)

test("records session open latency idle and beside a streaming Session", async ({ page, app }) => {
  const workspaceID = app.data.owner.properties.workspaceID
  const idle = async (sessionID: string) => {
    await expect.poll(async () => (await app.client.session.active())[sessionID], { timeout: 120_000 }).toBeUndefined()
  }

  // Seed 50 Messages (25 turns) through the real prompt path.
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "title", [
      { expect: () => undefined, response: { type: "success", events: [{ text: "Benchmark session" }] } },
    ]),
  )
  await Effect.runPromise(
    app.llm.expect(
      app.data.session.id,
      "assistant",
      Array.from({ length: turns }, (_, index) => ({
        expect: () => undefined,
        response: {
          type: "success" as const,
          events: [{ text: `Answer ${index + 1}: ${"lorem ipsum ".repeat(40)}` }],
        },
      })),
    ),
  )
  for (let index = 0; index < turns; index++) {
    await app.client.session.prompt({ sessionID: app.data.session.id, text: `Prompt ${index + 1}` })
    await idle(app.data.session.id)
  }
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  const seeded = await app.client.message.list({ sessionID: app.data.session.id, limit: 100 })
  expect(seeded.data.length).toBeGreaterThanOrEqual(turns * 2)

  // A second Session that streams a long response gated per run.
  const other = await app.client.session.create({
    workspace: workspaceID,
    projectID: app.data.project.id,
    model: app.data.session.model,
  })
  await Effect.runPromise(
    app.llm.expect(other.id, "title", [
      { expect: () => undefined, response: { type: "success", events: [{ text: "Streaming session" }] } },
    ]),
  )
  const gates = Array.from({ length: runs }, (_, index) => `${other.id}:burst-${index}`)
  await Effect.runPromise(
    app.llm.expect(other.id, "assistant", [
      {
        expect: () => undefined,
        response: {
          type: "success",
          events: gates.flatMap((gate) => [
            { gate },
            ...Array.from({ length: deltas }, (_, index) => ({ text: `token${index} ` })),
          ]),
        },
      },
    ]),
  )

  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  const home = `/w/${workspaceID}`
  const target = `/w/${workspaceID}/session/${app.data.session.id}`
  const navigate = (href: string) =>
    page.evaluate(`history.pushState({}, "", ${JSON.stringify(href)}); dispatchEvent(new PopStateEvent("popstate"))`)
  const leave = async () => {
    await navigate(home)
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible()
  }
  const open = async () => {
    const requests: string[] = []
    const count = (request: { url(): string }) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/event") requests.push(url.pathname + url.search)
    }
    page.on("request", count)
    const elapsed = (await page.evaluate(`new Promise((resolve) => {
      const href = ${JSON.stringify(target)}
      const start = performance.now()
      const check = () => {
        const element = document.querySelector('[data-component="session-workspace"]')
        if (
          location.pathname === href &&
          element?.getAttribute("data-transcript-state") === "ready" &&
          element.getAttribute("data-session-sync") === "ready"
        ) {
          observer.disconnect()
          resolve(performance.now() - start)
        }
      }
      const observer = new MutationObserver(check)
      observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true })
      history.pushState({}, "", href)
      dispatchEvent(new PopStateEvent("popstate"))
    })`)) as number
    page.off("request", count)
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeEditable()
    return { elapsed, requests: requests.length, paths: requests }
  }

  type Run = { elapsed: number; requests: number; paths: string[] }
  const idleRuns: Run[] = []
  for (let index = 0; index < runs; index++) {
    await leave()
    idleRuns.push(await open())
  }

  await app.client.session.prompt({ sessionID: other.id, text: "Stream a lot" })
  const streamingRuns: Run[] = []
  for (const gate of gates) {
    await Effect.runPromise(app.llm.waitGate(gate))
    await leave()
    const released = Effect.runPromise(app.llm.release(gate))
    streamingRuns.push(await open())
    await released
  }
  await idle(other.id)
  await Effect.runPromise(app.llm.settled(other.id, "title"))

  const summarize = (list: Run[]) => ({
    median: Math.round(median(list.map((run) => run.elapsed))),
    runs: list.map((run) => ({ elapsed: Math.round(run.elapsed), requests: run.requests })),
  })
  const report = {
    messages: seeded.data.length,
    latency,
    paths: idleRuns[0]?.paths,
    idle: summarize(idleRuns),
    streaming: summarize(streamingRuns),
  }
  console.log(`SESSION_OPEN_BENCHMARK ${JSON.stringify(report)}`)
  await test.info().attach("session-open-benchmark", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  })
  await Effect.runPromise(app.llm.verify())
})
