import { type JSX } from "solid-js"

import { ConfirmDialog } from "../../../ui/components/confirm-dialog"
import { Field } from "../../../ui/components/field"
import { FormDialog } from "../../../ui/components/form-dialog"
import { FormFrame } from "../../../ui/components/form-frame"
import { TextInput } from "../../../ui/components/text-input"
import { createForm } from "../../../ui/form"

const name = (path: string) => path.split("/").at(-1) ?? path
const files = (count: number) => (count === 1 ? "1 file" : `${count} files`)

/**
 * Edit the full Project path of a file or folder, so renaming also moves it between folders.
 * A rejected submission, such as an occupied path, stays open with its message inline.
 */
export function RenameDialog(props: {
  readonly kind: "file" | "folder"
  readonly path: string
  readonly onSubmit: (path: string) => Promise<void>
}): JSX.Element {
  const form = createForm({
    values: { path: props.path },
    fallback: props.kind === "file" ? "File could not be renamed." : "Folder could not be renamed.",
    validate: (values) =>
      values.path.trim() ? undefined : `Enter a ${props.kind === "file" ? "file" : "folder"} path.`,
    submit: (values) => props.onSubmit(values.path.trim()),
  })
  const label = props.kind === "file" ? "File path" : "Folder path"
  let selected = false
  return (
    <FormDialog
      form={form}
      title={props.kind === "file" ? `Rename ${name(props.path)}` : `Rename folder ${name(props.path)}`}
      description="Edit the full path to move it to another folder."
      actions={
        <FormFrame.Actions
          submitLabel="Rename"
          pendingLabel={props.kind === "file" ? "Renaming…" : "Moving files…"}
          disabled={!form.values.path.trim() || form.values.path.trim() === props.path}
        />
      }
    >
      <FormFrame.Fields>
        <Field invalid={!!form.error}>
          <Field.Label>{label}</Field.Label>
          <TextInput
            appearance="full-width"
            value={form.values.path}
            disabled={form.pending}
            spellcheck={false}
            autocomplete="off"
            onInput={(event) => form.set("path", event.currentTarget.value)}
            autofocus
            onFocus={(event) => {
              if (selected) return
              selected = true
              // Select the file name, not its folder or extension, so typing renames in place.
              const start = props.path.lastIndexOf("/") + 1
              const dot = props.kind === "file" ? props.path.lastIndexOf(".") : -1
              event.currentTarget.setSelectionRange(start, dot > start ? dot : props.path.length)
            }}
          />
        </Field>
      </FormFrame.Fields>
    </FormDialog>
  )
}

/** Confirm permanently deleting one file, or every file under a folder. */
export function DeleteDialog(props: {
  readonly kind: "file" | "folder"
  readonly path: string
  /** Files under the folder; folders only. */
  readonly count?: number
  readonly onConfirm: () => Promise<void>
}): JSX.Element {
  return (
    <ConfirmDialog
      title={`Delete ${name(props.path)}?`}
      description={
        props.kind === "file"
          ? "This cannot be undone."
          : `This deletes ${files(props.count ?? 0)} in ${props.path}/. This cannot be undone.`
      }
      confirmLabel={props.kind === "file" ? "Delete" : `Delete ${files(props.count ?? 0)}`}
      danger
      onConfirm={props.onConfirm}
    />
  )
}
