import type { Project } from "@bymorning/schema/project"
import { ProjectDirectory } from "@bymorning/schema/project-directory"
import { Schema } from "effect"
import { type JSX } from "solid-js"

import { useData } from "../context/data"
import { directoryMutation } from "./directory"
import { createForm } from "../ui/form"
import { FormDialog } from "../ui/components/form-dialog"
import { FormFrame } from "../ui/components/form-frame"
import { Field } from "../ui/components/field"
import { TextInput } from "../ui/components/text-input"
import "./add-file-dialog.css"

const maximumFileSize = 20 * 1024 * 1024

export function AddFileDialog(props: { readonly projectID: Project.ID }): JSX.Element {
  const data = useData()
  const upload = directoryMutation(data.projectDirectory.scope, data.projectDirectory.query)
  const form = createForm({
    values: { file: undefined as File | undefined, path: "" },
    fallback: "File upload failed",
    validate,
    submit,
  })

  function validate(values: { readonly file: File | undefined; readonly path: string }) {
    if (!values.file) return "Choose a file to upload."
    if (values.file.size > maximumFileSize) return "Choose a file no larger than 20 MB."
    if (!values.path) return "Enter a destination path."
    if (!Schema.is(ProjectDirectory.Path)(values.path)) return "Enter a relative file path without . or .. segments."
    return undefined
  }

  function submit(values: { readonly file: File | undefined; readonly path: string }) {
    const selected = values.file
    if (!selected) throw new Error("A selected file is required after validation.")
    return upload.mutateAsync({
      scope: data.projectDirectory.scope,
      projectID: props.projectID,
      path: values.path,
      contentType: selected.type || "application/octet-stream",
      file: selected,
    })
  }

  return (
    <FormDialog
      form={form}
      title="Upload file"
      actions={<FormFrame.Actions submitLabel="Upload file" pendingLabel="Uploading…" />}
    >
      <FormFrame.Fields>
        <div data-slot="workspace-file-picker">
          <label for="workspace-file-upload">File</label>
          <input
            id="workspace-file-upload"
            autofocus
            type="file"
            disabled={form.pending}
            aria-describedby="workspace-file-upload-help"
            onChange={(event) => {
              const selected = event.currentTarget.files?.item(0) ?? undefined
              form.set("file", selected)
              if (selected) form.set("path", selected.name)
            }}
          />
          <span id="workspace-file-upload-help">Any file type, up to 20 MB.</span>
        </div>
        <Field data-slot="workspace-file-path" invalid={!!form.error}>
          <Field.Label>Destination path</Field.Label>
          <TextInput
            appearance="full-width"
            disabled={form.pending}
            value={form.values.path}
            placeholder="folder/file.ext"
            onInput={(event) => form.set("path", event.currentTarget.value)}
          />
        </Field>
      </FormFrame.Fields>
    </FormDialog>
  )
}
