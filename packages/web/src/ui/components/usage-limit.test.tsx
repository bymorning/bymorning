import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library"
import { renderForm as render } from "../form-query.test-support"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { InlineLimit, Usage } from "./usage-limit"

afterEach(cleanup)

it("formats usage with its percentage and displays unavailable usage", () => {
  render(() => (
    <>
      <Usage usage={0.42} limit={42} />
      <Usage />
    </>
  ))
  expect(screen.getByText("(1%)")).toBeInTheDocument()
  expect(screen.getByText("$0.42")).toBeInTheDocument()
  expect(screen.getByText("—")).toBeInTheDocument()
})

it("omits the percentage when there is no limit", () => {
  render(() => <Usage usage={0.06} />)
  expect(screen.getByText("$0.06")).toBeInTheDocument()
  expect(screen.queryByText(/\(/)).not.toBeInTheDocument()
})

it("saves values and removes limits without submitting twice", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(() => <InlineLimit name="Production" value={100} editable onSave={save} />)

  await userEvent.click(screen.getByRole("button", { name: "Edit limit for Production" }))
  const input = screen.getByRole("textbox", { name: "Production limit (USD)" })
  await userEvent.clear(input)
  await userEvent.type(input, "25.50{Enter}")
  await waitFor(() => expect(save).toHaveBeenCalledWith(25.5))
  expect(save).toHaveBeenCalledOnce()

  await userEvent.click(screen.getByRole("button", { name: "Edit limit for Production" }))
  await userEvent.clear(screen.getByRole("textbox", { name: "Production limit (USD)" }))
  await userEvent.tab()
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(undefined))
  expect(save).toHaveBeenCalledTimes(2)
})

it("cancels with Escape and validates invalid values", async () => {
  const save = vi.fn()
  render(() => <InlineLimit name="Production" value={100} editable onSave={save} />)

  await userEvent.click(screen.getByRole("button", { name: "Edit limit for Production" }))
  await userEvent.clear(screen.getByRole("textbox", { name: "Production limit (USD)" }))
  await userEvent.type(screen.getByRole("textbox", { name: "Production limit (USD)" }), "12.345{Enter}")
  expect(screen.getByRole("alert")).toHaveTextContent("at most two decimal places")
  expect(save).not.toHaveBeenCalled()

  await userEvent.keyboard("{Escape}")
  expect(screen.getByRole("button", { name: "Edit limit for Production" })).toHaveTextContent("$100.00")
  expect(save).not.toHaveBeenCalled()
})

it("keeps the editor open and reports save failures", async () => {
  render(() => <InlineLimit name="Production" editable onSave={() => Promise.reject(new Error("Limit unavailable"))} />)
  await userEvent.click(screen.getByRole("button", { name: "Set limit for Production" }))
  await userEvent.type(screen.getByRole("textbox", { name: "Production limit (USD)" }), "10{Enter}")

  expect(await screen.findByRole("alert")).toHaveTextContent("Limit unavailable")
  expect(screen.getByRole("textbox", { name: "Production limit (USD)" })).toHaveValue("10")
})

it("exposes pending saves to assistive technology", async () => {
  render(() => <InlineLimit name="Production" editable onSave={() => new Promise(() => undefined)} />)
  await userEvent.click(screen.getByRole("button", { name: "Set limit for Production" }))
  await userEvent.type(screen.getByRole("textbox", { name: "Production limit (USD)" }), "10{Enter}")

  expect(screen.getByRole("status")).toHaveTextContent("Saving limit…")
  expect(document.querySelector('[data-component="inline-limit"]')).toHaveAttribute("aria-busy", "true")
  expect(screen.getByRole("textbox", { name: "Production limit (USD)" })).toBeDisabled()
})

it("keeps independent editors native, captures admitted values, and permits retry", async () => {
  let reject!: (cause: Error) => void
  const first = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    )
    .mockResolvedValue(undefined)
  const second = vi.fn(() => undefined)
  const view = render(() => (
    <>
      <InlineLimit name="First" editable onSave={first} />
      <InlineLimit name="Second" editable local onSave={second} />
    </>
  ))
  await userEvent.click(screen.getByRole("button", { name: "Set limit for First" }))
  const input = screen.getByRole("textbox", { name: "First limit (USD)" })
  fireEvent.input(input, { target: { value: "10" } })
  fireEvent.keyDown(input, { key: "Enter" })
  fireEvent.blur(input)
  fireEvent.input(input, { target: { value: "90" } })
  await waitFor(() => expect(first).toHaveBeenCalledOnce())
  expect(first).toHaveBeenCalledWith(10)
  await userEvent.click(screen.getByRole("button", { name: "Set local limit for Second" }))
  await userEvent.type(screen.getByRole("textbox", { name: "Second local limit (USD)" }), "20{Enter}")
  expect(second).toHaveBeenCalledExactlyOnceWith(20)
  expect(input).toBeDisabled()
  const cause = new Error("Rejected limit")
  reject(cause)
  expect(await screen.findByRole("alert")).toHaveTextContent("Rejected limit")
  expect(
    view.client
      .getMutationCache()
      .getAll()
      .find((item) => item.state.status === "error")?.state.error,
  ).toBe(cause)
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(screen.getByRole("button", { name: "Set limit for First" })).toBeInTheDocument())
  expect(first).toHaveBeenCalledTimes(2)
  expect(first).toHaveBeenLastCalledWith(10)
})
