import { Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useDialog, useEntry } from "../../context/dialog"
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
import { createForm } from "../../ui/form"
import { Markdown } from "../../ui/components/markdown"
import { Textarea } from "../../ui/components/textarea"
import { TextInput } from "../../ui/components/text-input"
import type { AgentListItem } from "../../features/agent-list/agent-list-model"
import "./dialog.css"

const modeLabel = { subagent: "Subagent", primary: "Primary", all: "Primary and subagent" } as const satisfies Record<
  AgentListItem["mode"],
  string
>

/** The mutable fields this dialog edits; every other field is preserved on save. */
export interface AgentDraft {
  readonly name: string
  readonly description: string
  readonly instructions: string
}

export interface AgentDetailActions {
  /** Save the draft over the Agent's current definition. */
  readonly save: (draft: AgentDraft) => Promise<unknown>
  /**
   * Remove the Workspace record for a built-in Agent, restoring its shipped
   * definition. Absent for an Agent that has no shipped definition to restore.
   */
  readonly reset?: () => Promise<unknown>
}

/**
 * One dialog for an Agent: read it, and — when the caller supplies actions —
 * switch into editing in place or restore a built-in Agent's shipped
 * definition.
 */
export function AgentDetailContent(props: {
  readonly agent: AgentListItem
  readonly actions?: AgentDetailActions
  readonly onSaved?: (name: string) => void
  readonly onReset?: (name: string) => void
}): JSX.Element {
  const entry = useEntry()
  const dialog = useDialog()
  const [state, setState] = createStore<{ editing: boolean; agent: AgentListItem }>({
    editing: false,
    agent: props.agent,
  })
  const title = () => state.agent.name || state.agent.id
  /** Only the Default is a plain "Agent"; every other mode is a Subagent. */
  const noun = () => (state.agent.mode === "subagent" ? "subagent" : "agent")
  const draft = (): AgentDraft => ({
    name: state.agent.name,
    description: state.agent.description ?? "",
    instructions: state.agent.instructions,
  })
  const form = createForm({
    values: { ...draft() },
    validate: (values) =>
      !values.name.trim() ? `Enter a${noun() === "agent" ? "n agent" : " subagent"} name.` : undefined,
    submit: (values) => {
      const next: AgentDraft = {
        name: values.name.trim(),
        description: values.description,
        instructions: values.instructions,
      }
      const actions = props.actions
      if (!actions) return Promise.reject(new Error("This agent cannot be edited."))
      return actions.save(next).then(() => next)
    },
    fallback: `${noun() === "agent" ? "Agent" : "Subagent"} could not be saved.`,
  })

  const edit = () => {
    const current = draft()
    form.set("name", current.name)
    form.set("description", current.description)
    form.set("instructions", current.instructions)
    setState("editing", true)
  }
  const reset = () => {
    const restore = props.actions?.reset
    if (!restore) return
    const name = title()
    dialog.push(() => (
      <ConfirmDialog
        title={`Reset ${name}?`}
        description="This agent returns to the instructions and settings ByMorning ships with. Workspace changes to it are discarded."
        confirmLabel="Reset agent"
        danger
        onConfirm={async () => {
          await restore()
          entry.close()
          props.onReset?.(name)
        }}
      />
    ))
  }

  return (
    <Show
      when={state.editing}
      fallback={
        <UIDialog variant="card" size="large" data-component="agent-detail-dialog">
          <DialogHeader>
            <Show
              when={state.agent.description}
              fallback={
                <DialogTitle>
                  <span title={title()}>{title()}</span>
                </DialogTitle>
              }
            >
              {(description) => (
                <DialogTitleGroup title={<span title={title()}>{title()}</span>} description={description()} />
              )}
            </Show>
          </DialogHeader>
          <DialogBody>
            <div data-slot="agent-detail-dialog-body">
              <dl data-slot="agent-detail-dialog-fields">
                <div>
                  <dt>Mode</dt>
                  <dd>{modeLabel[state.agent.mode]}</dd>
                </div>
                <Show when={state.agent.model}>
                  {(model) => (
                    <div>
                      <dt>Model</dt>
                      <dd>{`${model().provider}/${model().id}${model().variant ? ` (${model().variant})` : ""}`}</dd>
                    </div>
                  )}
                </Show>
                <div>
                  <dt>Steps</dt>
                  <dd>{state.agent.steps ?? "Unlimited"}</dd>
                </div>
                <div>
                  <dt>Hidden</dt>
                  <dd>{state.agent.hidden ? "Yes" : "No"}</dd>
                </div>
                <Show when={state.agent.color}>
                  {(color) => (
                    <div>
                      <dt>Color</dt>
                      <dd>{color()}</dd>
                    </div>
                  )}
                </Show>
              </dl>
              <Markdown text={state.agent.instructions} cacheKey={`agent:${state.agent.id}`} />
            </div>
          </DialogBody>
          <Show when={props.actions}>
            {(actions) => (
              <DialogFooter>
                <Show when={actions().reset && state.agent.overridden}>
                  <Button type="button" variant="ghost" size="large" onClick={reset}>
                    Reset to built-in
                  </Button>
                </Show>
                <Button type="button" variant="primary" size="large" onClick={edit}>
                  {`Edit ${noun()}`}
                </Button>
              </DialogFooter>
            )}
          </Show>
        </UIDialog>
      }
    >
      <FormDialog
        form={form}
        title={`Edit ${noun()}`}
        size="large"
        onCancel={() => setState("editing", false)}
        onSuccess={(saved) => {
          setState({
            editing: false,
            agent: {
              ...state.agent,
              name: saved.name,
              instructions: saved.instructions,
              description: saved.description,
              // Saving a built-in Agent always writes the record that overrides it.
              ...(props.actions?.reset ? { overridden: true } : {}),
            },
          })
          props.onSaved?.(saved.name)
        }}
        actions={
          <FormFrame.Actions submitLabel="Save changes" pendingLabel="Saving…" disabled={!form.values.name.trim()} />
        }
      >
        <FormFrame.Fields>
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
          </Field>
          <Field data-slot="workspace-create-instructions">
            <Field.Label>Instructions</Field.Label>
            <Textarea
              appearance="fill"
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
