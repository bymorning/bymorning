import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import { afterEach, expect, it, vi } from "vitest"

import { BootstrapGate } from "./bootstrap"

const context = vi.hoisted(() => ({ bootstrap: vi.fn<() => Promise<void>>() }))
vi.mock("../../runtime/server/runtime", () => ({ useServer: () => context }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("keeps the complete shell empty until bootstrap is ready", async () => {
  const bootstrap = Promise.withResolvers<void>()
  context.bootstrap.mockReturnValue(bootstrap.promise)

  render(() => (
    <BootstrapGate>
      <nav>Workspace sidebar</nav>
      <main>Overview</main>
    </BootstrapGate>
  ))

  expect(document.querySelector('[data-component="shell"]')).toHaveAttribute("aria-busy", "true")
  expect(document.querySelector('[data-slot="project-sidebar"]')).toBeEmptyDOMElement()
  expect(document.querySelector('[data-slot="shell-content"]')).toBeEmptyDOMElement()
  expect(screen.queryByText("Workspace sidebar")).not.toBeInTheDocument()
  expect(screen.queryByText("Overview")).not.toBeInTheDocument()

  bootstrap.resolve()

  expect(await screen.findByText("Workspace sidebar")).toBeInTheDocument()
  expect(screen.getByText("Overview")).toBeInTheDocument()
  expect(document.querySelector('[data-component="shell"]')).not.toBeInTheDocument()
})

it("reveals existing recovery UI when bootstrap fails", async () => {
  const error = new Error("offline")
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined)
  context.bootstrap.mockRejectedValue(error)

  render(() => (
    <BootstrapGate>
      <p role="alert">Workspace unavailable</p>
    </BootstrapGate>
  ))

  expect(await screen.findByRole("alert")).toHaveTextContent("Workspace unavailable")
  await waitFor(() => expect(report).toHaveBeenCalledWith("Session bootstrap failed", error))
})
