import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { answered, validateForm } from "../form-validation"
import { FormFields } from "../../../ui/components/form-fields"
import { Button } from "../../../ui/components/button"
import { Icon } from "../../../ui/components/icon"
import type { FormFieldValue, FormViewModel } from "./form-model"
import "./form-view.css"

export function FormView(props: {
  readonly item: FormViewModel
  readonly answers: Readonly<Record<string, FormFieldValue | undefined>>
  readonly set: (key: string, value: FormFieldValue | undefined) => void
  readonly pendingAction: "submit" | "back" | "cancel" | undefined
  readonly error: string | undefined
  readonly primary?: (node: HTMLElement) => void
  readonly onSubmit: () => void
  readonly onBack?: () => void
  readonly onCancel: () => void
}): JSX.Element {
  const [state, setState] = createStore({ validationError: undefined as string | undefined })
  const pending = () => props.pendingAction !== undefined
  const setAnswer = (key: string, value: FormFieldValue | undefined) => {
    setState("validationError", undefined)
    props.set(key, value)
  }

  return (
    <form
      data-component="form-view"
      aria-labelledby={`form-title-${props.item.id}`}
      aria-busy={pending()}
      onSubmit={(event) => {
        event.preventDefault()
        const invalid =
          validateForm(props.item.fields, props.answers) ??
          (props.item.answerRequired && !answered(props.item.fields, props.answers)
            ? "Answer at least one question, or choose Cancel to skip."
            : undefined)
        setState("validationError", invalid)
        if (invalid) return
        props.onSubmit()
      }}
    >
      <header data-slot="form-view-header">
        <h2 id={`form-title-${props.item.id}`}>{props.item.title}</h2>
      </header>
      <Show when={props.item.authorization === undefined}>
        <fieldset disabled={pending()}>
          <legend class="sr-only">{props.item.title}</legend>
          <div data-slot="form-view-scroll">
            <For each={props.item.sections}>
              {(section) => (
                <Show
                  when={section.collapsedLabel}
                  fallback={
                    <FormFields
                      fields={section.fields}
                      answers={props.answers}
                      set={setAnswer}
                      presentation="session"
                      choicePresentation={props.item.choicePresentation}
                      {...(props.item.projectPathField === undefined
                        ? {}
                        : { projectPathField: props.item.projectPathField })}
                      {...(props.primary ? { firstRef: props.primary } : {})}
                    />
                  }
                >
                  {(label) => (
                    <FormViewSettings label={label()}>
                      <FormFields
                        fields={section.fields}
                        answers={props.answers}
                        set={setAnswer}
                        presentation="session"
                        choicePresentation={props.item.choicePresentation}
                      />
                    </FormViewSettings>
                  )}
                </Show>
              )}
            </For>
          </div>
        </fieldset>
      </Show>
      {/* The slot keeps its line while empty so showing or clearing a message does not move the buttons. */}
      <div data-slot="form-view-message">
        <Show when={state.validationError ?? props.error}>
          {(message) => (
            <p data-slot="form-view-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </div>
      <div data-slot="form-view-actions" role="group" aria-label="Form response">
        <Button type="button" variant="outline" disabled={pending()} onClick={props.onCancel}>
          {props.pendingAction === "cancel" ? "Cancelling…" : "Cancel"}
        </Button>
        <Show
          when={props.item.authorization}
          fallback={
            <>
              <Show when={props.item.canGoBack}>
                <Button type="button" variant="outline" disabled={pending()} onClick={() => props.onBack?.()}>
                  {props.pendingAction === "back" ? "Going back…" : "Back"}
                </Button>
              </Show>
              <Button type="submit" variant="primary" disabled={pending()}>
                {props.pendingAction === "submit" ? "Submitting…" : props.item.submitLabel}
              </Button>
            </>
          }
        >
          {(authorization) => (
            <Button
              as="a"
              href={authorization().url}
              target="_blank"
              rel="noreferrer"
              variant="primary"
              aria-disabled={pending()}
              onClick={(event: MouseEvent) => {
                if (pending()) {
                  event.preventDefault()
                  return
                }
                props.set(authorization().externalKey, true)
                props.set(authorization().actionKey, authorization().acceptValue)
                props.onSubmit()
              }}
            >
              {props.pendingAction === "submit" ? "Authorizing…" : "Authorize"}
              <span class="sr-only">, opens in a new tab</span>
            </Button>
          )}
        </Show>
      </div>
    </form>
  )
}

function FormViewSettings(props: { readonly label: string; readonly children: JSX.Element }): JSX.Element {
  const [state, setState] = createStore({ open: false })
  return (
    <div data-component="form-view-settings" data-open={state.open ? "true" : "false"}>
      <button
        type="button"
        data-slot="form-view-settings-trigger"
        aria-expanded={state.open}
        onClick={() => setState("open", !state.open)}
      >
        <span data-slot="form-view-settings-arrow" aria-hidden="true">
          <Icon name="chevron-down" size="small" />
        </span>
        <span>{props.label}</span>
      </button>
      <Show when={state.open}>
        <div data-slot="form-view-settings-content">
          <div data-slot="form-view-settings-fields">{props.children}</div>
        </div>
      </Show>
    </div>
  )
}
