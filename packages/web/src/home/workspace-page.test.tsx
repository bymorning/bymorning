import { cleanup, render, screen, within } from "@solidjs/testing-library"
import { afterEach, expect, it } from "vitest"

import { WorkspacePage } from "./workspace-page"

afterEach(cleanup)

it("renders composable actions in the workspace page header", () => {
  render(() => (
    <WorkspacePage title="Agents" description="Agent description" actions={<button type="button">Add agent</button>}>
      <p>Existing list</p>
    </WorkspacePage>
  ))

  const page = screen.getByRole("region", { name: "Agents page" })
  expect(within(page).getByRole("button", { name: "Add agent" })).toBeInTheDocument()
  expect(page.querySelector('[data-slot="workspace-page-actions"]')).toContainElement(
    within(page).getByRole("button", { name: "Add agent" }),
  )
  expect(within(page).getByText("Existing list")).toBeInTheDocument()
})

it("supports a composed visual heading while preserving its title label", () => {
  render(() => <WorkspacePage title="Atlassian" heading={<>MCP / Atlassian</>} />)

  expect(screen.getByRole("heading", { name: "MCP / Atlassian" })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: "Atlassian page" })).toBeInTheDocument()
})

it("links back to the parent page above the title", () => {
  render(() => <WorkspacePage title="auto/general" back={{ href: "/w/wrk_1/policies", label: "Model routing" }} />)

  const page = screen.getByRole("region", { name: "auto/general page" })
  expect(within(page).getByRole("link", { name: "Model routing" })).toHaveAttribute("href", "/w/wrk_1/policies")
  expect(within(page).getByRole("heading", { name: "auto/general" })).toBeInTheDocument()
})

it("renders no back link without one", () => {
  render(() => <WorkspacePage title="Agents" />)

  expect(screen.getByRole("region", { name: "Agents page" }).querySelector('[data-slot="workspace-page-back"]')).toBeNull()
})
