/** Plain view-model types for the session form UI. They mirror the generated form shapes so
 `FormInfo` flows in and fields flow out to shared renderers without this directory importing
 generated client or schema modules. */
export type FormFieldValue = string | number | boolean | ReadonlyArray<string>
export type FormFieldOption = { value: string; label: string; description?: string | undefined }
export type FormFieldWhen = { key: string; op: "eq" | "neq"; value: string | number | boolean }

export type FormField =
  | {
      readonly type: "string"
      readonly key: string
      readonly title?: string | undefined
      readonly description?: string | undefined
      readonly required?: boolean | undefined
      readonly when?: ReadonlyArray<FormFieldWhen> | undefined
      readonly secret?: boolean | undefined
      readonly multiline?: boolean | undefined
      readonly format?: "email" | "uri" | "date" | "date-time" | undefined
      readonly minLength?: number | undefined
      readonly maxLength?: number | undefined
      readonly pattern?: string | undefined
      readonly placeholder?: string | undefined
      readonly default?: string | undefined
      readonly options?: ReadonlyArray<FormFieldOption> | undefined
      readonly custom?: boolean | undefined
    }
  | {
      readonly type: "number"
      readonly key: string
      readonly title?: string | undefined
      readonly description?: string | undefined
      readonly required?: boolean | undefined
      readonly when?: ReadonlyArray<FormFieldWhen> | undefined
      readonly minimum?: number | undefined
      readonly maximum?: number | undefined
      readonly default?: number | undefined
    }
  | {
      readonly type: "integer"
      readonly key: string
      readonly title?: string | undefined
      readonly description?: string | undefined
      readonly required?: boolean | undefined
      readonly when?: ReadonlyArray<FormFieldWhen> | undefined
      readonly minimum?: number | undefined
      readonly maximum?: number | undefined
      readonly default?: number | undefined
    }
  | {
      readonly type: "boolean"
      readonly key: string
      readonly title?: string | undefined
      readonly description?: string | undefined
      readonly required?: boolean | undefined
      readonly when?: ReadonlyArray<FormFieldWhen> | undefined
      readonly default?: boolean | undefined
    }
  | {
      readonly type: "multiselect"
      readonly key: string
      readonly title?: string | undefined
      readonly description?: string | undefined
      readonly required?: boolean | undefined
      readonly when?: ReadonlyArray<FormFieldWhen> | undefined
      readonly options: ReadonlyArray<FormFieldOption>
      readonly minItems?: number | undefined
      readonly maxItems?: number | undefined
      readonly custom?: boolean | undefined
      readonly default?: ReadonlyArray<string> | undefined
    }
  | {
      readonly type: "external"
      readonly key: string
      readonly url: string
      readonly title?: string | undefined
      readonly description?: string | undefined
    }

export type FormItemMetadata = {
  kind?: string | undefined
  mode?: string | undefined
  stage?: string | undefined
  choicePresentation?: string | undefined
  canGoBack?: boolean | undefined
  nextLabel?: string | undefined
  navigation?: { actionKey?: unknown; backValue?: unknown } | undefined
}

/** A raw form item as delivered by the server; the projection input. */
export type FormItem = {
  readonly id: string
  readonly title: string
  readonly fields: ReadonlyArray<FormField>
  readonly metadata?: FormItemMetadata | undefined
}

/** A group of fields rendered together, optionally collapsed behind a disclosure. */
export type FormSection = {
  readonly fields: ReadonlyArray<FormField>
  readonly collapsedLabel?: string | undefined
}

/** A URL elicitation reduced to its two user decisions instead of exposing protocol fields. */
export type FormAuthorization = {
  readonly url: string
  readonly externalKey: string
  readonly actionKey: string
  readonly acceptValue: string
}

/** Everything the generic form view renders, projected from a raw form item by the session form
 controller. The view reads only these derived values so it stays independent of form metadata. */
export type FormViewModel = {
  readonly id: string
  readonly title: string
  /** Complete field list, including hidden navigation fields; the validation input. */
  readonly fields: ReadonlyArray<FormField>
  /** Field groups to render, already excluding hidden navigation fields. */
  readonly sections: ReadonlyArray<FormSection>
  readonly choicePresentation: "select" | "cards" | "search"
  readonly authorization?: FormAuthorization | undefined
  /** Field key that renders with a folder icon (the OpenAPI document path). */
  readonly projectPathField?: string | undefined
  readonly canGoBack: boolean
  readonly submitLabel: string
  /** At least one field must carry an answer before submit (Questions have no required flag). */
  readonly answerRequired?: boolean | undefined
}
