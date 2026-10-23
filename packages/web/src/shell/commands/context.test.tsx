import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library"
import { createResource, createSignal, Show, startTransition, Suspense } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { DialogProvider } from "../../context/dialog"
import { SettingsProvider } from "../../context/settings"
import { CommandProvider, useCommand } from "./context"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

function mount(onSelect: () => void, extra: { readonly evenWhileTyping?: boolean } = {}) {
  const Harness = () => {
    useCommand().register("test", () => [
      { id: "test.command", title: "Test command", keybind: "mod+shift+o", onSelect, ...extra },
    ])
    return <input aria-label="Message" />
  }
  render(() => (
    <SettingsProvider storage={storage}>
      <DialogProvider>
        <CommandProvider>
          <Harness />
        </CommandProvider>
      </DialogProvider>
    </SettingsProvider>
  ))
}

it("does not fire a keybind while focus is inside an editable field by default", () => {
  const onSelect = vi.fn()
  mount(onSelect)
  const input = screen.getByRole("textbox", { name: "Message" })
  input.focus()
  fireEvent.keyDown(input, { key: "o", ctrlKey: true, shiftKey: true })
  expect(onSelect).not.toHaveBeenCalled()
})

it("fires a keybind marked evenWhileTyping while focus is inside an editable field", () => {
  const onSelect = vi.fn()
  mount(onSelect, { evenWhileTyping: true })
  const input = screen.getByRole("textbox", { name: "Message" })
  input.focus()
  fireEvent.keyDown(input, { key: "o", ctrlKey: true, shiftKey: true })
  expect(onSelect).toHaveBeenCalledOnce()
})

it("fires a keybind normally when focus is outside an editable field", () => {
  const onSelect = vi.fn()
  mount(onSelect)
  fireEvent.keyDown(window, { key: "o", ctrlKey: true, shiftKey: true })
  expect(onSelect).toHaveBeenCalledOnce()
})

it("drops a route's commands when a transition replaces it with a suspended route", async () => {
  const [route, setRoute] = createSignal<"session" | "home">("session")
  let commands!: ReturnType<typeof useCommand>
  const Session = () => {
    useCommand().register("session", () => [{ id: "session.command", title: "session" }])
    return <p>session</p>
  }
  const Home = () => {
    useCommand().register("home", () => [{ id: "home.command", title: "home" }])
    const [ready] = createResource(async () => {
      await Promise.resolve()
      return "home"
    })
    return (
      <Suspense>
        <p>{ready()}</p>
      </Suspense>
    )
  }
  const Capture = () => {
    commands = useCommand()
    return <></>
  }
  render(() => (
    <SettingsProvider storage={storage}>
      <DialogProvider>
        <CommandProvider>
          <Capture />
          <Show when={route() === "session"} fallback={<Home />}>
            <Session />
          </Show>
        </CommandProvider>
      </DialogProvider>
    </SettingsProvider>
  ))
  expect(commands.options().map((item) => item.id)).toEqual(["session.command"])
  await startTransition(() => setRoute("home"))
  expect(commands.options().map((item) => item.id)).toEqual(["home.command"])
})
