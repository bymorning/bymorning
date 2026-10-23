import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, expect, it } from "vitest"

import { Empty } from "./empty"

afterEach(cleanup)

it("announces copy as status", () => {
  render(() => <Empty>No skills yet.</Empty>)
  expect(screen.getByRole("status")).toHaveTextContent("No skills yet.")
  expect(screen.getByRole("status")).toHaveAttribute("data-component", "empty")
})

it("uses an explicit accessible name when it differs from the copy", () => {
  render(() => <Empty label="No usage for selected period">No usage</Empty>)
  expect(screen.getByRole("status", { name: "No usage for selected period" })).toHaveTextContent("No usage")
})

it("renders a framed empty panel", () => {
  render(() => <Empty label="No usage" variant="panel">No usage</Empty>)
  expect(screen.getByRole("status", { name: "No usage" })).toHaveAttribute("data-variant", "panel")
})
