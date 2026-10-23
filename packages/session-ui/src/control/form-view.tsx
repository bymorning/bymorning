import { createEffect, For, on, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

import { useSession } from "../context/session.js"
import type { FormField } from "@bymorning/client"
import type { SessionUI } from "../model.js"
import { active, defaults, normalize, validate } from "./form-model.js"
import "./form-view.css"

type Value = SessionUI.FormProps["answer"] extends () => infer Answer
  ? Answer extends Record<string, infer Item>
    ? Item | undefined
    : never
  : never

export function FormView(props: { readonly model: SessionUI.FormProps }): JSX.Element {
  const session = useSession()
  const [state, setState] = createStore({
    error: undefined as string | undefined,
    invalidKey: undefined as string | undefined,
  })
  const visible = (field: FormField) => active(field, props.model.answer())

  createEffect(
    on(
      () => props.model.item()?.id,
      () => {
        setState({ error: undefined, invalidKey: undefined })
      },
    ),
  )

  const submit = () => {
    const item = props.model.item()
    if (!item) return
    const answer = normalize(item.fields, { ...defaults(item.fields), ...props.model.answer() })
    const error = validate(item.fields, answer)
    if (error) {
      const field = item.fields.find((field) => error.endsWith(`: ${field.key}`))
      setState({ error, invalidKey: field?.key })
      if (field)
        queueMicrotask(() => {
          const control = document.getElementById(`form-${item.id}-${field.key}`)
          if (
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLTextAreaElement
          )
            control.focus()
        })
      return
    }
    setState({ error: undefined, invalidKey: undefined })
    props.model.submit.run(answer)
  }

  return (
    <Show when={props.model.item()}>
      {(item) => {
        const formID = `form-${item().id}`
        const error = () => props.model.submit.error() ?? props.model.cancel.error() ?? props.model.back?.error()
        return (
          <form
            data-component="form-view"
            aria-labelledby={formID}
            aria-busy={props.model.submit.pending()}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <h2 id={formID}>{item().title}</h2>
            <fieldset
              disabled={props.model.submit.pending() || props.model.cancel.pending() || props.model.back?.pending()}
            >
              <For each={item().fields}>
                {(field) => (
                  <Show when={visible(field)}>
                    <Field
                      field={field}
                      formID={formID}
                      value={props.model.answer()[field.key]}
                      invalid={() => state.invalidKey === field.key}
                      error={() => (state.invalidKey === field.key ? state.error : undefined)}
                      set={(value) => {
                        if (state.invalidKey === field.key) setState({ error: undefined, invalidKey: undefined })
                        props.model.setAnswer(field.key, value)
                      }}
                    />
                  </Show>
                )}
              </For>
            </fieldset>
            <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
            <div data-slot="actions">
              <button type="button" disabled={props.model.cancel.pending()} onClick={props.model.cancel.run}>
                {session.labels().cancel}
              </button>
              <Show when={props.model.back}>
                {(back) => (
                  <button type="button" disabled={back().pending()} onClick={back().run}>
                    {session.labels().back}
                  </button>
                )}
              </Show>
              <button type="submit" disabled={props.model.submit.pending()}>
                {session.labels().submit}
              </button>
            </div>
          </form>
        )
      }}
    </Show>
  )
}

function Field(props: {
  readonly field: FormField
  readonly formID: string
  readonly value: Value
  readonly invalid: () => boolean
  readonly error: () => string | undefined
  readonly set: (value: Value) => void
}): JSX.Element {
  const id = `${props.formID}-${props.field.key}`
  const errorID = `${id}-error`
  const numeric = props.field.type === "number" || props.field.type === "integer"
  const numericInvalid = () =>
    numeric &&
    props.value !== undefined &&
    (typeof props.value !== "number" ||
      !Number.isFinite(props.value) ||
      (props.field.type === "integer" && !Number.isInteger(props.value)) ||
      (props.field.minimum !== undefined && props.value < props.field.minimum) ||
      (props.field.maximum !== undefined && props.value > props.field.maximum))
  const invalid = () => props.invalid() || numericInvalid()
  const describedBy = () => (props.error() ? errorID : undefined)
  const title = () => props.field.title ?? props.field.key
  const error = () => (
    <Show when={props.error()}>
      {(message) => (
        <small id={errorID} role="alert">
          {message()}
        </small>
      )}
    </Show>
  )

  if (props.field.type === "external")
    return (
      <label data-slot="field" for={id}>
        <span>{title()}</span>
        <Show when={props.field.description}>{(description) => <small>{description()}</small>}</Show>
        <a href={props.field.url}>{props.field.url}</a>
      </label>
    )
  if (props.field.type === "multiselect")
    return (
      <fieldset data-slot="field">
        <legend>{title()}</legend>
        <select
          id={id}
          multiple
          required={props.field.required}
          value={Array.isArray(props.value) ? props.value : []}
          aria-invalid={invalid() || undefined}
          aria-describedby={describedBy()}
          onChange={(event) => props.set([...event.currentTarget.selectedOptions].map((option) => option.value))}
        >
          <For each={props.field.options}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select>
        {error()}
      </fieldset>
    )
  if (props.field.type === "boolean")
    return (
      <>
        <label data-slot="field" for={id}>
          <span>{title()}</span>
          <input
            id={id}
            type="checkbox"
            required={props.field.required}
            checked={props.value === true}
            aria-invalid={invalid() || undefined}
            aria-describedby={describedBy()}
            onChange={(event) => props.set(event.currentTarget.checked)}
          />
        </label>
        {error()}
      </>
    )
  const input = (
    <input
      id={id}
      type={numeric ? "number" : props.field.type === "string" && props.field.secret ? "password" : "text"}
      value={props.value === undefined ? "" : String(props.value)}
      required={props.field.required}
      pattern={props.field.type === "string" ? props.field.pattern : undefined}
      minLength={props.field.type === "string" ? props.field.minLength : undefined}
      maxLength={props.field.type === "string" ? props.field.maxLength : undefined}
      min={numeric ? props.field.minimum : undefined}
      max={numeric ? props.field.maximum : undefined}
      step={props.field.type === "integer" ? 1 : numeric ? "any" : undefined}
      aria-invalid={invalid() || undefined}
      aria-describedby={describedBy()}
      onInput={(event) => {
        const raw = event.currentTarget.value
        props.set(raw === "" ? undefined : numeric ? Number(raw) : raw)
      }}
    />
  )
  const textarea = (
    <textarea
      id={id}
      required={props.field.required}
      minLength={props.field.type === "string" ? props.field.minLength : undefined}
      maxLength={props.field.type === "string" ? props.field.maxLength : undefined}
      aria-invalid={invalid() || undefined}
      aria-describedby={describedBy()}
      value={props.value === undefined ? "" : String(props.value)}
      onInput={(event) => props.set(event.currentTarget.value || undefined)}
    />
  )
  return (
    <>
      <label data-slot="field" for={id}>
        <span>{title()}</span>
        <Show when={props.field.description}>{(description) => <small>{description()}</small>}</Show>
        <Show when={props.field.type === "string" && props.field.multiline} fallback={input}>
          {textarea}
        </Show>
      </label>
      {error()}
    </>
  )
}
