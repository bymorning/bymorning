import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { render, screen } from "@solidjs/testing-library"
import { expect, it } from "vitest"

import { NotFoundRoute, NotFoundState } from "./route"

it("renders the unknown-path 404 with a home button-link", () => {
  render(() => <MemoryRouter history={createMemoryHistory()} root={() => <NotFoundRoute />} />)
  expect(screen.getByRole("heading", { name: "404: Not Found" })).toBeInTheDocument()
  const link = screen.getByRole("link", { name: "Return home" })
  expect(link).toHaveAttribute("href", "/")
  expect(link).toHaveAttribute("data-component", "button")
})

it("renders a custom state with a way back", () => {
  render(() => (
    <MemoryRouter
      history={createMemoryHistory()}
      root={() => (
        <NotFoundState
          title="Workspace unavailable"
          description="Gone."
          href="/w/wrk_1"
          action="Go to your workspace"
        />
      )}
    />
  ))
  expect(screen.getByRole("link", { name: "Go to your workspace" })).toHaveAttribute("href", "/w/wrk_1")
})

it("titles the browser tab after the state", () => {
  document.title = "ByMorning"
  const view = render(() => (
    <MemoryRouter
      history={createMemoryHistory()}
      root={() => <NotFoundState title="404: Not Found" description="Gone." href="/" action="Return home" />}
    />
  ))
  expect(document.title).toBe("404: Not Found · ByMorning")
  view.unmount()
  expect(document.title).toBe("ByMorning")
})

it("restores the title it replaced", () => {
  document.title = "Overview · ByMorning"
  const view = render(() => (
    <MemoryRouter
      history={createMemoryHistory()}
      root={() => <NotFoundState title="404: Not Found" description="Gone." href="/" action="Return home" />}
    />
  ))
  expect(document.title).toBe("404: Not Found · ByMorning")
  view.unmount()
  expect(document.title).toBe("Overview · ByMorning")
})
