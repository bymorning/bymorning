import { Plugin, Tool } from "@bymorning/plugin"

const ssn = /\b\d{3}-\d{2}-\d{4}\b/g
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const secret = /\b(?:sk-|ghp_|AKIA)[A-Za-z0-9_-]{8,}\b/g

const redactText = (value: string) => value.replace(ssn, "[SSN]").replace(email, "[EMAIL]").replace(secret, "[SECRET]")

const redact = (value: unknown): unknown => {
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) value[index] = redact(value[index])
    return value
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) record[key] = redact(record[key])
    return record
  }
  return value
}

/** Redacts SSN, email, and common secret prefixes from Session, Gateway, and Tool payloads. */
export default Plugin.define({
  id: "example.redaction",
  scope: "workspace",
  configuration: {
    title: "PII and secret redaction",
    description: "Replaces SSN, email, and common API-key prefixes before inference and Tool I/O.",
    fields: [
      {
        key: "enabled",
        type: "boolean",
        title: "Enable redaction",
        default: true,
      },
    ],
  },
  async setup(context) {
    if (context.options.enabled === false) return
    await Promise.all([
      context.session.hook("prompt", (input) => {
        input.prompt.text = redactText(input.prompt.text)
      }),
      context.gateway.hook("model.request", (input) => {
        redact(input.body)
      }),
      context.tool.hook("execute.before", (input) => {
        input.input = redact(input.input)
      }),
      context.tool.hook("execute.after", (input) => {
        if (input.status !== "completed") return
        redact(input.result)
      }),
      context.gateway.hook("tool.execute.before", (input) => {
        input.input = redact(input.input)
      }),
      context.gateway.hook("tool.execute.after", (input) => {
        if (input.status !== "completed") return
        redact(input.result)
      }),
    ])
  },
})
