import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal, ErrorBoundary } from "solid-js"
import { afterEach, beforeAll, expect, it } from "vitest"

import { injectMarkdownWorkerFactory } from "../markdown/markdown-worker"
import { Markdown } from "./markdown"

/** A module Worker whose script fails to load, as when the network drops while it is fetched. */
class FailedWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage() {
    queueMicrotask(() => this.onerror?.(new ErrorEvent("error")))
  }
  terminate() {}
}

beforeAll(() => injectMarkdownWorkerFactory(() => new FailedWorker()))
afterEach(cleanup)

it("keeps showing streaming text as plain text when the Markdown worker fails to load", async () => {
  const [text, setText] = createSignal("Before offline.")
  render(() => (
    <ErrorBoundary fallback={(error) => <p role="alert">{String(error)}</p>}>
      <Markdown text={text()} cacheKey="worker-failure" streaming />
    </ErrorBoundary>
  ))
  expect(await screen.findByText("Before offline.")).toBeInTheDocument()
  // The failure disables the worker; the next delta must not take the page down either.
  setText("Before offline. Recovered offline progress.")
  expect(await screen.findByText("Before offline. Recovered offline progress.")).toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
