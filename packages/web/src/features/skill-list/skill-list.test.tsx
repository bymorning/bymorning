import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SkillList } from "./skill-list"
import type { SkillListItem } from "./skill-list-model"
import type { ListState } from "../list-state"

afterEach(cleanup)

describe("SkillList", () => {
  it("renders each non-ready state and retries errors", async () => {
    const onRetry = vi.fn()
    render(() => {
      const [state, setState] = createSignal<ListState<SkillListItem>>({ status: "loading" })
      return (
        <>
          <button type="button" onClick={() => setState({ status: "empty" })}>
            Empty
          </button>
          <button type="button" onClick={() => setState({ status: "error", message: "Skills unavailable" })}>
            Error
          </button>
          <SkillList state={state()} onOpen={() => undefined} onRetry={onRetry} />
        </>
      )
    })

    expect(screen.getByRole("status")).toHaveTextContent("Loading skills")
    screen.getByRole("button", { name: "Empty" }).click()
    expect(screen.getByRole("status")).toHaveTextContent("No custom skills yet.")
    expect(screen.getByRole("status")).toHaveAttribute("data-component", "empty")
    expect(screen.getByRole("status")).toHaveAttribute("data-variant", "panel")
    screen.getByRole("button", { name: "Error" }).click()
    expect(screen.getByRole("alert")).toHaveTextContent("Skills unavailable")
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("opens a skill from its row, showing its description but not its instructions", async () => {
    const onOpen = vi.fn()
    render(() => (
      <SkillList
        state={{ status: "ready", items: [{ id: "review", name: "Review", description: "Review code" }] }}
        onOpen={onOpen}
        onRetry={() => undefined}
      />
    ))

    expect(screen.getByRole("list", { name: "Skills" })).toBeVisible()
    expect(screen.getByText("Review")).toBeVisible()
    expect(screen.getByText("Review code")).toBeVisible()
    expect(screen.queryByText("Check every change")).not.toBeInTheDocument()
    expect(screen.queryByText(/model/i)).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Open Review details" }))
    expect(onOpen).toHaveBeenCalledWith("review")
  })
})
