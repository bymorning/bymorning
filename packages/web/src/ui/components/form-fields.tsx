import { fieldActive, type Form } from "@bymorning/schema/form"
import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { SearchableSelectPopover } from "./select-dialog"
import { Button } from "./button"
import { Checkbox } from "./checkbox"
import { Field } from "./field"
import { Icon } from "./icon"
import { Select } from "./select"
import { Switch as BooleanSwitch } from "./switch"
import { TextInput } from "./text-input"
import { Textarea } from "./textarea"
import { RadioGroup, RadioItem } from "./radio"
import "./form-fields.css"

export function FormFields(props: {
  readonly fields: ReadonlyArray<Form.Field>
  readonly answers: Readonly<Record<string, Form.Value | undefined>>
  readonly set: (key: string, value: Form.Value | undefined) => void
  readonly firstRef?: (element: HTMLElement) => void
  readonly presentation?: "default" | "session"
  readonly appearance?: "base" | "full-width"
  readonly choicePresentation?: "select" | "cards" | "search"
  readonly projectPathField?: string
}): JSX.Element {
  return (
    <div data-component="form-fields" data-variant={props.presentation ?? "default"} data-appearance={props.appearance}>
      <For each={props.fields}>
        {(field, index) => (
          <Show when={field.type === "external" || fieldActive(field, props.answers)}>
            <div data-slot="form-fields-question">
              <Field>
                <Field.Label>{field.title ?? field.key}</Field.Label>
                <Show when={field.description}>
                  {(description) => (
                    <Show when={props.presentation === "session"} fallback={<small>{description()}</small>}>
                      <p data-slot="form-fields-description">{description()}</p>
                    </Show>
                  )}
                </Show>
                {(() => {
                  if (field.type === "external") {
                    return (
                      <Show
                        when={props.presentation === "session"}
                        fallback={
                          <Checkbox
                            label={
                              <a href={field.url} target="_blank" rel="noreferrer">
                                Open and acknowledge
                                <span class="sr-only"> {field.title ?? field.key}, opens in a new tab</span>
                              </a>
                            }
                            required
                            checked={props.answers[field.key] === true}
                            onChange={(checked) => props.set(field.key, checked ? true : undefined)}
                          />
                        }
                      >
                        <div data-slot="form-fields-external">
                          <Button as="a" href={field.url} target="_blank" rel="noreferrer" variant="outline">
                            <span>Open link</span>
                            <span aria-hidden="true">↗</span>
                            <span class="sr-only"> {field.title ?? field.key}, opens in a new tab</span>
                          </Button>
                          <Checkbox
                            label={
                              <>
                                I opened and reviewed this page
                                <span class="sr-only">: {field.title ?? field.key}</span>
                              </>
                            }
                            required
                            checked={props.answers[field.key] === true}
                            onChange={(checked) => props.set(field.key, checked ? true : undefined)}
                          />
                        </div>
                      </Show>
                    )
                  }
                  if (field.type === "boolean") {
                    return (
                      <BooleanSwitch
                        checked={props.answers[field.key] === true}
                        aria-required={field.required}
                        hideLabel={props.presentation === "session"}
                        onChange={(checked) => props.set(field.key, checked)}
                      >
                        {field.title ?? field.key}
                      </BooleanSwitch>
                    )
                  }
                  if (field.type === "multiselect") {
                    return (
                      <div
                        data-slot="form-fields-options"
                        role="group"
                        aria-label={field.title ?? field.key}
                        aria-required={field.required}
                      >
                        <For each={field.options}>
                          {(option) => (
                            <Checkbox
                              label={option.label}
                              description={option.description}
                              checked={(() => {
                                const value = props.answers[field.key]
                                return Array.isArray(value) && value.includes(option.value)
                              })()}
                              onChange={(checked) => {
                                const current = props.answers[field.key]
                                const values = Array.isArray(current) ? current : []
                                props.set(
                                  field.key,
                                  checked
                                    ? [...new Set([...values, option.value])]
                                    : values.filter((value) => value !== option.value),
                                )
                              }}
                            />
                          )}
                        </For>
                        <Show when={field.custom}>
                          <div data-slot="form-fields-custom">
                            <TextInput
                              {...(index() === 0 && props.firstRef ? { inputRef: props.firstRef } : {})}
                              appearance={
                                props.appearance ?? (props.presentation === "session" ? "full-width" : "base")
                              }
                              aria-label={`${field.title ?? field.key} custom values`}
                              placeholder="Separate multiple answers with commas"
                              value={(() => {
                                const declared = new Set(field.options.map((option) => option.value))
                                const current = props.answers[field.key]
                                return Array.isArray(current)
                                  ? current.filter((value) => !declared.has(value)).join(", ")
                                  : ""
                              })()}
                              onInput={(event) => {
                                const declared = new Set(field.options.map((option) => option.value))
                                const current = props.answers[field.key]
                                const selected = Array.isArray(current)
                                  ? current.filter((value) => declared.has(value))
                                  : []
                                const custom = event.currentTarget.value
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter((value) => value !== "")
                                props.set(field.key, [...new Set([...selected, ...custom])])
                              }}
                            />
                          </div>
                        </Show>
                      </div>
                    )
                  }
                  if (
                    field.type === "string" &&
                    field.options &&
                    !field.custom &&
                    props.choicePresentation === "search"
                  ) {
                    return (
                      <SearchableChoiceField
                        title={field.title ?? field.key}
                        placeholder={field.placeholder}
                        options={field.options}
                        value={(() => {
                          const value = props.answers[field.key]
                          return typeof value === "string" ? value : undefined
                        })()}
                        onSelect={(value) => props.set(field.key, value)}
                      />
                    )
                  }
                  if (
                    field.type === "string" &&
                    field.options &&
                    !field.custom &&
                    props.choicePresentation !== "cards"
                  ) {
                    return (
                      <Select
                        aria-label={field.title ?? field.key}
                        options={[...field.options]}
                        label={(option) => option.label}
                        value={(option) => option.value}
                        current={field.options.find((option) => option.value === props.answers[field.key])}
                        onSelect={(option) => props.set(field.key, option?.value)}
                        {...(field.required === undefined ? {} : { required: field.required })}
                        appearance={props.appearance ?? (props.presentation === "session" ? "full-width" : "base")}
                        placeholder={field.placeholder ?? "Select an option"}
                      />
                    )
                  }
                  if (
                    field.type === "string" &&
                    field.options &&
                    (field.custom || props.choicePresentation === "cards")
                  ) {
                    const declared = () => new Set(field.options?.map((option) => option.value) ?? [])
                    return (
                      <>
                        <RadioGroup
                          aria-required={field.required}
                          value={
                            declared().has(String(props.answers[field.key] ?? ""))
                              ? String(props.answers[field.key])
                              : ""
                          }
                          onChange={(value) => props.set(field.key, value)}
                        >
                          <For each={field.options}>
                            {(option) => (
                              <RadioItem value={option.value} label={option.label} description={option.description} />
                            )}
                          </For>
                        </RadioGroup>
                        <Show when={field.custom}>
                          <div data-slot="form-fields-custom">
                            <TextInput
                              {...(index() === 0 && props.firstRef ? { inputRef: props.firstRef } : {})}
                              appearance={
                                props.appearance ?? (props.presentation === "session" ? "full-width" : "base")
                              }
                              aria-label={`${field.title ?? field.key} custom value`}
                              placeholder="Type your own answer"
                              value={
                                declared().has(String(props.answers[field.key] ?? ""))
                                  ? ""
                                  : String(props.answers[field.key] ?? "")
                              }
                              onInput={(event) => props.set(field.key, event.currentTarget.value)}
                            />
                          </div>
                        </Show>
                      </>
                    )
                  }
                  if (field.type === "string" && field.multiline) {
                    return (
                      <Textarea
                        {...(index() === 0 && props.firstRef ? { ref: props.firstRef } : {})}
                        name={field.key}
                        rows={8}
                        appearance={props.appearance ?? (props.presentation === "session" ? "full-width" : "base")}
                        required={field.required}
                        minLength={field.minLength}
                        maxLength={field.maxLength}
                        placeholder={field.placeholder}
                        value={String(props.answers[field.key] ?? "")}
                        onInput={(event) => props.set(field.key, event.currentTarget.value)}
                      />
                    )
                  }
                  return (
                    <TextInput
                      {...(index() === 0 && props.firstRef ? { inputRef: props.firstRef } : {})}
                      name={field.key}
                      type={
                        field.type === "string"
                          ? field.secret
                            ? "password"
                            : field.format === "date-time"
                              ? "datetime-local"
                              : (field.format ?? "text")
                          : "number"
                      }
                      autocomplete={field.type === "string" && field.secret ? "new-password" : undefined}
                      required={field.required}
                      minLength={field.type === "string" ? field.minLength : undefined}
                      maxLength={field.type === "string" ? field.maxLength : undefined}
                      min={field.type === "number" || field.type === "integer" ? field.minimum : undefined}
                      max={field.type === "number" || field.type === "integer" ? field.maximum : undefined}
                      step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
                      placeholder={field.type === "string" ? field.placeholder : undefined}
                      leadingIcon={
                        field.type === "string" && field.key === props.projectPathField ? (
                          <Icon name="folder" />
                        ) : undefined
                      }
                      appearance={props.appearance ?? (props.presentation === "session" ? "full-width" : "base")}
                      value={String(props.answers[field.key] ?? "")}
                      onInput={(event) =>
                        props.set(
                          field.key,
                          field.type === "number" || field.type === "integer"
                            ? event.currentTarget.value === ""
                              ? undefined
                              : event.currentTarget.valueAsNumber
                            : event.currentTarget.value,
                        )
                      }
                    />
                  )
                })()}
              </Field>
            </div>
          </Show>
        )}
      </For>
    </div>
  )
}

function SearchableChoiceField(props: {
  readonly title: string
  readonly placeholder: string | undefined
  readonly options: ReadonlyArray<Form.Option>
  readonly value: string | undefined
  readonly onSelect: (value: string) => void
}) {
  const [state, setState] = createStore({ open: false })
  const selected = () => props.options.find((option) => option.value === props.value)
  const display = () => selected()?.label ?? props.placeholder ?? `Select ${props.title}`

  return (
    <SearchableSelectPopover
      label={props.title}
      searchLabel={`Search ${props.title.toLowerCase()}`}
      emptyLabel={`No ${props.title.toLowerCase()} options found`}
      size="large"
      open={state.open}
      onOpenChange={(open) => setState("open", open)}
      model={{
        options: () =>
          props.options.map((option) => ({
            key: option.value,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
          })),
        current: () => props.value,
        pending: () => false,
        select: props.onSelect,
      }}
      trigger={(triggerProps) => (
        <Button
          {...triggerProps}
          type="button"
          variant="outline"
          data-slot="searchable-choice-trigger"
          aria-label={props.title}
        >
          <span data-slot="searchable-choice-trigger-label">{display()}</span>
          <Icon name="chevron-down" size="small" />
        </Button>
      )}
    />
  )
}
