import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createContext, createSignal, onCleanup, useContext } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"

import { ActionMenu } from "../ui/components/action-menu"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "../ui/components/dialog"
import { DialogProvider, useDialog, useEntry } from "./dialog"

afterEach(cleanup)

function TestDialog(props: {
  readonly name: string
  readonly onEscapeKeyDown?: (event: KeyboardEvent) => void
}) {
  const dialog = useDialog()
  return (
    <Dialog
      aria-label={props.name}
      {...(props.onEscapeKeyDown ? { onEscapeKeyDown: props.onEscapeKeyDown } : {})}
    >
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

it("returns focus to the menu trigger after a dialog opened from a menu item closes", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <ActionMenu label="row">
        <ActionMenu.Item onSelect={() => dialog.show(() => <TestDialog name="Edit" />)}>Edit</ActionMenu.Item>
      </ActionMenu>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Actions for row" })
  await user.click(trigger)
  const menu = await waitFor(() => {
    const element = document.getElementById(trigger.getAttribute("aria-controls") ?? "")
    expect(element).toBeInTheDocument()
    return element!
  })
  const item = within(menu).getAllByRole("menuitem", { hidden: true }).find((candidate) => candidate.textContent === "Edit")!
  item.focus()
  expect(item).toHaveFocus()
  await user.keyboard("{Enter}")
  await waitFor(() => expect(screen.getByRole("button", { name: "Close Edit" })).toHaveFocus())

  await user.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})

it("leaves focus the user moved while the closing dialog was still on the stack", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <output>{dialog.active ? "active" : "idle"}</output>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="First" />)}>
          Show
        </button>
        <button type="button">Elsewhere</button>
      </>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))
  const user = userEvent.setup()
  const show = screen.getByRole("button", { name: "Show" })
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" })
  await user.click(show)
  await waitFor(() => expect(screen.getByRole("button", { name: "Close First" })).toHaveFocus())

  await user.keyboard("{Escape}")
  // The provider removes the closing entry 100ms later; the user acts before that.
  expect(screen.getByText("active")).toBeInTheDocument()
  elsewhere.focus()

  await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument())
  expect(elsewhere).toHaveFocus()
})

it("replaces shown dialogs and layers pushed dialogs", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="First" />)}>First</button>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="Second" />)}>Second</button>
        <button type="button" onClick={() => dialog.push(() => <TestDialog name="Top" />)}>Push</button>
        <button type="button" onClick={() => dialog.close()}>Close top</button>
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
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="Base" />)}>Show</button>
        <button type="button" onClick={() => dialog.push(() => <TestDialog name="Top" />)}>Push</button>
        <button type="button" onClick={() => dialog.close()}>Close top</button>
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

it("keeps the covered dialog open when the user clicks inside the pushed dialog", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <>
        <button type="button" onClick={() => dialog.show(() => <TestDialog name="Base" />)}>Show</button>
        <button type="button" onClick={() => dialog.push(() => <TestDialog name="Top" />)}>Push</button>
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
  const top = await screen.findByRole("dialog", { name: "Top" })

  // A real click moves focus into the top dialog, which is "outside" the now non-modal base.
  await userEvent.click(within(top).getByRole("button", { name: "Close Top" }))
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Top" })).not.toBeInTheDocument())
  expect(await screen.findByRole("dialog", { name: "Base" })).toBeInTheDocument()
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

it("dismisses on a click that lands outside the dialog's own content", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <button type="button" onClick={() => dialog.show(() => <TestDialog name="First" />)}>
        Show
      </button>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  const trigger = screen.getByRole("button", { name: "Show" })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = await screen.findByRole("dialog", { name: "First" })
  // Kobalte's modal dismissable layer forces this full-viewport node's own
  // `pointer-events` to `auto`, so a click landing on it directly (rather than
  // bubbling up from the visible content box) is a click outside the dialog.
  fireEvent.click(dialog)
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "First" })).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
})

it("keeps the dialog open when a click bubbles up from inside its content", async () => {
  function Harness() {
    const dialog = useDialog()
    return (
      <button type="button" onClick={() => dialog.show(() => <TestDialog name="First" />)}>
        Show
      </button>
    )
  }
  render(() => (
    <DialogProvider>
      <Harness />
    </DialogProvider>
  ))

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  const dialog = await screen.findByRole("dialog", { name: "First" })
  fireEvent.click(dialog.querySelector('[data-slot="dialog-body"]')!)
  expect(screen.getByRole("dialog", { name: "First" })).toBeInTheDocument()
})

it("uses an entry guard for Escape, overlay, close button, and custom Cancel", async () => {
  function Guarded() {
    const entry = useEntry()
    entry.guard(() => true)
    return <Dialog aria-label="Guarded"><DialogHeader><DialogTitle>Guarded</DialogTitle></DialogHeader><DialogBody><button onClick={() => entry.dismiss()}>Cancel</button></DialogBody></Dialog>
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <Guarded />)}>Show</button>
  }
  render(() => <DialogProvider><Harness /></DialogProvider>)
  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  const dialog = await screen.findByRole("dialog", { name: "Guarded" })
  fireEvent.keyDown(dialog, { key: "Escape" })
  fireEvent.click(document.querySelector('[data-component="dialog-overlay"]')!)
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.getByRole("dialog", { name: "Guarded" })).toBeInTheDocument()
})

it("ignores a stale entry completion after replacement", async () => {
  let staleClose!: () => void
  function First() {
    const entry = useEntry()
    staleClose = () => entry.close()
    return <Dialog aria-label="First"><DialogBody><button onClick={() => entry.replace(() => <Dialog aria-label="Second" />)}>Replace</button></DialogBody></Dialog>
  }
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <First />)}>Show</button>
  }
  render(() => <DialogProvider><Harness /></DialogProvider>)
  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  fireEvent.click(await screen.findByRole("button", { name: "Replace" }))
  await screen.findByRole("dialog", { name: "Second" })
  staleClose()
  expect(screen.getByRole("dialog", { name: "Second" })).toBeInTheDocument()
})

it("finishes a closing entry after a dialog is pushed during its close animation", async () => {
  let first!: ReturnType<typeof useEntry>
  const disposed = vi.fn()
  function First() {
    first = useEntry()
    onCleanup(disposed)
    return <Dialog aria-label="First" />
  }
  function Harness() {
    const dialog = useDialog()
    return <>
      <button onClick={() => dialog.show(() => <First />)}>Show</button>
      <button onClick={() => dialog.push(() => <Dialog aria-label="Top" />)}>Push</button>
    </>
  }
  render(() => <DialogProvider><Harness /></DialogProvider>)

  fireEvent.click(screen.getByRole("button", { name: "Show" }))
  await screen.findByRole("dialog", { name: "First" })
  first.close()
  fireEvent.click(screen.getByRole("button", { name: "Push", hidden: true }))
  await screen.findByRole("dialog", { name: "Top" })
  first.replace(() => <Dialog aria-label="Stale replacement" />)

  await waitFor(() => expect(disposed).toHaveBeenCalledOnce())
  expect(screen.getByRole("dialog", { name: "Top" })).toBeInTheDocument()
  expect(screen.queryByRole("dialog", { name: "Stale replacement", hidden: true })).not.toBeInTheDocument()
})

it("finishes dismissal when an onClose callback throws", async () => {
  const failure = new Error("close callback failed")
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined)
  function Harness() {
    const dialog = useDialog()
    return <button onClick={() => dialog.show(() => <TestDialog name="Throwing" />, () => { throw failure })}>Show</button>
  }
  render(() => <DialogProvider><Harness /></DialogProvider>)

  const trigger = screen.getByRole("button", { name: "Show" })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole("button", { name: "Close Throwing" }))

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(report).toHaveBeenCalledWith(failure)
})
