import { cleanup, render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import type { Message, SessionID } from "@bymorning/client/solid"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SessionProvider, SessionTimeline } from "../src/index.js"
import type { SessionUI } from "../src/model.js"

afterEach(cleanup)

const id = "assistant-fixture" as Message["id"]
const sessionID = "session-fixture" as SessionID
const assistant: Extract<Message, { type: "assistant" }> = {
  id,
  sessionID,
  sequence: 2,
  createdAt: new Date(0),
  type: "assistant",
  model: { id: "test", provider: "fixture" as Extract<Message, { type: "assistant" }>["model"]["provider"] },
  content: [
    {
      type: "tool",
      id: "tool-1",
      name: "read",
      state: { status: "completed", input: { path: "notes.txt" }, content: [{ type: "text", text: "contents" }] },
      time: { created: new Date(0), completed: new Date(0) },
    },
  ],
  time: { created: new Date(0), completed: new Date(0) },
}

const rows: readonly SessionUI.Row[] = [{ type: "message", key: "message:assistant-fixture", message: assistant }]
const labels = {
  loading: "Loading",
  retry: "Retry",
  dismiss: "Dismiss",
  interrupted: "Interrupted",
  permission: "Permission",
  form: "Form",
}

describe("SessionProvider", () => {
  it("replaces, rather than merges, an outer scoped tool map", () => {
    const Outer: SessionUI.Tool = { render: () => <p>outer tool</p> }
    const Inner: SessionUI.Tool = { render: () => <p>inner tool</p> }
    render(() => (
      <SessionProvider labels={labels} tools={new Map([["read", Outer]])}>
        <SessionProvider tools={new Map([["other", Inner]])}>
          <SessionTimeline
            sessionID={() => sessionID}
            rows={() => rows}
            loading={() => false}
            error={() => undefined}
          />
        </SessionProvider>
      </SessionProvider>
    ))

    expect(screen.queryByText("outer tool")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /read/i })).toBeInTheDocument()
  })

  it("uses only the closest matching custom renderer", () => {
    const Inner: SessionUI.Tool = { render: () => <p>closest tool</p> }
    render(() => (
      <SessionProvider labels={labels} tools={new Map([["read", { render: () => <p>outer tool</p> }]])}>
        <SessionProvider tools={new Map([["read", Inner]])}>
          <SessionTimeline
            sessionID={() => sessionID}
            rows={() => rows}
            loading={() => false}
            error={() => undefined}
          />
        </SessionProvider>
      </SessionProvider>
    ))

    expect(screen.getByText("closest tool")).toBeInTheDocument()
    expect(screen.queryByText("outer tool")).not.toBeInTheDocument()
  })

  it("keeps native modified subagent links and routes an ordinary click through the caller", async () => {
    const user = userEvent.setup()
    const child = "2e4b2f31-4ca9-4c63-8b0f-f63bf8ab4a12" as SessionID
    const openSession = vi.fn()
    const subagent: typeof assistant = {
      ...assistant,
      content: [
        {
          type: "tool",
          id: "tool-child",
          name: "subagent",
          state: { status: "completed", input: { description: "Review" }, metadata: { sessionID: child }, content: [] },
          time: { created: new Date(0), completed: new Date(0) },
        },
      ],
    }
    render(() => (
      <SessionProvider labels={labels}>
        <SessionTimeline
          sessionID={() => sessionID}
          rows={() => [{ type: "message", key: "child", message: subagent }]}
          loading={() => false}
          error={() => undefined}
          sessionHref={(id) => `/session/${id}`}
          openSession={openSession}
        />
      </SessionProvider>
    ))
    await user.click(screen.getByRole("button", { name: /agent/i }))
    const link = screen.getByRole("link", { name: "Review" })
    expect(link).toHaveAttribute("href", `/session/${child}`)
    await user.click(link)
    expect(openSession).toHaveBeenCalledWith(child)
  })
})
