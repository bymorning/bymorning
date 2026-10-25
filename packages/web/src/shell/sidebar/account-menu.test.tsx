import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it } from "vitest"

import { AccountMenu, initial } from "./account-menu"

afterEach(cleanup)

it("derives the avatar initial from the identity", () => {
  expect(initial("developer@local.test")).toBe("D")
  expect(initial("  éva@example.com")).toBe("É")
  expect(initial("")).toBe("")
  const { container } = render(() => (
    <AccountMenu
      identity="developer@local.test"
      workspaceName="Default"
      scheme="light"
      onSchemeChange={() => {}}
      onLogout={() => {}}
    />
  ))
  expect(container.querySelector('[data-slot="account-avatar"]')).toHaveTextContent("D")
})

it("delegates controlled theme changes and logout to its owner", async () => {
  const schemes: Array<string> = []
  const logouts: Array<true> = []
  render(() => (
    <AccountMenu
      identity="Account"
      workspaceName="Test"
      scheme="light"
      onSchemeChange={(scheme) => schemes.push(scheme)}
      onLogout={() => logouts.push(true)}
    />
  ))

  const trigger = screen.getByRole("button", { name: "Open account menu" })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  expect(screen.queryByRole("menuitem", { name: "Console" })).not.toBeInTheDocument()
  expect(screen.queryByRole("menuitem", { name: /Switch workspace/ })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("menuitem", { name: /Theme/ }))
  expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "true")
  expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "false")
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }))
  expect(schemes).toEqual(["dark"])
  // Choosing a theme closes the whole menu.
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"))

  trigger.focus()
  await userEvent.keyboard("{Enter}")
  await userEvent.click(screen.getByRole("menuitem", { name: "Log Out" }))
  expect(logouts).toEqual([true])
})

it("defers opening Login sessions until the menu finishes closing", async () => {
  const opens: Array<true> = []
  render(() => (
    <AccountMenu
      identity="Account"
      workspaceName="Test"
      scheme="light"
      onOpenSessions={() => opens.push(true)}
      onSchemeChange={() => undefined}
      onLogout={() => undefined}
    />
  ))

  const trigger = screen.getByRole("button", { name: "Open account menu" })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  await userEvent.click(screen.getByRole("menuitem", { name: "Login sessions" }))
  // The action is stashed on selection and runs from the content's close
  // auto-focus; mounting the dialog from onSelect races the menu's focus and
  // aria-hidden teardown. jsdom never finishes the close animation, so the
  // deferred call is covered by the e2e application suite instead.
  expect(opens).toEqual([])
})

it("gates the Console entry on availability and delegates opening to its owner", async () => {
  const opens: Array<true> = []
  render(() => (
    <AccountMenu
      identity="Account"
      workspaceName="Test"
      scheme="light"
      consoleAvailable
      onOpenConsole={() => opens.push(true)}
      onSchemeChange={() => undefined}
      onLogout={() => undefined}
    />
  ))

  const trigger = screen.getByRole("button", { name: "Open account menu" })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  await userEvent.click(screen.getByRole("menuitem", { name: "Console" }))
  expect(opens).toEqual([true])
})
