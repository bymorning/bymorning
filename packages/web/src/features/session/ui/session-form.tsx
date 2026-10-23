import { Show, type Accessor, type JSX } from "solid-js"
import type { FormFieldValue, FormViewModel } from "./form-model"
import { FormView } from "./form-view"

export declare namespace SessionForm {
  export interface Model {
    readonly item: Accessor<FormViewModel | undefined>
    readonly lifecycle: Accessor<number | undefined>
    readonly answers: Accessor<Readonly<Record<string, FormFieldValue | undefined>>>
    readonly set: (key: string, value: FormFieldValue | undefined) => void
    readonly pendingAction: Accessor<"submit" | "back" | "cancel" | undefined>
    readonly error: Accessor<string | undefined>
    readonly submit: () => void | Promise<void>
    readonly back: () => void | Promise<void>
    readonly cancel: () => void | Promise<void>
  }
}

export function SessionForm(props: {
  readonly model: SessionForm.Model
  readonly primary: (node: HTMLElement) => void
}): JSX.Element {
  return (
    <Show keyed when={props.model.lifecycle()}>
      {(_lifecycle) => (
        <Show when={props.model.item()}>
          {(item) => (
            <FormView
              item={item()}
              answers={props.model.answers()}
              set={props.model.set}
              pendingAction={props.model.pendingAction()}
              error={props.model.error()}
              primary={props.primary}
              onSubmit={() => void props.model.submit()}
              onBack={() => void props.model.back()}
              onCancel={() => void props.model.cancel()}
            />
          )}
        </Show>
      )}
    </Show>
  )
}
