import * as User from "@bymorning/schema/user"
import { Option, Schema } from "effect"
import { type JSX } from "solid-js"

import { createForm } from "../ui/form"
import { FormDialog } from "../ui/components/form-dialog"
import { FormFrame } from "../ui/components/form-frame"
import { Field } from "../ui/components/field"
import { Select } from "../ui/components/select"
import { TextInput } from "../ui/components/text-input"

const inviteRoles = ["member", "admin"] as const

export function MembersInviteDialog(props: {
  readonly create: (payload: User.InviteInput) => Promise<User.Member>
  readonly onSuccess?: (member: User.Member) => void
}): JSX.Element {
  const form = createForm({
    values: { email: "", role: "member" as (typeof inviteRoles)[number] },
    validate: (values) => {
      const input = Option.getOrUndefined(
        Schema.decodeUnknownOption(User.InviteInput)({ email: values.email, role: values.role }),
      )
      return input ? undefined : "Enter a valid email address."
    },
    submit: (values) => {
      const input = Option.getOrUndefined(
        Schema.decodeUnknownOption(User.InviteInput)({ email: values.email, role: values.role }),
      )
      if (!input) throw new Error("Enter a valid email address.")
      return props.create(input)
    },
    fallback: "The member could not be invited.",
  })
  return (
    <FormDialog
      form={form}
      title="Invite member"
      onSuccess={(member, entry) => {
        entry.close()
        props.onSuccess?.(member)
      }}
      actions={<FormFrame.Actions submitLabel="Invite member" pendingLabel="Inviting…" />}
    >
      <FormFrame.Fields>
        <Field>
          <Field.Label>Email</Field.Label>
          <TextInput
            autofocus
            required
            type="email"
            appearance="full-width"
            autocomplete="email"
            value={form.values.email}
            disabled={form.pending}
            onInput={(event) => form.set("email", event.currentTarget.value)}
          />
        </Field>
        <Field>
          <Field.Label>Role</Field.Label>
          <Select
            aria-label="Role"
            options={[...inviteRoles]}
            current={form.values.role}
            disabled={form.pending}
            label={roleLabel}
            onSelect={(role) => role && form.set("role", role)}
          />
        </Field>
      </FormFrame.Fields>
    </FormDialog>
  )
}

function roleLabel(role: "admin" | "member") {
  if (role === "admin") return "Admin"
  return "Member"
}
