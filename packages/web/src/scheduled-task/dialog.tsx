import type {
  ProjectListOutput,
  ScheduledTaskCreateInput,
  ScheduledTaskInfo,
  ScheduledTaskUpdateInput,
} from "@bymorning/client"
import { createUniqueId, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { Button } from "../ui/components/button"
import { Field } from "../ui/components/field"
import { Icon } from "../ui/components/icon"
import { Select } from "../ui/components/select"
import { ModelSelectorPopover, SearchableSelectPopover } from "../ui/components/select-dialog"
import { Switch } from "../ui/components/switch"
import { TextInput } from "../ui/components/text-input"
import { Textarea } from "../ui/components/textarea"
import { createForm, FormDialog, FormFrame } from "../ui/form"
import { modelOptionKey, type ModelOption } from "../utils/model-option"
import { createVisibility } from "../utils/model-visibility"
import "./dialog.css"
import {
  defaultPreset,
  frequencies,
  fromCron,
  localTimeZone,
  timeZones,
  toCron,
  validate,
  weekdays,
  type Frequency,
} from "./schedule"

/** Submission built by the dialog: a full create payload, or an edit diff keyed by taskID. */
export type ScheduledTaskSubmit =
  | { readonly type: "create"; readonly value: Omit<ScheduledTaskCreateInput, "workspace"> }
  | { readonly type: "update"; readonly value: Omit<ScheduledTaskUpdateInput, "workspace"> }

const DEFAULT_MODEL = "default"

export function ScheduledTaskDialog(props: {
  readonly task?: ScheduledTaskInfo
  readonly template?: { readonly name: string; readonly prompt: string; readonly cron: string }
  readonly projects: ReadonlyArray<ProjectListOutput[number]>
  /** The same provider-native choices the conversation composer offers. */
  readonly models: ReadonlyArray<ModelOption>
  readonly modelsPending?: boolean
  readonly modelsHref?: string
  readonly onSubmit: (input: ScheduledTaskSubmit) => Promise<unknown>
}): JSX.Element {
  const [state, setState] = createStore({ attempted: false, zoneOpen: false, modelOpen: false })
  type Values = {
    name: string
    prompt: string
    frequency: Frequency
    /** `HH:MM` in 24-hour form. */
    time: string
    weekday: number
    day: number
    cron: string
    timezone: string
    projectID: string
    /** `modelOptionKey`, or `default` for the Agent's model. */
    model: string
    enabled: boolean
  }
  const cronOf = (values: Values) =>
    toCron({
      frequency: values.frequency,
      time: values.time,
      weekday: values.weekday,
      day: values.day,
      cron: values.cron,
    })
  const errors = (values: Values) => {
    const schedule = validate(cronOf(values), values.timezone)
    return {
      name: values.name.trim() ? undefined : "Enter a name.",
      prompt: values.prompt.trim() ? undefined : "Enter a prompt.",
      cron: values.frequency === "custom" ? schedule : undefined,
      schedule,
    }
  }
  const initial: Values = (() => {
    const schedule = props.task
      ? fromCron(props.task.cron)
      : props.template
        ? fromCron(props.template.cron)
        : defaultPreset
    return {
      name: props.task?.name ?? props.template?.name ?? "",
      prompt: props.task?.prompt ?? props.template?.prompt ?? "",
      frequency: schedule.frequency,
      time: schedule.time,
      weekday: schedule.weekday,
      day: schedule.day,
      cron: schedule.cron,
      timezone: props.task?.timezone ?? localTimeZone(),
      projectID: props.task?.projectID ?? props.projects[0]?.id ?? "",
      model: props.task?.model ? modelOptionKey(props.task.model) : DEFAULT_MODEL,
      enabled: props.task?.enabled ?? true,
    }
  })()
  const form = createForm<Values, ScheduledTaskSubmit>({
    values: initial,
    validate: (values) => {
      setState("attempted", true)
      const result = errors(values)
      if (result.name || result.prompt || result.cron) return "Check the highlighted fields."
      return result.schedule
    },
    submit: async (values) => {
      const cron = cronOf(values)
      const name = values.name.trim()
      const prompt = values.prompt.trim()
      const project = props.projects.find((item) => item.id === values.projectID)
      const model =
        values.model === DEFAULT_MODEL ? undefined : props.models.find((item) => modelOptionKey(item) === values.model)
      const ref = model ? { provider: model.provider, id: model.id } : undefined
      const task = props.task
      if (task) {
        const currentModel = task.model ? modelOptionKey(task.model) : DEFAULT_MODEL
        const submission: ScheduledTaskSubmit = {
          type: "update",
          value: {
            taskID: task.id,
            ...(name !== task.name ? { name } : {}),
            ...(prompt !== task.prompt ? { prompt } : {}),
            ...(cron !== task.cron ? { cron } : {}),
            ...(values.timezone !== task.timezone ? { timezone: values.timezone } : {}),
            ...(project && project.id !== task.projectID ? { projectID: project.id } : {}),
            ...(values.model !== currentModel ? { model: ref ?? null } : {}),
            ...(values.enabled !== task.enabled ? { enabled: values.enabled } : {}),
          },
        }
        await props.onSubmit(submission)
        return submission
      }
      const submission: ScheduledTaskSubmit = {
        type: "create",
        value: {
          name,
          prompt,
          cron,
          timezone: values.timezone,
          ...(project ? { projectID: project.id } : {}),
          ...(ref ? { model: ref } : {}),
          enabled: values.enabled,
        },
      }
      await props.onSubmit(submission)
      return submission
    },
    fallback: "Could not save the scheduled task.",
  })

  const frequencyLabel = `scheduled-task-frequency-${createUniqueId()}`
  const weekdayLabel = `scheduled-task-weekday-${createUniqueId()}`
  const dayLabel = `scheduled-task-day-${createUniqueId()}`
  const zoneLabel = `scheduled-task-timezone-${createUniqueId()}`
  const projectLabel = `scheduled-task-project-${createUniqueId()}`
  const modelLabel = `scheduled-task-model-${createUniqueId()}`
  const dayOptions = Array.from({ length: 28 }, (_, index) => index + 1)
  const weekdayOptions = weekdays.map((label, value) => ({ label, value }))
  const zoneOptions = () => timeZones(form.values.timezone).map((zone) => ({ key: zone, label: zone }))

  // Same projection as the conversation composer: grouped by Provider, honouring Picker Visibility.
  const visibility = createVisibility(() => props.models)
  const modelOptions = () => [{ key: DEFAULT_MODEL, label: "Default model" }, ...props.models.map(visibility.option)]
  const currentModelLabel = () =>
    modelOptions().find((option) => option.key === form.values.model)?.label ?? "Default model"
  const selectModel = (key: string) => {
    const model = props.models.find((item) => modelOptionKey(item) === key)
    if (model) visibility.set(model, true)
    form.set("model", model ? key : DEFAULT_MODEL)
  }
  const currentProject = () => props.projects.find((project) => project.id === form.values.projectID)

  return (
    <FormDialog<Values, ScheduledTaskSubmit>
      form={form}
      title={props.task ? "Edit task" : "Schedule task"}
      size="large"
      actions={<FormFrame.Actions submitLabel={props.task ? "Save changes" : "Schedule task"} cancelLabel="Cancel" />}
      onSuccess={(_, entry) => entry.close()}
    >
      <FormFrame.Fields>
        <Field invalid={state.attempted && !!errors(form.values).name}>
          <Field.Label>Name</Field.Label>
          <TextInput
            autofocus
            required
            appearance="full-width"
            value={form.values.name}
            disabled={form.pending}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
          <Show when={state.attempted && errors(form.values).name}>
            {(error) => <Field.Suffix role="alert">{error()}</Field.Suffix>}
          </Show>
        </Field>
        <Field invalid={state.attempted && !!errors(form.values).prompt}>
          <Field.Label>Prompt</Field.Label>
          <Textarea
            required
            rows={8}
            appearance="full-width"
            value={form.values.prompt}
            disabled={form.pending}
            onInput={(event) => form.set("prompt", event.currentTarget.value)}
          />
          <p data-slot="scheduled-task-hint">
            Runs unattended: the model can't ask you questions and tools that need approval are denied. Up to 50 turns
            per run.
          </p>
          <Show when={state.attempted && errors(form.values).prompt}>
            {(error) => <Field.Suffix role="alert">{error()}</Field.Suffix>}
          </Show>
        </Field>
        <FormFrame.Fields layout="paired">
          <Field>
            <label id={frequencyLabel} data-slot="field-label">
              <span data-slot="field-label-text">Frequency</span>
            </label>
            <Select
              aria-labelledby={frequencyLabel}
              options={[...frequencies]}
              current={frequencies.find((frequency) => frequency.id === form.values.frequency)}
              value={(frequency) => frequency.id}
              label={(frequency) => frequency.label}
              appearance="full-width"
              disabled={form.pending}
              onSelect={(frequency) => frequency && form.set("frequency", frequency.id)}
            />
          </Field>
          <Show when={form.values.frequency === "weekly"}>
            <Field>
              <label id={weekdayLabel} data-slot="field-label">
                <span data-slot="field-label-text">Weekday</span>
              </label>
              <Select
                aria-labelledby={weekdayLabel}
                options={weekdayOptions}
                current={weekdayOptions.find((weekday) => weekday.value === form.values.weekday)}
                value={(weekday) => String(weekday.value)}
                label={(weekday) => weekday.label}
                appearance="full-width"
                disabled={form.pending}
                onSelect={(weekday) => weekday && form.set("weekday", weekday.value)}
              />
            </Field>
          </Show>
          <Show when={form.values.frequency === "monthly"}>
            <Field>
              <label id={dayLabel} data-slot="field-label">
                <span data-slot="field-label-text">Day of month</span>
              </label>
              <Select
                aria-labelledby={dayLabel}
                options={dayOptions}
                current={form.values.day}
                label={(day) => String(day)}
                appearance="full-width"
                disabled={form.pending}
                onSelect={(day) => day && form.set("day", day)}
              />
            </Field>
          </Show>
        </FormFrame.Fields>
        <FormFrame.Fields layout="paired">
          <Show
            when={form.values.frequency !== "custom"}
            fallback={
              <Field invalid={state.attempted && !!errors(form.values).cron}>
                <Field.Label>Cron schedule</Field.Label>
                <TextInput
                  required
                  class="scheduled-task-cron"
                  placeholder="0 9 * * 1-5"
                  spellcheck={false}
                  appearance="full-width"
                  value={form.values.cron}
                  disabled={form.pending}
                  onInput={(event) => form.set("cron", event.currentTarget.value)}
                />
                <p data-slot="scheduled-task-hint">
                  Minute, hour, day of month, month, weekday. Runs must be at least one hour apart.
                </p>
                <Show when={state.attempted && errors(form.values).cron}>
                  {(error) => <Field.Suffix role="alert">{error()}</Field.Suffix>}
                </Show>
              </Field>
            }
          >
            <Field>
              <Field.Label>Time</Field.Label>
              <TextInput
                type="time"
                required
                appearance="full-width"
                value={form.values.time}
                disabled={form.pending}
                onInput={(event) => form.set("time", event.currentTarget.value)}
              />
            </Field>
          </Show>
          <Field>
            <label id={zoneLabel} data-slot="field-label">
              <span data-slot="field-label-text">Time zone</span>
            </label>
            <SearchableSelectPopover
              label="Time zone"
              searchLabel="Search time zones"
              emptyLabel="No time zones found"
              placement="bottom-start"
              open={state.zoneOpen}
              onOpenChange={(open) => setState("zoneOpen", open)}
              model={{
                options: zoneOptions,
                current: () => form.values.timezone,
                pending: () => form.pending,
                select: (key) => form.set("timezone", key),
              }}
              trigger={(triggerProps) => (
                <Button
                  {...triggerProps}
                  type="button"
                  variant="outline"
                  data-slot="searchable-choice-trigger"
                  aria-labelledby={zoneLabel}
                  disabled={form.pending}
                >
                  <span data-slot="searchable-choice-trigger-label">{form.values.timezone}</span>
                  <Icon name="chevron-down" size="small" />
                </Button>
              )}
            />
          </Field>
        </FormFrame.Fields>
        <FormFrame.Fields layout="paired">
          <Field>
            <label id={projectLabel} data-slot="field-label">
              <span data-slot="field-label-text">Project</span>
            </label>
            <Select
              aria-labelledby={projectLabel}
              options={[...props.projects]}
              current={currentProject()}
              value={(project) => project.id}
              label={(project) => project.name ?? "Untitled"}
              appearance="full-width"
              disabled={form.pending || props.projects.length < 2}
              onSelect={(project) => project && form.set("projectID", project.id)}
            />
          </Field>
          <Field>
            <label id={modelLabel} data-slot="field-label">
              <span data-slot="field-label-text">Model</span>
            </label>
            <ModelSelectorPopover
              label="Model"
              searchLabel="Search models"
              emptyLabel="No models found"
              placement="bottom-start"
              open={state.modelOpen}
              onOpenChange={(open) => setState("modelOpen", open)}
              {...(props.modelsHref ? { actionHref: props.modelsHref, actionLabel: "Manage models" } : {})}
              model={{
                options: modelOptions,
                current: () => form.values.model,
                pending: () => form.pending || props.modelsPending === true,
                select: selectModel,
              }}
              trigger={(triggerProps) => (
                <Button
                  {...triggerProps}
                  type="button"
                  variant="outline"
                  data-slot="searchable-choice-trigger"
                  aria-labelledby={modelLabel}
                  disabled={form.pending}
                >
                  <span data-slot="searchable-choice-trigger-label">{currentModelLabel()}</span>
                  <Icon name="chevron-down" size="small" />
                </Button>
              )}
            />
          </Field>
        </FormFrame.Fields>
        <p data-slot="scheduled-task-hint">
          Each run starts a new session in{" "}
          {currentProject()?.name ? <strong>{currentProject()!.name}</strong> : "this project"} as you, with your tools
          and spend limits. Choose a model to override the default agent's; if it becomes unavailable the run falls back
          to the default.
        </p>
        <Switch
          checked={form.values.enabled}
          disabled={form.pending}
          onChange={(checked) => form.set("enabled", checked)}
        >
          Enabled
        </Switch>
      </FormFrame.Fields>
    </FormDialog>
  )
}
