import { A, createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { cleanup, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { afterEach, expect, test } from "vitest"

import { DialogProvider } from "../context/dialog"
import { renderForm as render } from "../ui/form-query.test-support"
import { useLeaveGuard } from "./leave-guard"

afterEach(cleanup)

function mount(initialDirty: boolean) {
  const history = createMemoryHistory()
  history.set({ value: "/form" })
  const [dirty, setDirty] = createSignal(initialDirty)
  const Form = () => {
    useLeaveGuard(dirty)
    return <A href="/other">Leave</A>
  }
  render(() => (
    <DialogProvider>
      <MemoryRouter history={history}>
        <Route path="/form" component={Form} />
        <Route path="/other" component={() => <p>Other page</p>} />
      </MemoryRouter>
    </DialogProvider>
  ))
  return { setDirty }
}

test("a clean form leaves without asking", async () => {
  mount(false)
  await userEvent.click(screen.getByRole("link", { name: "Leave" }))
  expect(await screen.findByText("Other page")).toBeInTheDocument()
})

test("a dirty form asks first and stays when cancelled", async () => {
  mount(true)
  await userEvent.click(screen.getByRole("link", { name: "Leave" }))
  expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument()
  expect(screen.queryByText("Other page")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument())
  expect(screen.getByRole("link", { name: "Leave" })).toBeInTheDocument()
})

test("confirming discards the changes and navigates", async () => {
  mount(true)
  await userEvent.click(screen.getByRole("link", { name: "Leave" }))
  await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }))
  expect(await screen.findByText("Other page")).toBeInTheDocument()
})
