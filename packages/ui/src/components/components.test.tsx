import { cleanup, render, screen } from "@solidjs/testing-library"
import "@testing-library/jest-dom/vitest"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@bymorning/ui/button"
import { Checkbox } from "@bymorning/ui/checkbox"
import { Field } from "@bymorning/ui/field"
import { TextInput } from "@bymorning/ui/text-input"

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
})
