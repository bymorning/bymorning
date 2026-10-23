import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it } from "vitest"

import { MaterialPicker } from "./material-picker"

afterEach(cleanup)

it("searches, restores focus, and keeps its footer available", async () => {
  let selected = "alpha"
  let created = false
  render(() => (
    <MaterialPicker
      items={[{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }]}
      key={(item) => item.id}
      label={(item) => item.name}
      selected={selected}
      searchLabel="Search things"
      emptyLabel="No things found"
      triggerLabel="Thing"
      trigger={<span>Alpha</span>}
      leading={(item) => <span>{item.name.slice(0, 1)}</span>}
      onSelect={(item) => { selected = item.id }}
      footer={{ label: "Create Thing", icon: <span>+</span>, onSelect: () => { created = true } }}
    />
  ))

  const trigger = screen.getByRole("button", { name: "Thing" })
  await userEvent.click(trigger)
  const search = screen.getByRole("textbox", { name: "Search things" })
  await waitFor(() => expect(search).toHaveFocus())
  expect(screen.getByRole("menuitemradio", { name: "Alpha" })).toHaveAttribute("data-checked")
  await userEvent.type(search, "missing")
  expect(screen.getByText("No things found")).toBeInTheDocument()
  expect(screen.getByRole("menuitem", { name: "Create Thing" })).toBeInTheDocument()
  await userEvent.keyboard("{Escape}")
  await waitFor(() => expect(trigger).toHaveFocus())

  expect(selected).toBe("alpha")
  expect(created).toBe(false)
})

it("selects the filtered result with ArrowDown and Enter", async () => {
  let selected = "alpha"
  render(() => (
    <MaterialPicker
      items={[{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }]}
      key={(item) => item.id}
      label={(item) => item.name}
      selected={selected}
      searchLabel="Search things"
      emptyLabel="No things found"
      triggerLabel="Thing"
      trigger={<span>Alpha</span>}
      leading={(item) => <span>{item.name.slice(0, 1)}</span>}
      onSelect={(item) => { selected = item.id }}
    />
  ))
  await userEvent.click(screen.getByRole("button", { name: "Thing" }))
  const search = screen.getByRole("textbox", { name: "Search things" })
  await waitFor(() => expect(search).toHaveFocus())
  await userEvent.type(search, "bet")
  await userEvent.keyboard("{ArrowDown}")
  expect(screen.getByRole("menuitemradio", { name: "Beta" })).toHaveFocus()
  await userEvent.keyboard("{Enter}")
  await waitFor(() => expect(selected).toBe("beta"))
  expect(screen.getByRole("button", { name: "Thing" })).toHaveAttribute("aria-expanded", "false")
})

it("runs the final footer action after closing", async () => {
  let created = false
  render(() => (
    <MaterialPicker
      items={[]}
      key={() => ""}
      label={() => ""}
      searchLabel="Search things"
      emptyLabel="No things found"
      triggerLabel="Thing"
      trigger={<span>None</span>}
      leading={() => <span />}
      onSelect={() => undefined}
      footer={{ label: "Create Thing", icon: <span>+</span>, onSelect: () => { created = true } }}
    />
  ))
  await userEvent.click(screen.getByRole("button", { name: "Thing" }))
  await userEvent.click(screen.getByRole("menuitem", { name: "Create Thing" }))
  await waitFor(() => expect(created).toBe(true))
})
