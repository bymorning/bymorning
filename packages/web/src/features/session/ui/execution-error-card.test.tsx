import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import { afterEach, expect, it } from "vitest"

import { ExecutionErrorCard } from "./execution-error-card"

afterEach(() => {
  cleanup()
  window.history.pushState({}, "", "/")
})

it("reveals provider request and response details", async () => {
  render(() => (
    <ExecutionErrorCard
      failure={{
        type: "provider",
        summary: "Fireworks: authentication failed (401)",
        message: "Invalid API key",
        requestID: "req_123",
        responseBody: '{"error":{"message":"Invalid API key"}}',
        bodyTruncated: true,
      }}
    />
  ))

  expect(screen.getByText("Fireworks: authentication failed (401)")).toBeVisible()
  expect(screen.getByText("Invalid API key")).toBeVisible()
  expect(screen.getByRole("button", { name: "Choose a different model" })).toBeVisible()
  expect(screen.queryByRole("link", { name: "Manage models" })).not.toBeInTheDocument()
  await fireEvent.click(screen.getByRole("button", { name: "Details" }))
  expect(screen.getByText("Request ID: req_123")).toBeVisible()
  expect(screen.getByText(/response body truncated/)).toBeVisible()
})

it("links Manage models from a provider error to the workspace models route", () => {
  window.history.pushState({}, "", "/w/wrk_09028276d001ZOoNDkajkZEVIx/session/ses_1")
  render(() => (
    <ExecutionErrorCard
      failure={{
        type: "provider",
        summary: "Fireworks: authentication failed (401)",
        message: "Invalid API key",
      }}
    />
  ))

  expect(screen.getByRole("link", { name: "Manage models" })).toHaveAttribute(
    "href",
    "/w/wrk_09028276d001ZOoNDkajkZEVIx/gateway/models",
  )
})
