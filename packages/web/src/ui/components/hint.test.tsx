import { cleanup, render, screen, waitFor } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, test } from "vitest"

import { Hint } from "./hint"

afterEach(cleanup)

/** Kobalte keeps a closed tooltip mounted until its exit animation ends, which jsdom never fires. */
const expectClosed = () =>
  waitFor(() => {
    const tooltip = screen.queryByRole("tooltip")
    expect(tooltip === null || tooltip.hasAttribute("data-closed")).toBe(true)
  })
const expectOpen = async () => {
  const tooltip = await screen.findByRole("tooltip")
  await waitFor(() => expect(tooltip).not.toHaveAttribute("data-closed"))
  return tooltip
}

test("toggles its explanation on click and closes it on Escape", async () => {
  render(() => <Hint text="Resets on the first of the month." />)
  const trigger = screen.getByRole("button", { name: "Resets on the first of the month." })
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

  await userEvent.click(trigger)
  expect(await expectOpen()).toHaveTextContent("Resets on the first of the month.")

  await userEvent.keyboard("{Escape}")
  await expectClosed()

  await userEvent.click(trigger)
  await expectOpen()
  await userEvent.click(trigger)
  await expectClosed()
})
