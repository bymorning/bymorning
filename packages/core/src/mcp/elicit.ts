/** Convert the MCP SDK's constrained elicitation wire forms to Tool input. */
export * as McpElicit from "./elicit.js"

import { Form } from "@bymorning/schema/form"
import { Tool } from "@bymorning/schema/tool"
import { Schema } from "effect"

export function input(value: unknown): Tool.ElicitInput {
  if (!record(value) || typeof value.message !== "string") throw new Error("Invalid MCP elicitation request")
  if (value.mode === "url") {
    if (typeof value.url !== "string") throw new Error("Invalid MCP elicitation URL")
    const url = new URL(value.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported MCP elicitation URL protocol")
    return { mode: "url", title: "MCP request", message: value.message, url: url.href }
  }
  if (!record(value.requestedSchema) || value.requestedSchema.type !== "object" || !record(value.requestedSchema.properties))
    throw new Error("Invalid MCP elicitation form")
  const entries = Object.entries(value.requestedSchema.properties)
  if (entries.length === 0) {
    // The synthetic Continue/Decline control is the explicit confirmation.
    return { mode: "form", title: "MCP request", message: value.message, fields: [text("confirmation", {})] }
  }
  const required = value.requestedSchema.required === undefined ? new Set<string>() : requiredKeys(value.requestedSchema.required, entries)
  const fields = entries.map(([key, schema]) => field(key, schema, required.has(key)))
  return {
    mode: "form",
    title: "MCP request",
    message: value.message,
    fields: Schema.decodeUnknownSync(Form.Fields)(fields),
  }
}

export const result = (value: Tool.ElicitResult) =>
  value.action === "accept"
    ? { action: "accept" as const, content: value.answer }
    : { action: value.action }

function field(key: string, value: unknown, required: boolean): Form.Field {
  if (!record(value) || typeof value.type !== "string") throw new Error(`Unsupported MCP elicitation field: ${key}`)
  const base = { title: string(value.title), description: string(value.description), required: required || undefined }
  if (value.type === "boolean") return clean({ key, type: "boolean" as const, ...base, default: boolean(value.default) })
  if (value.type === "number" || value.type === "integer")
    return clean({ key, type: value.type, ...base, minimum: number(value.minimum), maximum: number(value.maximum), default: number(value.default) }) as Form.Field
  if (value.type === "string") {
    const options = optionsOf(value)
    return clean({
      key,
      type: "string" as const,
      ...base,
      ...(options === undefined ? stringRules(value) : { options, default: string(value.default) }),
    }) as Form.Field
  }
  if (value.type === "array") {
    const options = optionsOf(value.items)
    if (options === undefined) throw new Error(`Unsupported MCP elicitation array: ${key}`)
    return clean({ key, type: "multiselect" as const, ...base, options, minItems: number(value.minItems), maxItems: number(value.maxItems), default: strings(value.default) })
  }
  throw new Error(`Unsupported MCP elicitation field: ${key}`)
}

function text(key: string, base: Record<string, unknown>): Form.StringField {
  const value = base as Record<string, unknown>
  const options = optionsOf(value)
  const rules = options === undefined ? stringRules(value) : { options, default: string(value.default) }
  return clean({ key, type: "string" as const, ...base, ...rules }) as Form.StringField
}

function stringRules(value: Record<string, unknown>) {
  const format = string(value.format)
  if (format !== undefined && !["email", "uri", "date", "date-time"].includes(format))
    throw new Error("Unsupported MCP elicitation string format")
  return {
    minLength: number(value.minLength), maxLength: number(value.maxLength), pattern: string(value.pattern),
    ...(format === undefined ? {} : { format }), default: string(value.default),
  }
}

function optionsOf(value: unknown): Form.Option[] | undefined {
  if (!record(value)) return undefined
  const structured = Array.isArray(value.oneOf) ? value.oneOf : Array.isArray(value.anyOf) ? value.anyOf : undefined
  const choices = Array.isArray(value.enum) ? value.enum : structured?.map((item) => record(item) ? item.const : undefined)
  if (choices === undefined) return undefined
  const labels = Array.isArray(value.enumNames) ? value.enumNames : undefined
  return choices.map((choice, index) => {
    if (typeof choice !== "string") throw new Error("Unsupported MCP elicitation option")
    const label = labels?.[index] ?? (structured !== undefined && record(structured[index]) ? structured[index].title : undefined)
    if (label !== undefined && typeof label !== "string") throw new Error("Invalid MCP elicitation option label")
    return { value: choice, label: label ?? choice }
  })
}

const requiredKeys = (value: unknown, entries: [string, unknown][]) => {
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string" || !entries.some(([name]) => name === key)))
    throw new Error("Invalid MCP elicitation required fields")
  return new Set(value)
}
const clean = <A extends Record<string, unknown>>(value: A) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as A
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const string = (value: unknown) => typeof value === "string" ? value : undefined
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined
const boolean = (value: unknown) => typeof value === "boolean" ? value : undefined
const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined
