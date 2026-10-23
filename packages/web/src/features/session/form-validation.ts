import { Form } from "@bymorning/schema/form"

import type { FormField, FormFieldValue } from "./ui/form-model"

/** First client-side form constraint violation, or undefined when the answers are valid. */
export function validateForm(
  fields: ReadonlyArray<FormField>,
  answers: Readonly<Record<string, FormFieldValue | undefined>>,
) {
  return Form.validate(fields, Form.normalize(fields, answers))
}

/** Whether any field carries a non-blank answer. */
export function answered(
  fields: ReadonlyArray<FormField>,
  answers: Readonly<Record<string, FormFieldValue | undefined>>,
) {
  return Object.values(Form.normalize(fields, answers)).some((value) =>
    typeof value === "string" ? value.trim() !== "" : Array.isArray(value) ? value.length > 0 : true,
  )
}
