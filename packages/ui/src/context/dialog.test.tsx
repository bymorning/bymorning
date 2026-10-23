import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createContext, createSignal, onCleanup, useContext } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { ActionMenu } from "@bymorning/ui/action-menu"
import { Dialog, DialogBody } from "@bymorning/ui/dialog"
import { DialogProvider, useDialog } from "@bymorning/ui/context/dialog"

afterEach(cleanup)

function TestDialog(props: { readonly name: string; readonly onEscapeKeyDown?: (event: KeyboardEvent) => void }) {
  const dialog = useDialog()
  return (
    <Dialog aria-label={props.name} {...(props.onEscapeKeyDown ? { onEscapeKeyDown: props.onEscapeKeyDown } : {})}>
      <DialogBody>
        <button type="button" autofocus onClick={() => dialog.close()}>
          Close {props.name}
        </button>
      </DialogBody>
    </Dialog>
  )
}

it("owns Kobalte focus, dismissal, restoration, and reactive active state", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <output>{dialog.active ? "active" : "idle"}</output>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="First" />)}>
          Show
        </button>
      </>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  const trigger = screen.getByRole("button", { name: "Show" })
  trigger.focus()
  await userEvent.setup().click(trigger)
  await waitFor(() => expect(screen.getByRole("button", { name: "Close First" })).toHaveFocus())
  expect(screen.getByRole("dialog", { name: "First" })).toBeInTheDocument()
  expect(screen.getByText("active")).toBeInTheDocument()

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.getByText("idle")).toBeInTheDocument()
})

it("replaces shown dialogs and layers pushed dialogs", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="First" />)}>
          First
        </button>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="Second" />)}>
          Second
        </button>
        <button type="button" onClick={() => dialog.push(() => <TestDialog name="Top" />)}>
          Push
        </button>
        <button type="button" onClick={() => dialog.close()}>
          Close top
        </button>
      </>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "First" }))
  await screen.findByRole("dialog", { name: "First" })
  fireEvent.click(screen.getByRole("button", { name: "Second", hidden: true }))
  await screen.findByRole("dialog", { name: "Second" })
  expect(screen.queryByRole("dialog", { name: "First" })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: "Push", hidden: true }))
  await screen.findByRole("dialog", { name: "Top" })
  expect(document.querySelectorAll('[data-dialog-layer="0"], [data-dialog-layer="1"]')).toHaveLength(2)
  fireEvent.click(screen.getByRole("button", { name: "Close top", hidden: true }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Top" })).not.toBeInTheDocument())
  expect(screen.getByRole("dialog", { name: "Second" })).toBeInTheDocument()
})

it("makes the covered dialog non-modal while another dialog is pushed", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="Base" />)}>
          Show
        </button>
        <button type="button" onClick={() => dialog.push(() => <TestDialog name="Top" />)}>
          Push
        </button>
        <button type="button" onClick={() => dialog.close()}>
          Close top
        </button>
      </>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  const base = await screen.findByRole("dialog", { name: "Base" })
  // Kobalte mounts its focus-trap sentinels on the content element only while the
  // dialog is open and modal, so their presence tracks the `modal` prop.
  expect(base.querySelectorAll("[data-focus-trap]")).toHaveLength(2)

  fireEvent.click(screen.getByRole("button", { name: "Push", hidden: true }))
  const top = await screen.findByRole("dialog", { name: "Top" })
  await waitFor(() => expect(base.querySelectorAll("[data-focus-trap]")).toHaveLength(0))
  expect(top.querySelectorAll("[data-focus-trap]")).toHaveLength(2)

  fireEvent.click(screen.getByRole("button", { name: "Close top", hidden: true }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Top" })).not.toBeInTheDocument())
  await waitFor(() => expect(base.querySelectorAll("[data-focus-trap]")).toHaveLength(2))
})

it("lets dialog content handle Escape before the provider closes it", async () => {
  const escape = vi.fn()
  function Workflow() {
    const [detail, setDetail] = createSignal(true)
    return (
      <TestDialog
        name={detail() ? "Detail" : "Picker"}
        onEscapeKeyDown={(event) => {
          escape()
          if (!detail()) return
          event.preventDefault()
          setDetail(false)
        }}
      />
    )
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <Workflow />)}>Show</button>
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  fireEvent.keyDown(await screen.findByRole("dialog", { name: "Detail" }), { key: "Escape" })
  expect(escape).toHaveBeenCalledOnce()
  expect(screen.getByRole("dialog", { name: "Picker" })).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Picker" }), { key: "Escape" })
  expect(escape).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("preserves caller context across replacement from a mounted dialog", async () => {
  const Caller = createContext("missing")
  function ContextDialog() {
    const dialog = useDialog()
    return (
      <Dialog aria-label="Context">
        <DialogBody>
          {useContext(Caller)}
          <button onClick={() => dialog.show(() => <Dialog aria-label="Replacement">{useContext(Caller)}</Dialog>)}>
            Replace
          </button>
        </DialogBody>
      </Dialog>
    )
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <ContextDialog />)}>Show</button>
  }
  render(() => (
    <DialogProvider>
      <Caller.Provider value="caller value">
        <Harness />
      </Caller.Provider>
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  expect(await screen.findByRole("dialog", { name: "Context" })).toHaveTextContent("caller value")
  fireEvent.click(screen.getByRole("button", { name: "Replace" }))
  expect(await screen.findByRole("dialog", { name: "Replacement" })).toHaveTextContent("caller value")
})

it("disposes mounted dialog roots when the provider unmounts", async () => {
  const disposed = vi.fn()
  function Tracked() {
    onCleanup(disposed)
    return <Dialog aria-label="Tracked" />
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <Tracked />)}>Show</button>
  }
  const view = render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  await screen.findByRole("dialog", { name: "Tracked" })

  view.unmount()
  expect(disposed).toHaveBeenCalledOnce()
})

it("closes the covered dialog when asked while the top dialog is still exiting", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="Base" />)}>
          Show
        </button>
        <button type="button" onClick={() => dialog.push(() => <TestDialog name="Top" />)}>
          Push
        </button>
        <button type="button" onClick={() => dialog.close()}>
          Close
        </button>
      </>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  await screen.findByRole("dialog", { name: "Base" })
  fireEvent.click(screen.getByRole("button", { name: "Push", hidden: true }))
  await screen.findByRole("dialog", { name: "Top" })

  fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }))
  fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("keeps menus opened inside a modal dialog in the accessibility tree", async () => {
  function MenuDialog() {
    return (
      <Dialog aria-label="Menus">
        <DialogBody>
          <ActionMenu label="Row">
            <ActionMenu.Item>Edit row</ActionMenu.Item>
          </ActionMenu>
        </DialogBody>
      </Dialog>
    )
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <MenuDialog />)}>Show</button>
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  const trigger = await screen.findByRole("button", { name: "Actions for Row" })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: "Enter" })
  const item = await screen.findByRole("menuitem", { name: "Edit row", hidden: true })
  // A sibling added to the body after the menu proves the dialog's hide-outside pass has run.
  const probe = document.body.appendChild(document.createElement("div"))
  await waitFor(() => expect(probe).toHaveAttribute("aria-hidden", "true"))
  expect(item.closest('[aria-hidden="true"]')).toBeNull()
  probe.remove()
})

it("moves focus into a pushed dialog while the covered dialog is still trapping", async () => {
  function Pushed() {
    return (
      <Dialog aria-label="Pushed">
        <DialogBody>
          <input aria-label="Pushed field" autofocus />
        </DialogBody>
      </Dialog>
    )
  }
  function Base() {
    const dialog = useDialog()
    return (
      <Dialog aria-label="Base">
        <DialogBody>
          <button type="button" autofocus onClick={() => dialog.push(() => <Pushed />)}>
            Push
          </button>
        </DialogBody>
      </Dialog>
    )
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <Base />)}>Show</button>
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  const push = await screen.findByRole("button", { name: "Push" })
  await waitFor(() => expect(push).toHaveFocus())
  fireEvent.click(push)
  await waitFor(() => expect(screen.getByLabelText("Pushed field")).toHaveFocus())
})
