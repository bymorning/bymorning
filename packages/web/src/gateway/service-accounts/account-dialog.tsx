import type { ServiceAccountListOutput } from "@bymorning/client"
import { Show } from "solid-js"

import { Field } from "../../ui/components/field"
import { Select } from "../../ui/components/select"
import { TextInput } from "../../ui/components/text-input"
import { createForm, FormDialog, FormFrame } from "../../ui/form"
import { ConnectDialog } from "./connect-dialog"
import "./account-dialog.css"

export type Account = ServiceAccountListOutput[number]
export type Owner = Pick<Account, "id" | "name">

export function AccountDialog(props: {
  readonly account?: Account
  readonly save: (input: {
    name: string
    policy: { models?: string[]; rpm?: number; tpm?: number }
  }) => Promise<unknown>
}) {
  const form = createForm({
    values: {
      name: props.account?.name ?? "",
    },
    validate: (values) => (!values.name.trim() ? "Enter a service account name." : undefined),
    submit: (values) => {
      return props.save({
        name: values.name.trim(),
        policy: {
          ...(props.account?.policy.models ? { models: props.account.policy.models } : {}),
          ...(props.account?.policy.rpm !== undefined ? { rpm: props.account.policy.rpm } : {}),
          ...(props.account?.policy.tpm !== undefined ? { tpm: props.account.policy.tpm } : {}),
        },
      })
    },
    fallback: "Request failed.",
  })
  return (
    <FormDialog
      form={form}
      title={props.account ? "Edit service account" : "New service account"}
      {...(props.account
        ? {}
        : {
            description:
              "Holds API keys for one client, such as Claude Code or a CI job, with shared limits and usage.",
          })}
      actions={
        <FormFrame.Actions
          submitLabel={props.account ? "Save changes" : "Create service account"}
          pendingLabel={props.account ? "Saving…" : "Creating…"}
          disabled={!form.values.name.trim()}
        />
      }
    >
      <FormFrame.Fields>
        <Field>
          <Field.Label>Service account name</Field.Label>
          <TextInput
            autofocus
            appearance="full-width"
            required
            placeholder="Engineering laptops"
            value={form.values.name}
            disabled={form.pending}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
        </Field>
      </FormFrame.Fields>
    </FormDialog>
  )
}

/** A key expires at the end of the chosen local day. */
const expiry = (date: string) => new Date(`${date}T23:59:59.999`)

type Choice = { readonly type: "new" } | { readonly type: "existing"; readonly account: Owner }
const newChoice: Choice = { type: "new" }

/**
 * Create an API key. The key is the subject; its service account is a detail:
 * fixed when opened from an account, otherwise chosen here and created on
 * demand with the key's name, so no separate step precedes the key.
 */
export function CreateKeyDialog(props: {
  /** Owner when opened from a specific account. */
  readonly account?: Owner
  /** Existing accounts to choose from when the owner is not fixed. */
  readonly accounts?: ReadonlyArray<Owner> | undefined
  readonly createAccount?: (name: string) => Promise<Owner>
  readonly createKey: (account: Owner, name: string, timeExpires?: Date) => Promise<{ secret: string }>
  readonly created: (account: Owner) => void
}) {
  const choices = (): ReadonlyArray<Choice> => [
    newChoice,
    ...(props.accounts ?? []).map((account): Choice => ({ type: "existing", account })),
  ]
  const form = createForm({
    values: { name: "", expires: "", owner: newChoice as Choice },
    validate: (values) => {
      if (!values.name.trim()) return "Enter a key name."
      if (values.expires && expiry(values.expires).getTime() <= Date.now())
        return "Choose an expiry date in the future."
      return undefined
    },
    submit: async (values) => {
      const name = values.name.trim()
      const owner =
        props.account ??
        (values.owner.type === "existing"
          ? values.owner.account
          : await (props.createAccount ?? (() => Promise.reject(new Error("No service account available."))))(name))
      const result = await props.createKey(owner, name, values.expires ? expiry(values.expires) : undefined)
      return { ...result, owner }
    },
    fallback: "Request failed.",
  })
  const choosing = () => props.account === undefined && (props.accounts?.length ?? 0) > 0
  const creating = () => props.account === undefined && form.values.owner.type === "new"
  const label = (choice: Choice) => (choice.type === "new" ? "New service account" : choice.account.name)
  const value = (choice: Choice) => (choice.type === "new" ? "new" : choice.account.id)
  return (
    <FormDialog
      form={form}
      title="Create API key"
      description={
        <Show
          when={props.account}
          fallback={<Show when={creating()}>A service account with the same name will hold this key.</Show>}
        >
          {(account) => `The key authenticates as ${account().name}.`}
        </Show>
      }
      onSuccess={(result, entry) => {
        entry.replace(() => <ConnectDialog secret={result.secret} />)
        props.created(result.owner)
      }}
      actions={
        <FormFrame.Actions submitLabel="Create key" pendingLabel="Creating…" disabled={!form.values.name.trim()} />
      }
    >
      <div data-slot="api-key-fields">
        <Field>
          <Field.Label>Key name</Field.Label>
          <TextInput
            autofocus
            appearance="full-width"
            required
            placeholder="Claude Code"
            value={form.values.name}
            disabled={form.pending}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
        </Field>
        <Show when={choosing()}>
          <Field>
            <Field.Label>Service account</Field.Label>
            <Select
              aria-label="Service account"
              appearance="full-width"
              options={[...choices()]}
              current={form.values.owner}
              disabled={form.pending}
              value={value}
              label={label}
              onSelect={(choice) => choice && form.set("owner", choice)}
            />
          </Field>
        </Show>
        <Field>
          <Field.Label>Expiry date (optional)</Field.Label>
          <TextInput
            type="date"
            appearance="full-width"
            value={form.values.expires}
            disabled={form.pending}
            onInput={(event) => form.set("expires", event.currentTarget.value)}
          />
        </Field>
      </div>
    </FormDialog>
  )
}
