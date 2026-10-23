import { cleanup, render, screen, within } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentList } from "./agent-list"
import type { AgentListItem } from "./agent-list-model"
import type { ListState } from "../list-state"

afterEach(cleanup)

const agent = {
  id: "build",
  name: "Build",
  description: "Build software",
  instructions: "Ship it",
  mode: "primary",
  hidden: false,
  steps: null,
  model: { provider: "anthropic", id: "claude-sonnet-4", variant: "balanced" },
} satisfies AgentListItem

describe("AgentList", () => {
  it("renders each non-ready state and retries errors", async () => {
    const onRetry = vi.fn()
    render(() => {
      const [state, setState] = createSignal<ListState<AgentListItem>>({ status: "loading" })
      return (
        <>
          <button type="button" onClick={() => setState({ status: "empty" })}>
            Empty
          </button>
          <button type="button" onClick={() => setState({ status: "error", message: "Agents unavailable" })}>
            Error
          </button>
          <AgentList state={state()} onOpen={() => undefined} onRetry={onRetry} />
        </>
      )
    })

    expect(screen.getByRole("status")).toHaveTextContent("Loading agents")
    screen.getByRole("button", { name: "Empty" }).click()
    expect(screen.getByText("No agents in this workspace.")).toBeVisible()
    screen.getByRole("button", { name: "Error" }).click()
    expect(screen.getByRole("alert")).toHaveTextContent("Agents unavailable")
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("presents agent configuration metadata and opens details without rendering instructions", async () => {
    const onOpen = vi.fn()
    render(() => <AgentList state={{ status: "ready", items: [agent] }} onOpen={onOpen} onRetry={() => undefined} />)

    expect(screen.getByRole("list", { name: "Default agent" })).toBeVisible()
    expect(screen.getByText("Build software")).toBeVisible()
    expect(screen.queryByText("Default")).not.toBeInTheDocument()
    expect(screen.queryByText("Primary")).not.toBeInTheDocument()
    expect(screen.getByText("anthropic")).toBeVisible()
    expect(screen.getByText("claude-sonnet-4")).toBeVisible()
    expect(screen.getByText("· balanced")).toBeVisible()
    expect(screen.queryByText("Ship it")).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Open Build details" }))
    expect(onOpen).toHaveBeenCalledWith("build")
  })

  it("clearly separates the Default agent from Subagents into their own labeled groups", () => {
    const subagent = {
      ...agent,
      id: "explore",
      name: "Explore",
      description: "Explores the codebase",
      mode: "subagent",
    } satisfies AgentListItem
    render(() => (
      <AgentList
        state={{ status: "ready", items: [agent, subagent] }}
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    ))

    const defaultGroup = screen.getByRole("list", { name: "Default agent" })
    const subagentGroup = screen.getByRole("list", { name: "Subagents" })
    expect(screen.getByRole("heading", { name: "Default agent" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Subagents" })).toBeVisible()
    expect(defaultGroup).not.toBe(subagentGroup)
    const defaultRow = within(defaultGroup).getByRole("button", { name: "Open Build details" })
    const subagentRow = within(subagentGroup).getByRole("button", { name: "Open Explore details" })
    expect(defaultRow).toHaveAttribute("data-variant", "default")
    expect(subagentRow).not.toHaveAttribute("data-variant")
    // No redundant "Default" badge — the group heading already says so.
    expect(screen.queryByText("Default", { selector: "[data-component=tag]" })).not.toBeInTheDocument()
    // The Default agent's group renders before Subagents regardless of input order.
    expect(defaultGroup.compareDocumentPosition(subagentGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("omits the Subagents group entirely when the workspace has none yet", () => {
    render(() => (
      <AgentList state={{ status: "ready", items: [agent] }} onOpen={() => undefined} onRetry={() => undefined} />
    ))
    expect(screen.queryByRole("heading", { name: "Subagents" })).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Subagents" })).not.toBeInTheDocument()
  })

  it("follows later refreshes of a ready list without remounting", () => {
    const subagent = { ...agent, id: "loud", name: "Loud", mode: "subagent" } satisfies AgentListItem
    const [items, setItems] = createSignal<ReadonlyArray<AgentListItem>>([agent])
    render(() => (
      <AgentList state={{ status: "ready", items: items() }} onOpen={() => undefined} onRetry={() => undefined} />
    ))
    expect(screen.queryByRole("button", { name: "Open Loud details" })).not.toBeInTheDocument()

    setItems([agent, subagent])
    expect(screen.getByRole("list", { name: "Subagents" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Open Loud details" })).toBeVisible()

    setItems([agent, { ...subagent, name: "Louder" }])
    expect(screen.getByRole("button", { name: "Open Louder details" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "Open Loud details" })).not.toBeInTheDocument()
  })
})
