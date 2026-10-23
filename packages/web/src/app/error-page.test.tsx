import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { ErrorPage } from "./error-page"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("shows friendly copy, actual error details, and retries", async () => {
  const user = userEvent.setup()
  const retry = vi.fn()

  render(() => <ErrorPage error={new Error("network unavailable")} onRetry={retry} />)

  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
  expect(screen.getByRole("alert")).toHaveTextContent("This page could not be displayed")
  const details = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Error details" })
  expect(details.value).toContain("Error: network unavailable")
  expect(details.parentElement).toHaveAttribute("data-appearance", "diagnostic")

  await user.click(screen.getByRole("button", { name: "Retry" }))
  expect(retry).toHaveBeenCalledOnce()
})

it("reloads when retrying a failed dynamic import", async () => {
  const user = userEvent.setup()
  const retry = vi.fn()
  const reload = vi.fn()
  vi.stubGlobal("location", { reload })

  render(() => (
    <ErrorPage
      error={new TypeError("Failed to fetch dynamically imported module: http://localhost/src/session/route.tsx")}
      onRetry={retry}
    />
  ))

  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
  await user.click(screen.getByRole("button", { name: "Retry" }))
  expect(reload).toHaveBeenCalledOnce()
  expect(retry).not.toHaveBeenCalled()
})
