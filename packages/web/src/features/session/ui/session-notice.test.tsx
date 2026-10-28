import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { SessionNotice } from "./session-notice"

afterEach(cleanup)

describe("SessionNotice", () => {
  it.each(["route", "deny"] as const)("renders a %s Policy notice with its detail", (effect) => {
    render(() => (
      <SessionNotice
        notice={{
          type: "notice",
          id: `policy-${effect}`,
          kind: "policy",
          effect,
          text: `Policy ${effect}`,
          detail: "Policy detail",
          policy: "restricted-tools",
          rule: 2,
        }}
      />
    ))

    expect(screen.getByRole("status")).toHaveTextContent(`Policy ${effect}`)
    expect(screen.getByText("Policy detail")).toBeInTheDocument()
  })

  it("explains completed compaction and reveals its context checkpoint", async () => {
    const user = userEvent.setup()
    render(() => (
      <SessionNotice
        notice={{
          type: "notice",
          id: "compaction-complete",
          kind: "compaction",
          status: "completed",
          reason: "manual",
          text: "Session compacted",
          detail: "Future messages will use this checkpoint.",
          summary: "Checkpoint summary",
          recent: "[User]: Keep this recent request",
        }}
      />
    ))

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Session compacted")
    expect(status).toHaveTextContent("Future messages will use this checkpoint.")
    expect(status).toHaveTextContent("Manual")
    await user.click(screen.getByText("View context checkpoint"))
    expect(await screen.findByText("Checkpoint summary")).toBeVisible()
    expect(screen.getByText("[User]: Keep this recent request")).toBeVisible()
  })

  it("announces failed compaction as an error rather than success", () => {
    render(() => (
      <SessionNotice
        notice={{
          type: "notice",
          id: "compaction-failed",
          kind: "compaction",
          status: "failed",
          reason: "manual",
          text: "Compaction failed",
          detail: "Nothing to compact yet",
        }}
      />
    ))

    expect(screen.getByRole("alert")).toHaveTextContent("Compaction failed")
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing to compact yet")
  })

  it("shows a compaction checkpoint as raw Markdown when rendering is disabled", async () => {
    const user = userEvent.setup()
    const view = render(() => (
      <SessionNotice
        renderMarkdown={false}
        notice={{
          type: "notice",
          id: "compaction-raw",
          kind: "compaction",
          status: "completed",
          text: "Session compacted",
          summary: "## Checkpoint\n\n**verbatim**",
        }}
      />
    ))

    await user.click(screen.getByText("View context checkpoint"))
    expect(view.container.querySelector('[data-component="markdown"]')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="raw-text"]')).toHaveTextContent("## Checkpoint **verbatim**")
  })
})
