import type { JSX } from "solid-js"

import { validateAmount } from "../ui/amount"
import { Field } from "../ui/components/field"
import { FormDialog } from "../ui/components/form-dialog"
import { FormFrame } from "../ui/components/form-frame"
import { TextInput } from "../ui/components/text-input"
import { createForm } from "../ui/form"

/** Sets the Workspace Holder's monthly Spend Limit. */
export function BudgetDialog(props: { readonly save: (amount: number) => Promise<unknown> }): JSX.Element {
  const form = createForm({
    values: { amount: "" },
    validate: (values) => validateAmount(values.amount) ?? (values.amount === "" ? "Enter an amount." : undefined),
    submit: (values) => props.save(Number(values.amount)),
    fallback: "Could not update the limit.",
  })
  return (
    <FormDialog
      form={form}
      title="Set a workspace spending limit"
      description="Inference stops for everyone in this workspace once the month's spend reaches this amount. You can change it any time under Budgets."
      actions={
        <FormFrame.Actions submitLabel="Set limit" pendingLabel="Saving…" disabled={form.values.amount.trim() === ""} />
      }
    >
      <FormFrame.Fields>
        <Field>
          <Field.Label>Monthly limit (USD)</Field.Label>
          <TextInput
            autofocus
            required
            inputMode="decimal"
            appearance="full-width"
            placeholder="100.00"
            disabled={form.pending}
            value={form.values.amount}
            onInput={(event) => form.set("amount", event.currentTarget.value)}
          />
        </Field>
      </FormFrame.Fields>
    </FormDialog>
  )
}
