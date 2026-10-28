import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SessionHeader } from "./session-header"
import { BackgroundHint } from "./subagent-background"
import { OverlayHost } from "../../../ui/components/overlay-host"
import { BmUiI18nProvider, createBmUiI18n } from "../../../ui/context/i18n"

function menuItem(name: string) {
  return screen.getAllByRole("menuitem", { hidden: true }).find((element) => element.textContent === name)!
}

afterEach(cleanup)

describe("SessionHeader", () => {
  it("localizes the background hint and composed accessible name", () => {
    const i18n = createBmUiI18n(() => "es", {
      "ui.session.background.hint": "Continuar en segundo plano",
      "ui.session.background.keybind": "Control+Be",
      "ui.session.background.hintLabel": ({ shortcut }) => `Continuar en segundo plano, ${shortcut}`,
    })
    render(() => (
      <BmUiI18nProvider value={i18n}>
        <BackgroundHint />
      </BmUiI18nProvider>
    ))

    expect(screen.getByRole("status", { name: "Continuar en segundo plano, Control+Be" })).toHaveTextContent(
      "Continuar en segundo plano",
    )
    expect(screen.getByLabelText("Control+Be")).toBeInTheDocument()
    expect(screen.getByText("Control")).toBeInTheDocument()
    expect(screen.getByText("Be")).toBeInTheDocument()
  })

  it("localizes background counts, kinds, actions, and accessible task status", () => {
    const i18n = createBmUiI18n(() => "es", {
      "ui.session.background.heading": "Trabajo en segundo plano",
      "ui.session.background.summary": ({ count }) => `${count} tareas activas`,
      "ui.session.background.subagent": "Subagente",
      "ui.session.background.shell": "Terminal",
      "ui.session.background.shellCommand": "Comando de terminal",
      "ui.session.background.delegatedTask": "Tarea delegada",
      "ui.session.background.working": "Trabajando",
      "ui.session.background.open": "Abrir",
      "ui.session.background.openTask": ({ title }) => `Abrir tarea ${title}`,
      "ui.session.background.taskLabel": ({ kind, title, description, status }) =>
        `${kind}: ${title}; ${description}; ${status}`,
    })
    render(() => (
      <BmUiI18nProvider value={i18n}>
        <SessionHeader
          title="Parent"
          workspace="Morning workspace"
          backgroundTasks={[
            { id: "subagent:child:1", kind: "subagent", sessionID: "child" },
            { id: "shell:command:1", kind: "shell" },
          ]}
          sessionHref={(id) => `#session-${id}`}
          openSession={() => {}}
          sidebarOpen={false}
          sidebarRef={() => {}}
          toggleSidebar={() => {}}
        />
      </BmUiI18nProvider>
    ))

    expect(screen.getByText("2 tareas activas")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Trabajo en segundo plano" })).toBeInTheDocument()
    expect(screen.getByText("Subagente")).toBeInTheDocument()
    expect(screen.getByText("Tarea delegada")).toBeInTheDocument()
    expect(screen.getByText("Terminal")).toBeInTheDocument()
    expect(screen.getByText("Comando de terminal")).toBeInTheDocument()
    expect(
      screen.getByRole("listitem", { name: "Subagente: Subagente; Tarea delegada; Trabajando" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("listitem", { name: "Terminal: Terminal; Comando de terminal; Trabajando" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Abrir tarea Subagente" })).toHaveTextContent("Abrir")
  })

  it("renders session identity, context, rename, and the controlled sidebar action", async () => {
    const [open, setOpen] = createSignal(false)
    const [title, setTitle] = createSignal("Morning plan")
    const toggle = vi.fn(() => setOpen((value) => !value))
    const sidebarRef = vi.fn()
    const rename = vi.fn(async (value: string) => {
      setTitle(value)
      return true
    })
    render(() => (
      <SessionHeader
        title={title()}
        workspace="Morning workspace"
        project={{ name: "Timeline project" }}
        usage={{ tokens: 12_345, cost: 0.42, costComplete: true, percentage: 6 }}
        rename={rename}
        sidebarOpen={open()}
        sidebarRef={sidebarRef}
        toggleSidebar={toggle}
      />
    ))

    const header = document.querySelector('[data-component="session-header"]')
    expect(header).toHaveAttribute("data-session-title")
    expect(screen.getByLabelText("Project Timeline project in workspace Morning workspace")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Context usage: 6%, 12,345 tokens, $0.42" })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: "Rename session Morning plan" }))
    const input = screen.getByRole("textbox", { name: "Session title" })
    await waitFor(() => expect(input).toHaveFocus())
    await userEvent.setup().clear(input)
    await userEvent.setup().type(input, "Renamed session{Enter}")
    expect(rename).toHaveBeenCalledWith("Renamed session")
    expect(await screen.findByRole("heading", { name: "Renamed session" })).toBeInTheDocument()

    const files = screen.getByRole("button", { name: "Right sidebar" })
    expect(sidebarRef).toHaveBeenCalledWith(files)
    expect(files).toHaveAttribute("data-size", "large")
    expect(files).toHaveAttribute("data-variant", "ghost-muted")
    expect(files).toHaveAttribute("aria-pressed", "false")
    await userEvent.setup().click(files)
    expect(toggle).toHaveBeenCalledOnce()
    expect(files).toHaveAttribute("aria-pressed", "true")
    expect(files).not.toBeVisible()
  })

  it("archives from the session actions menu", async () => {
    const archive = vi.fn(async () => true)
    render(() => (
      <OverlayHost>
        <SessionHeader
          title="Morning plan"
          workspace="Morning workspace"
          archive={archive}
          sidebarOpen={false}
          sidebarRef={() => {}}
          toggleSidebar={() => {}}
        />
      </OverlayHost>
    ))

    await userEvent.setup().click(screen.getByRole("button", { name: "Session actions" }))
    await userEvent.setup().click(menuItem("Archive session"))
    expect(archive).toHaveBeenCalledOnce()
  })

  it("restores an archived Session from the session actions menu", async () => {
    const archive = vi.fn(async () => true)
    render(() => (
      <OverlayHost>
        <SessionHeader
          title="Morning plan"
          workspace="Morning workspace"
          archived
          archive={archive}
          sidebarOpen={false}
          sidebarRef={() => {}}
          toggleSidebar={() => {}}
        />
      </OverlayHost>
    ))

    await userEvent.setup().click(screen.getByRole("button", { name: "Session actions" }))
    await userEvent.setup().click(menuItem("Restore session"))
    expect(archive).toHaveBeenCalledOnce()
  })

  it.each(["New session", "New session - 2026-09-13T12:00:00.000Z", ""])(
    "shows Untitled instead of colliding with New session for %j",
    (title) => {
      render(() => (
        <SessionHeader
          title={title}
          workspace="Morning workspace"
          rename={async () => true}
          sidebarOpen={false}
          sidebarRef={() => {}}
          toggleSidebar={() => {}}
        />
      ))

      expect(screen.getByRole("heading", { name: "Untitled" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Rename session Untitled" })).toBeInTheDocument()
      expect(screen.queryByRole("heading", { name: /New session/ })).not.toBeInTheDocument()
    },
  )

  it("selects the existing title on edit and restores it when the title is emptied", async () => {
    const rename = vi.fn(async () => true)
    render(() => (
      <SessionHeader
        title="Morning plan"
        workspace="Morning workspace"
        rename={rename}
        sidebarOpen={false}
        sidebarRef={() => {}}
        toggleSidebar={() => {}}
      />
    ))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Rename session Morning plan" }))
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Session title" })
    await waitFor(() => expect(input).toHaveFocus())
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Morning plan".length])
    await user.clear(input)
    await user.keyboard("{Enter}")
    expect(rename).not.toHaveBeenCalled()
    expect(screen.queryByRole("textbox", { name: "Session title" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Morning plan" })).toBeInTheDocument()
  })

  it("renders a parent breadcrumb and running status without offering child rename", () => {
    const navigate = vi.fn()
    render(() => (
      <SessionHeader
        title="Child session"
        workspace="Morning workspace"
        parent={{ title: "Parent session", href: "/session/parent", navigate }}
        status="running"
        rename={async () => true}
        sidebarOpen={false}
        sidebarRef={() => {}}
        toggleSidebar={() => {}}
      />
    ))

    const parent = screen.getByRole("link", { name: "Parent session" })
    expect(parent).toHaveAttribute("href", "/session/parent")
    fireEvent.click(parent)
    expect(navigate).toHaveBeenCalledOnce()
    expect(screen.getByRole("heading", { name: "Child session" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Rename session/ })).not.toBeInTheDocument()
    expect(screen.getByRole("status", { name: "Session status: Running" })).toHaveTextContent("Session status: Running")
  })

  it("exposes incomplete context spend as a known subtotal", () => {
    render(() => (
      <SessionHeader
        title="Session"
        workspace="Workspace"
        usage={{ tokens: 10, cost: 0.42, costComplete: false }}
        sidebarOpen={false}
        sidebarRef={() => {}}
        toggleSidebar={() => {}}
      />
    ))

    expect(
      screen.getByRole("img", {
        name: "Context usage: 0%, 10 tokens, at least $0.42; known subtotal; pricing incomplete",
      }),
    ).toBeInTheDocument()
  })

  it.each([undefined, "idle" as const])("renders no aggregate indicator for %s status", (status) => {
    render(() => (
      <SessionHeader
        title="Session"
        workspace="Morning workspace"
        {...(status === undefined ? {} : { status })}
        sidebarOpen={false}
        sidebarRef={() => {}}
        toggleSidebar={() => {}}
      />
    ))

    expect(screen.queryByRole("status", { name: /Session status/ })).not.toBeInTheDocument()
  })

  it("allows locales to reorder the complete status label", () => {
    const i18n = createBmUiI18n(() => "reordered", {
      "ui.session.status.running": "In progress",
      "ui.session.statusLabel": ({ status }) => `${status} — current session status`,
    })
    render(() => (
      <BmUiI18nProvider value={i18n}>
        <SessionHeader
          title="Session"
          workspace="Morning workspace"
          status="running"
          sidebarOpen={false}
          sidebarRef={() => {}}
          toggleSidebar={() => {}}
        />
      </BmUiI18nProvider>
    ))

    expect(screen.getByRole("status", { name: "In progress — current session status" })).toHaveTextContent(
      "In progress — current session status",
    )
  })

  it("presents mixed background tasks in details and preserves modified child-link clicks", () => {
    const openSession = vi.fn()
    render(() => (
      <SessionHeader
        title="Parent"
        workspace="Morning workspace"
        backgroundTasks={[
          {
            id: "subagent:child:1",
            kind: "subagent",
            title: "Explore",
            description: "Map ownership",
            sessionID: "child",
          },
          { id: "shell:shell:1", kind: "shell", title: "Shell", description: "bun test" },
        ]}
        sessionHref={(id) => `#session-${id}`}
        openSession={openSession}
        sidebarOpen={false}
        sidebarRef={() => {}}
        toggleSidebar={() => {}}
      />
    ))

    const details = screen.getByRole("group")
    expect(screen.getByText("2 tasks in background")).toBeInTheDocument()
    details.setAttribute("open", "")
    const child = screen.getByRole("link", { name: "Open background task Explore" })
    expect(child).toHaveAttribute("href", "#session-child")
    fireEvent.click(child, { ctrlKey: true })
    expect(openSession).not.toHaveBeenCalled()
    fireEvent.click(child)
    expect(openSession).toHaveBeenCalledWith("child")
    expect(screen.getByText("bun test")).toBeInTheDocument()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "leaves native modified parent navigation unintercepted for %o",
    (modifier) => {
      const navigate = vi.fn()
      render(() => (
        <SessionHeader
          title="Child session"
          workspace="Morning workspace"
          parent={{ title: "Parent session", href: "#parent", navigate }}
          sidebarOpen={false}
          sidebarRef={() => {}}
          toggleSidebar={() => {}}
        />
      ))

      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifier })
      screen.getByRole("link", { name: "Parent session" }).dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(navigate).not.toHaveBeenCalled()
    },
  )
})
