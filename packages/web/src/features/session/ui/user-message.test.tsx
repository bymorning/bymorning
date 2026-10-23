import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UserMessage } from "./user-message"

afterEach(cleanup)

describe("user message", () => {
  it("leaves short messages fully visible", () => {
    const view = render(() => <UserMessage message={{ id: "short", text: "A short prompt" }} projectFiles={[]} />)

    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-slot="user-message-body"]')).not.toHaveAttribute("data-collapsible")
  })

  it("collapses large messages and expands the whole bubble", async () => {
    const rendered = vi.fn()
    const text = "A detailed request ".repeat(30)
    const view = render(() => <UserMessage message={{ id: "large", text }} projectFiles={[]} onResize={rendered} />)
    const body = view.container.querySelector<HTMLElement>('[data-slot="user-message-body"]')!

    expect(body).toHaveAttribute("data-collapsible")
    expect(body).not.toHaveAttribute("data-expanded")
    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(body)
    await Promise.resolve()

    expect(body).toHaveAttribute("data-expanded")
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
    expect(rendered).toHaveBeenCalledOnce()
  })

  it("treats a multiline prompt as large without a character minimum", () => {
    render(() => (
      <UserMessage message={{ id: "multiline", text: "one\ntwo\nthree\nfour\nfive\nsix\nseven" }} projectFiles={[]} />
    ))

    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument()
  })
})
