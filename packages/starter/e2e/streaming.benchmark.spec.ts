import { Effect } from "effect"
import assert from "node:assert/strict"
import { Session } from "@bymorning/core/session"
import { expect, test } from "./fixture.js"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

test.skip(process.env.STARTER_STREAMING_BENCHMARK !== "1", "run explicitly against the production-build fixture")

test("records the initial streaming baseline for a fixed real Message", async ({ page, app }, testInfo) => {
  await page.evaluate(`(() => {
    const values = [];
    let previous;
    let active = true;
    const frame = (now) => {
      if (previous !== undefined) values.push(now - previous);
      previous = now;
      if (active) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const longTasks = [];
    const observer = new PerformanceObserver((entries) => longTasks.push(...entries.getEntries().map((entry) => entry.duration)));
    observer.observe({ type: "longtask", buffered: true });
    window.__starterBenchmark = () => {
      active = false;
      observer.disconnect();
      return { frames: values, longTasks };
    };
  })()`)
  const text = Array.from({ length: 120 }, (_, index) => `stream-${index + 1}`).join(" ")
  const gate = `${app.data.session.id}:benchmark`
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "title", [
      { expect: () => undefined, response: { type: "success", events: [{ text: "Benchmark" }] } },
    ]),
  )
  await Effect.runPromise(
    app.llm.expect(app.data.session.id, "assistant", [
      {
        expect: (request) =>
          assert.ok(request.messages.some((message) => JSON.stringify(message.content).includes("Benchmark stream"))),
        response: { type: "success", events: [...text.split(" ").map((part) => ({ text: `${part} ` })), { gate }] },
      },
    ]),
  )
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Benchmark stream")
  await Promise.all([
    Effect.runPromise(app.llm.waitGate(gate)),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ])
  await Effect.runPromise(app.llm.release(gate))
  await Effect.runPromise(
    app.workspace(
      { account: app.data.account },
      Session.Service.use((sessions) => sessions.awaitIdle(app.data.session.id)),
    ),
  )
  await expect(page.getByText(text, { exact: true })).toBeVisible()
  const measurement = (await page.evaluate("window.__starterBenchmark()")) as { frames: number[]; longTasks: number[] }
  const ordered = measurement.frames.toSorted((left, right) => left - right)
  const p95 = ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0
  const baseline = { p95FrameDuration: p95, longTasks: measurement.longTasks, retainedHistory: 1 }
  const reports = fileURLToPath(new URL("./reports", import.meta.url))
  await mkdir(reports, { recursive: true })
  await writeFile(
    new URL("./reports/streaming-baseline.json", import.meta.url),
    `${JSON.stringify(baseline, null, 2)}\n`,
  )
  await testInfo.attach("streaming-baseline", {
    body: JSON.stringify(baseline, null, 2),
    contentType: "application/json",
  })
  await Effect.runPromise(app.llm.settled(app.data.session.id, "title"))
  await Effect.runPromise(app.llm.verify())
})
