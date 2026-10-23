import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SessionUI } from "../session-model"
import { ToolDisplay } from "./tool-display"
import { BmUiI18nProvider, createBmUiI18n } from "../../../../ui/context/i18n"

afterEach(cleanup)

const childID = "00000000-0000-4000-8000-000000000010"
const parentID = "00000000-0000-4000-8000-000000000001"
const fallbackChildID = "00000000-0000-4000-8000-000000000011"
const sessionHref = (sessionID: string) => `#session-${sessionID}`
const subagent = (input: Partial<SessionUI.ToolPart> = {}): SessionUI.ToolPart => ({
  type: "tool",
  id: "subagent-call",
  name: "subagent",
  input: { agent: "explore", description: "Inspect the timeline" },
  metadata: {},
  state: { type: "running" },
  ...input,
})

describe("Subagent Tool", () => {
  it("uses locale text for visible and accessible delegation presentation", () => {
    const i18n = createBmUiI18n(() => "es", {
      "ui.tool.subagent.defaultAgent": "Agente",
      "ui.tool.subagent.delegatedTask": "Tarea delegada",
      "ui.tool.subagent.delegating": "Delegando",
      "ui.tool.subagent.running": "En curso",
      "ui.tool.subagent.label": ({ agent, description, status }) => `${agent}: ${description}; ${status}`,
    })
    const view = render(() => (
      <BmUiI18nProvider value={i18n}>
        <ToolDisplay tool={subagent({ input: {}, inputStreaming: true })} onFileOpen={() => {}} />
      </BmUiI18nProvider>
    ))

    expect(screen.getByRole("status", { name: "Delegando" })).toHaveTextContent("Delegando")
    view.unmount()
    render(() => (
      <BmUiI18nProvider value={i18n}>
        <ToolDisplay tool={subagent({ input: {} })} onFileOpen={() => {}} />
      </BmUiI18nProvider>
    ))
    expect(screen.getByLabelText("Agente: Tarea delegada; En curso")).toBeInTheDocument()
  })

  it.each([
    {
      state: "foreground running",
      tool: () => subagent(),
      activity: "idle" as const,
      status: "En curso",
    },
    {
      state: "background running",
      tool: () => subagent({ metadata: { sessionID: childID, status: "running" }, state: { type: "succeeded" } }),
      activity: "running" as const,
      status: "En segundo plano",
      suffix: "(fondo)",
    },
    {
      state: "completed",
      tool: () => subagent({ metadata: { sessionID: childID, status: "completed" }, state: { type: "succeeded" } }),
      activity: "idle" as const,
      status: "Completado",
    },
    {
      state: "cancelled",
      tool: () => subagent({ metadata: { sessionID: childID }, state: { type: "interrupted" } }),
      activity: "idle" as const,
      status: "Cancelado",
      terminal: "Cancelado",
    },
    {
      state: "error",
      tool: () => subagent({ metadata: { sessionID: childID }, state: { type: "failed", message: "cuota agotada" } }),
      activity: "idle" as const,
      status: "Error localizado: cuota agotada",
      terminal: "cuota agotada",
    },
  ])("uses locale text and accessible composition for $state", ({ tool, activity, status, suffix, terminal }) => {
    const i18n = createBmUiI18n(() => "es", {
      "ui.tool.subagent.running": "En curso",
      "ui.tool.subagent.runningBackground": "En segundo plano",
      "ui.tool.subagent.completed": "Completado",
      "ui.tool.subagent.cancelled": "Cancelado",
      "ui.tool.subagent.error": ({ message }) => `Error localizado: ${message}`,
      "ui.tool.subagent.backgroundSuffix": "(fondo)",
      "ui.tool.subagent.label": ({ agent, description, status: current }) => `${agent}: ${description}; ${current}`,
    })
    const view = render(() => (
      <BmUiI18nProvider value={i18n}>
        <ToolDisplay
          tool={tool()}
          onFileOpen={() => {}}
          agents={[{ id: "explore", name: "Agente" }]}
          actions={{ sessionHref, openSession: () => {}, sessionStatus: () => activity }}
        />
      </BmUiI18nProvider>
    ))

    expect(view.container.querySelector('[data-component="subagent-tool"]')).toHaveAccessibleName(
      `Agente: Inspect the timeline; ${status}`,
    )
    if (suffix) expect(screen.getByText(suffix)).toBeInTheDocument()
    if (terminal) expect(screen.getByText(terminal)).toBeInTheDocument()
    if (!terminal) expect(screen.queryByText(status)).not.toBeInTheDocument()
  })

  it("shows compact Delegating while input streams", () => {
    const view = render(() => (
      <ToolDisplay tool={subagent({ input: {}, inputStreaming: true })} onFileOpen={() => {}} />
    ))

    expect(screen.getByRole("status", { name: "Delegating" })).toHaveTextContent("Delegating")
    expect(view.container.querySelector('[data-component="subagent-tool"]')).toHaveAttribute("data-compact")
  })

  it("uses catalog presentation and progress metadata without a premature background label", () => {
    const openSession = vi.fn()
    render(() => (
      <ToolDisplay
        tool={subagent({ metadata: { sessionID: childID, status: "running" } })}
        onFileOpen={() => {}}
        agents={[{ id: "explore", name: "Explorer", color: "rgb(10, 20, 30)" }]}
        actions={{ sessionHref, openSession, sessionStatus: () => "running" }}
      />
    ))

    const card = screen.getByRole("link", { name: "Explorer Inspect the timeline Running" })
    expect(card).toHaveAttribute("href", `#session-${childID}`)
    expect(card.querySelector('[data-component="loader"]')).toBeInTheDocument()
    expect(screen.queryByText("(background)")).not.toBeInTheDocument()
    fireEvent.click(card)
    expect(openSession).toHaveBeenCalledWith(childID)
  })

  it("labels only terminal running metadata as background and stops spinning when the child settles", () => {
    const [activity, setActivity] = createSignal<"running" | "idle">("running")
    const view = render(() => (
      <ToolDisplay
        tool={subagent({
          metadata: { sessionID: childID, status: "running" },
          state: { type: "succeeded" },
        })}
        onFileOpen={() => {}}
        actions={{ sessionHref, openSession: () => {}, sessionStatus: () => activity() }}
      />
    ))

    expect(screen.getByText("(background)")).toBeInTheDocument()
    expect(view.container.querySelector('[data-component="loader"]')).toBeInTheDocument()
    setActivity("idle")
    expect(view.container.querySelector('[data-component="loader"]')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-slot="subagent-tool-status"]')).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Completed/ })).toBeInTheDocument()
  })

  it("reactivates a completed invocation when the same child continues elsewhere", () => {
    const [activity, setActivity] = createSignal<"running" | "idle">("idle")
    const view = render(() => (
      <ToolDisplay
        tool={subagent({
          metadata: { sessionID: childID, status: "completed" },
          state: { type: "succeeded" },
        })}
        onFileOpen={() => {}}
        actions={{ sessionHref, openSession: () => {}, sessionStatus: () => activity() }}
      />
    ))

    expect(screen.getByRole("link", { name: /Completed/ })).toBeInTheDocument()
    expect(view.container.querySelector('[data-component="loader"]')).not.toBeInTheDocument()
    setActivity("running")
    expect(screen.getByRole("link", { name: /Running/ })).toBeInTheDocument()
    expect(view.container.querySelector('[data-component="loader"]')).toBeInTheDocument()
    setActivity("idle")
    expect(screen.getByRole("link", { name: /Completed/ })).toBeInTheDocument()
    expect(view.container.querySelector('[data-component="loader"]')).not.toBeInTheDocument()
  })

  it("shows the actual failure while keeping metadata navigation on failed and cancelled cards", () => {
    const openSession = vi.fn()
    const view = render(() => (
      <ToolDisplay
        tool={subagent({
          metadata: { sessionID: childID },
          state: { type: "failed", message: "Provider quota exhausted" },
        })}
        onFileOpen={() => {}}
        actions={{ sessionHref, openSession, sessionStatus: () => "running" }}
      />
    ))

    const failed = screen.getByRole("link", { name: /explore Inspect the timeline Error: Provider quota exhausted/i })
    expect(screen.getByText("Provider quota exhausted")).toBeInTheDocument()
    expect(screen.queryByText("Failed")).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-component="loader"]')).not.toBeInTheDocument()
    fireEvent.click(failed)
    expect(openSession).toHaveBeenCalledWith(childID)

    view.unmount()
    render(() => (
      <ToolDisplay
        tool={subagent({ metadata: { sessionID: childID }, state: { type: "interrupted" } })}
        onFileOpen={() => {}}
        actions={{ sessionHref, openSession, sessionStatus: () => "idle" }}
      />
    ))
    expect(screen.getByRole("link", { name: /Cancelled/ })).toBeInTheDocument()
  })

  it("uses metadata before a newer matching historical child", () => {
    const openSession = vi.fn()
    render(() => (
      <ToolDisplay
        tool={subagent({
          metadata: { sessionID: childID },
          state: { type: "succeeded" },
        })}
        onFileOpen={() => {}}
        subagentNavigation={{
          parentID,
          sessions: [
            {
              id: fallbackChildID,
              parentID,
              title: "Inspect the timeline with newer data",
              createdAt: new Date(20),
            },
          ],
        }}
        actions={{ sessionHref, openSession, sessionStatus: () => "idle" }}
      />
    ))

    fireEvent.click(screen.getByRole("link"))
    expect(openSession).toHaveBeenCalledWith(childID)
  })

  it("falls back to the newest unarchived matching direct child", () => {
    const openSession = vi.fn()
    render(() => (
      <ToolDisplay
        tool={subagent({ state: { type: "succeeded" } })}
        onFileOpen={() => {}}
        subagentNavigation={{
          parentID,
          sessions: [
            { id: childID, parentID, title: "Inspect the timeline older", createdAt: new Date(10) },
            {
              id: "archived",
              parentID,
              title: "Inspect the timeline archived",
              archivedAt: new Date(30),
              createdAt: new Date(30),
            },
            {
              id: "foreign",
              parentID: "other-parent",
              title: "Inspect the timeline foreign",
              createdAt: new Date(40),
            },
            {
              id: fallbackChildID,
              parentID,
              title: "Inspect the timeline newest",
              createdAt: new Date(20),
            },
          ],
        }}
        actions={{ sessionHref, openSession, sessionStatus: () => "idle" }}
      />
    ))

    fireEvent.click(screen.getByRole("link"))
    expect(openSession).toHaveBeenCalledWith(fallbackChildID)
  })

  it("does not navigate when historical children do not match the description", () => {
    render(() => (
      <ToolDisplay
        tool={subagent({ state: { type: "succeeded", result: { sessionID: childID } } })}
        onFileOpen={() => {}}
        subagentNavigation={{
          parentID,
          sessions: [{ id: fallbackChildID, parentID, title: "Different task", createdAt: new Date(20) }],
        }}
      />
    ))

    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(document.querySelector('[data-component="subagent-tool"]')).toBeInTheDocument()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "leaves native modified navigation unintercepted for %o",
    (modifier) => {
      const openSession = vi.fn()
      render(() => (
        <ToolDisplay
          tool={subagent({ metadata: { sessionID: childID } })}
          onFileOpen={() => {}}
          actions={{ sessionHref, openSession, sessionStatus: () => "idle" }}
        />
      ))

      fireEvent.click(screen.getByRole("link"), modifier)
      expect(openSession).not.toHaveBeenCalled()
    },
  )
})
