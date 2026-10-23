import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { Dialog, DialogBody } from "@bymorning/ui/dialog"
import { ActionMenu } from "@bymorning/ui/action-menu"
import { DialogProvider, useDialog } from "@bymorning/ui/context/dialog"

afterEach(cleanup)

function MenuFixture(props: { readonly label?: string; readonly onSelect?: () => void }) {
  return (
    <ActionMenu label={props.label ?? "Model One"}>
      <ActionMenu.Item disabled>Unavailable</ActionMenu.Item>
      <ActionMenu.Item {...(props.onSelect ? { onSelect: props.onSelect } : {})}>Edit</ActionMenu.Item>
      <ActionMenu.Item>Remove</ActionMenu.Item>
    </ActionMenu>
  )
}

function item(name: string) {
  return screen.getAllByRole("menuitem", { hidden: true }).find((element) => element.textContent === name)!
}

it("uses a Kobalte portal and selects an action", async () => {
  const onSelect = vi.fn()
  render(() => (
    <>
      <MenuFixture onSelect={onSelect} />
    </>
  ))

  await userEvent.setup().click(screen.getByRole("button", { name: "Actions for Model One" }))
  const menu = screen.getByRole("menu", { hidden: true })
  expect(document.body).toContainElement(menu)
  await userEvent.setup().click(item("Edit"))
  expect(onSelect).toHaveBeenCalledOnce()
})

it.each([
  ["Enter", "Edit"],
  [" ", "Edit"],
  ["ArrowDown", "Edit"],
  ["ArrowUp", "Remove"],
])("uses Kobalte keyboard opening and enabled-item focus for %s", async (key, focused) => {
  render(() => (
    <>
      <MenuFixture />
    </>
  ))
  const trigger = screen.getByRole("button", { name: "Actions for Model One" })
  trigger.focus()
  fireEvent.keyDown(trigger, { key })

  await waitFor(() => expect(item(focused)).toHaveFocus())
  expect(item("Unavailable")).toHaveAttribute("data-disabled")
})

it("dismisses on Escape and restores trigger focus", async () => {
  render(() => (
    <>
      <MenuFixture />
    </>
  ))
  const trigger = screen.getByRole("button", { name: "Actions for Model One" })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: "ArrowDown" })
  const menu = screen.getByRole("menu", { hidden: true })
  await waitFor(() => expect(item("Edit")).toHaveFocus())
  fireEvent.animationStart(menu)
  fireEvent.keyDown(menu, { key: "Escape" })
  fireEvent.animationEnd(menu)

  await waitFor(() => expect(trigger).toHaveFocus())
  expect(trigger).toHaveAttribute("aria-expanded", "false")
})

it("keeps rapid menus independent and tolerates trigger unmount", async () => {
  const view = render(() => (
    <>
      <MenuFixture label="First" />
      <MenuFixture label="Second" />
    </>
  ))
  const first = screen.getByRole("button", { name: "Actions for First" })
  const second = screen.getByRole("button", { name: "Actions for Second" })
  await userEvent.setup().click(first)
  await userEvent.setup().click(second)
  expect(first).toHaveAttribute("aria-expanded", "false")
  expect(second).toHaveAttribute("aria-expanded", "true")
  view.unmount()
  expect(screen.queryByRole("menu", { hidden: true })).not.toBeInTheDocument()
})

it("renders a Kobalte portal with stacked dialogs", async () => {
  function NestedDialog(props: { readonly name: string }) {
    const dialog = useDialog()
    return (
      <Dialog aria-label={props.name}>
        <DialogBody>
          <MenuFixture label={props.name} />
          {props.name === "First dialog" && (
            <button onClick={() => dialog.push(() => <NestedDialog name="Second dialog" />)}>Push dialog</button>
          )}
        </DialogBody>
      </Dialog>
    )
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <NestedDialog name="First dialog" />)}>Open</button>
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  await userEvent.setup().click(screen.getByRole("button", { name: "Open" }))
  await userEvent.setup().click(await screen.findByRole("button", { name: "Push dialog" }))
  await userEvent.setup().click(await screen.findByRole("button", { name: "Actions for Second dialog" }))
  const dialog = screen.getByRole("dialog", { name: "Second dialog" })
  expect(dialog).toBeInTheDocument()
  expect(document.body).toContainElement(screen.getByRole("menu", { hidden: true }))
})
