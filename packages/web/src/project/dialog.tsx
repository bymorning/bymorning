import type { Project } from "@bymorning/schema/project"
import { Show, type JSX } from "solid-js"

import { createForm } from "../ui/form"
import { FormDialog } from "../ui/components/form-dialog"
import { FormFrame } from "../ui/components/form-frame"
import { Field } from "../ui/components/field"
import { TextInput } from "../ui/components/text-input"
import { Button } from "../ui/components/button"
import "./dialog.css"

export type ProjectDialogMode =
  | {
      readonly type: "create"
      readonly submit: (input: Project.CreateInput) => Promise<Project.Info>
      /** Offer restoring an archived Project instead of creating one. */
      readonly restore?: () => void
    }
  | {
      readonly type: "update"
      readonly project: Project.Info
      readonly submit: (input: Project.UpdateInput) => Promise<Project.Info>
      /** Offer archiving this Project; `disabled` explains why it cannot be archived. */
      readonly archive?: { readonly run: () => void; readonly disabled?: string | undefined }
    }

export function ProjectDialog(props: { readonly mode: ProjectDialogMode }): JSX.Element {
  const form = createForm({
    values: { name: props.mode.type === "update" ? (props.mode.project.name ?? "") : "" },
    fallback: "Project could not be saved.",
    submit: (values) => {
      const name = values.name.trim()
      if (!name) return Promise.reject(new Error("Enter a project name."))
      if (props.mode.type === "create") return props.mode.submit({ name })
      return props.mode.submit({ projectID: props.mode.project.id, name })
    },
  })
  const creating = () => props.mode.type === "create"
  return (
    <FormDialog
      form={form}
      title={creating() ? "Create project" : "Edit project"}
      actions={
        <FormFrame.Actions
          submitLabel={creating() ? "Create project" : "Save changes"}
          pendingLabel={creating() ? "Creating…" : "Saving…"}
          disabled={!form.values.name.trim()}
        />
      }
    >
      <FormFrame.Fields>
        <Field>
          <Field.Label>Name</Field.Label>
          <TextInput
            autofocus
            appearance="full-width"
            maxLength={255}
            placeholder="Enter a project name"
            value={form.values.name}
            disabled={form.pending}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
        </Field>
        <Show when={props.mode.type === "create" && props.mode.restore}>
          {(restore) => (
            <div data-slot="project-dialog-secondary">
              <Button type="button" variant="ghost" disabled={form.pending} onClick={() => restore()()}>
                Restore an archived project
              </Button>
            </div>
          )}
        </Show>
        <Show when={props.mode.type === "update" && props.mode.archive}>
          {(archive) => (
            <div data-slot="project-dialog-secondary">
              <Button
                type="button"
                variant="outline"
                disabled={form.pending || archive().disabled !== undefined}
                aria-describedby={archive().disabled === undefined ? undefined : "project-dialog-archive-reason"}
                onClick={() => archive().run()}
              >
                Archive project
              </Button>
              <Show when={archive().disabled}>
                {(reason) => (
                  <p id="project-dialog-archive-reason" data-slot="project-dialog-hint">
                    {reason()}
                  </p>
                )}
              </Show>
            </div>
          )}
        </Show>
      </FormFrame.Fields>
    </FormDialog>
  )
}
