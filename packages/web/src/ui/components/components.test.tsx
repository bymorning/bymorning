import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "./button"
import { Checkbox } from "./checkbox"
import { Field } from "./field"
import { TextInput } from "./text-input"

afterEach(cleanup)

describe(" components", () => {
  it("renders and delegates a standalone button action", async () => {
    const onClick = vi.fn()
    render(() => <Button onClick={onClick}>Continue</Button>)

    const button = screen.getByRole("button", { name: "Continue" })
    expect(button).toHaveAttribute("data-component", "button")
    await userEvent.setup().click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("exposes Kobalte checkbox state and changes", async () => {
    const onChange = vi.fn()
    render(() => <Checkbox label="Notifications" onChange={onChange} />)

    const checkbox = screen.getByRole("checkbox", { name: "Notifications" })
    await userEvent.setup().click(checkbox)
    expect(checkbox).toBeChecked()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("uses an explicit control aria-label before the Field label", () => {
    render(() => (
      <Field>
        <Field.Label>Account name</Field.Label>
        <TextInput aria-label="Custom account name" />
      </Field>
    ))

    expect(screen.getByRole("textbox", { name: "Custom account name" })).not.toHaveAttribute("aria-labelledby")
  })

  it("uses the Field label when the control has no explicit aria-label", () => {
    render(() => (
      <Field>
        <Field.Label>Account name</Field.Label>
        <TextInput />
      </Field>
    ))

    expect(screen.getByRole("textbox", { name: "Account name" })).toHaveAttribute("aria-labelledby")
  })

  it("retains external descriptions while Field descriptions mount and unmount", () => {
    function Harness() {
      const [suffix, setSuffix] = createSignal(true)
      return <>
        <button onClick={() => setSuffix((current) => !current)}>Toggle suffix</button>
        <Field>
          <Field.Label>Account name</Field.Label>
          <TextInput aria-describedby="hint" />
          <p id="hint">Use the account name from your invoice.</p>
          <Show when={suffix()}><Field.Suffix>Required</Field.Suffix></Show>
        </Field>
      </>
    }
    render(() => <Harness />)

    const control = screen.getByRole("textbox")
    const description = () => control.getAttribute("aria-describedby")?.split(" ") ?? []
    expect(description()).toEqual(expect.arrayContaining(["hint", expect.stringContaining("field-suffix-")]))

    screen.getByRole("button", { name: "Toggle suffix" }).click()
    expect(description()).toEqual(["hint"])

    screen.getByRole("button", { name: "Toggle suffix" }).click()
    expect(description()).toEqual(expect.arrayContaining(["hint", expect.stringContaining("field-suffix-")]))
    expect(new Set(description()).size).toBe(description().length)
  })
})
