import { Show, type JSX } from "solid-js"

import { createForm } from "../../ui/form"
import { FormDialog } from "../../ui/components/form-dialog"
import { FormFrame } from "../../ui/components/form-frame"
import { Field } from "../../ui/components/field"
import { Textarea } from "../../ui/components/textarea"
import { TextInput } from "../../ui/components/text-input"
import "../create-dialog.css"

export function AgentCreateDialog(props: {
  readonly create: (payload: { name: string; description: string; instructions: string }) => Promise<unknown>
  readonly onSuccess?: (name: string) => void
}): JSX.Element {
  const form = createForm({
    values: { name: "", description: "", instructions: "" },
    validate: (values) => (!values.name.trim() ? "Enter a subagent name." : undefined),
    submit: (values) => {
      return props.create({
        name: values.name.trim(),
        description: values.description,
        instructions: values.instructions,
      })
    },
    fallback: "Subagent could not be created.",
  })

  return (
    <FormDialog
      form={form}
      title="Create subagent"
      onSuccess={(_, entry) => {
        entry.close()
        props.onSuccess?.(form.values.name.trim())
      }}
      actions={
        <FormFrame.Actions submitLabel="Create subagent" pendingLabel="Creating…" disabled={!form.values.name.trim()} />
      }
    >
      <FormFrame.Fields layout="paired">
        <Field>
          <Field.Label>Name</Field.Label>
          <TextInput
            autofocus
            required
            appearance="full-width"
            value={form.values.name}
            disabled={form.pending}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
          <Show when={!form.values.name.trim()}>
            <Field.Suffix>Required.</Field.Suffix>
          </Show>
        </Field>
        <Field>
          <Field.Label>Description</Field.Label>
          <TextInput
            appearance="full-width"
            value={form.values.description}
            disabled={form.pending}
            onInput={(event) => form.set("description", event.currentTarget.value)}
          />
          <Field.Suffix>The Default agent reads this to decide when to hand work to this subagent.</Field.Suffix>
        </Field>
        <Field data-slot="workspace-create-instructions">
          <Field.Label>Instructions</Field.Label>
          <Textarea
            appearance="full-width"
            value={form.values.instructions}
            disabled={form.pending}
            onInput={(event) => form.set("instructions", event.currentTarget.value)}
          />
        </Field>
      </FormFrame.Fields>
    </FormDialog>
  )
}
