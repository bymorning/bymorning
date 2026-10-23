import { Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useDialog, useEntry } from "../../context/dialog"
import { createForm } from "../../ui/form"
import { Button } from "../../ui/components/button"
import { ConfirmDialog } from "../../ui/components/confirm-dialog"
import {
  Dialog as UIDialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTitleGroup,
} from "../../ui/components/dialog"
import { Field } from "../../ui/components/field"
import { FormDialog } from "../../ui/components/form-dialog"
import { FormFrame } from "../../ui/components/form-frame"
import { Markdown } from "../../ui/components/markdown"
import { Textarea } from "../../ui/components/textarea"
import { TextInput } from "../../ui/components/text-input"
import "./dialog.css"

export interface SkillDraft {
  readonly name: string
  readonly description: string
  readonly instructions: string
}

export type SkillDialogMode =
  | { readonly type: "create"; readonly submit: (draft: SkillDraft) => Promise<unknown> }
  | {
      readonly type: "existing"
      readonly id: string
      readonly skill: SkillDraft
      readonly save: (draft: SkillDraft) => Promise<unknown>
      readonly remove: () => Promise<unknown>
    }

/**
 * One dialog for a Skill: read it, switch into editing in place, save or
 * cancel back to reading, or delete it. Creation starts in the editing state.
 */
export function SkillDialog(props: {
  readonly mode: SkillDialogMode
  readonly onSaved?: (name: string) => void
  readonly onDeleted?: (name: string) => void
}): JSX.Element {
  const entry = useEntry()
  const dialog = useDialog()
  const creating = () => props.mode.type === "create"
  const [state, setState] = createStore<{ editing: boolean; skill: SkillDraft }>({
    editing: props.mode.type === "create",
    skill: props.mode.type === "existing" ? props.mode.skill : { name: "", description: "", instructions: "" },
  })
  const form = createForm({
    values: { ...state.skill },
    validate: (values) => (!values.name.trim() ? "Enter a skill name." : undefined),
    submit: (values) => {
      const draft: SkillDraft = {
        name: values.name.trim(),
        description: values.description,
        instructions: values.instructions,
      }
      const persist = props.mode.type === "create" ? props.mode.submit(draft) : props.mode.save(draft)
      return persist.then(() => draft)
    },
    fallback: creating() ? "Skill could not be created." : "Skill could not be saved.",
  })

  const edit = () => {
    form.set("name", state.skill.name)
    form.set("description", state.skill.description)
    form.set("instructions", state.skill.instructions)
    setState("editing", true)
  }
  const remove = () => {
    if (props.mode.type !== "existing") return
    const mode = props.mode
    const name = state.skill.name
    dialog.push(() => (
      <ConfirmDialog
        title={`Delete ${name}?`}
        description="Agents will no longer be able to use this skill. This cannot be undone."
        confirmLabel="Delete skill"
        danger
        onConfirm={async () => {
          await mode.remove()
          entry.close()
          props.onDeleted?.(name)
        }}
      />
    ))
  }

  return (
    <Show
      when={state.editing}
      fallback={
        <UIDialog variant="card" size="large" data-component="skill-dialog">
          <DialogHeader>
            <Show when={state.skill.description} fallback={<DialogTitle>{state.skill.name}</DialogTitle>}>
              {(description) => <DialogTitleGroup title={state.skill.name} description={description()} />}
            </Show>
          </DialogHeader>
          <DialogBody>
            <div data-slot="skill-dialog-instructions">
              <Show
                when={state.skill.instructions.trim() !== ""}
                fallback={<p data-slot="skill-dialog-empty">This skill has no instructions yet.</p>}
              >
                <Markdown
                  text={state.skill.instructions}
                  cacheKey={`skill:${props.mode.type === "existing" ? props.mode.id : "new"}`}
                />
              </Show>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" size="large" onClick={remove}>
              Delete skill
            </Button>
            <Button type="button" variant="primary" size="large" onClick={edit}>
              Edit skill
            </Button>
          </DialogFooter>
        </UIDialog>
      }
    >
      <FormDialog
        form={form}
        title={creating() ? "Create skill" : "Edit skill"}
        size="full"
        {...(creating() ? {} : { onCancel: () => setState("editing", false) })}
        onSuccess={(draft) => {
          if (creating()) {
            entry.close()
          } else {
            setState({ editing: false, skill: draft })
          }
          props.onSaved?.(draft.name)
        }}
        actions={
          <FormFrame.Actions
            submitLabel={creating() ? "Create skill" : "Save changes"}
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
              required
              appearance="full-width"
              placeholder="weekly-status-report"
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
            <Textarea
              appearance="full-width"
              rows={2}
              placeholder="Generate weekly status reports from recent work. Use when asked for updates or progress summaries."
              value={form.values.description}
              disabled={form.pending}
              onInput={(event) => form.set("description", event.currentTarget.value)}
            />
            <Field.Suffix>Describe the workflow and knowledge this skill provides.</Field.Suffix>
          </Field>
          <Field data-slot="workspace-create-instructions">
            <Field.Label>Instructions</Field.Label>
            <Textarea
              appearance="fill"
              placeholder="Summarize my recent work in three sections: wins, blockers, and next steps…"
              value={form.values.instructions}
              disabled={form.pending}
              onInput={(event) => form.set("instructions", event.currentTarget.value)}
            />
          </Field>
        </FormFrame.Fields>
      </FormDialog>
    </Show>
  )
}
