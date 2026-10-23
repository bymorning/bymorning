import type { FormAnswer, FormField } from "@bymorning/client"

type Value = FormAnswer[string] | undefined

export function defaults(fields: readonly FormField[]): FormAnswer {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.type !== "external" && !(field.type === "string" && field.secret) && field.default !== undefined
        ? [[field.key, field.default]]
        : [],
    ),
  )
}

export function active(field: FormField, answer: Readonly<Record<string, Value>>): boolean {
  if (field.type === "external" || !field.when) return true
  return field.when.every((condition) => {
    const value = answer[condition.key]
    if (value === undefined) return false
    const matches = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value
    return condition.op === "eq" ? matches : !matches
  })
}

export function normalize(fields: readonly FormField[], answer: Readonly<Record<string, Value>>): FormAnswer {
  // Conditions are evaluated against the complete candidate, rather than the output being built.
  // A valid condition may reference an earlier field whose value is already present in `answer`.
  const candidate = answer
  const result: Record<string, Exclude<Value, undefined>> = {}
  for (const field of fields) {
    if (field.type === "external" || !active(field, candidate)) continue
    const value = answer[field.key]
    if (value !== undefined && value !== "") result[field.key] = value
  }
  return result
}

export function validate(fields: readonly FormField[], answer: Readonly<Record<string, Value>>): string | undefined {
  const keys = new Set(fields.map((field) => field.key))
  for (const key of Object.keys(answer)) if (!keys.has(key)) return `Unknown form field: ${key}`
  for (const field of fields) {
    const value = answer[field.key]
    // External fields are informational links. They do not have an answer and must not make a
    // form impossible to submit.
    if (field.type === "external") continue
    const visible = active(field, answer)
    if (value === undefined) {
      if (field.required && visible) return `Missing required form field: ${field.key}`
      continue
    }
    if (!visible) return `Form field is not active: ${field.key}`
    if (field.type === "string") {
      if (typeof value !== "string") return `Expected string for form field: ${field.key}`
      if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
      if (field.minLength !== undefined && value.length < field.minLength)
        return `Form field is too short: ${field.key}`
      if (field.maxLength !== undefined && value.length > field.maxLength) return `Form field is too long: ${field.key}`
      if (field.pattern !== undefined)
        try {
          if (!new RegExp(field.pattern).test(value)) return `Form field does not match pattern: ${field.key}`
        } catch {
          return `Form field has invalid pattern: ${field.key}`
        }
      if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        return `Expected email for form field: ${field.key}`
      if (field.format === "uri" && !URL.canParse(value)) return `Expected URI for form field: ${field.key}`
      if (field.format === "date") {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined
        if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
          return `Expected date for form field: ${field.key}`
      }
      if (field.format === "date-time" && Number.isNaN(new Date(value).getTime()))
        return `Expected date-time for form field: ${field.key}`
      if (field.options && !field.custom && !field.options.some((option) => option.value === value))
        return `Invalid option for form field: ${field.key}`
      continue
    }
    if (field.type === "number" || field.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value)) return `Expected number for form field: ${field.key}`
      if (field.type === "integer" && !Number.isInteger(value)) return `Expected integer for form field: ${field.key}`
      if (field.minimum !== undefined && value < field.minimum) return `Form field is too small: ${field.key}`
      if (field.maximum !== undefined && value > field.maximum) return `Form field is too large: ${field.key}`
      continue
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") return `Expected boolean for form field: ${field.key}`
      continue
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
      return `Expected string array for form field: ${field.key}`
    if (field.required && value.length === 0) return `Missing required form field: ${field.key}`
    if (field.minItems !== undefined && value.length < field.minItems)
      return `Too few selections for form field: ${field.key}`
    if (field.maxItems !== undefined && value.length > field.maxItems)
      return `Too many selections for form field: ${field.key}`
    if (!field.custom && value.some((item) => !field.options.some((option) => option.value === item)))
      return `Invalid option for form field: ${field.key}`
  }
}
