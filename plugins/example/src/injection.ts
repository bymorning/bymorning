import { ModelError, Plugin } from "@bymorning/plugin"

const defaultPattern = "ignore (all )?previous instructions|dan mode"

const options = (value: Readonly<Record<string, unknown>>) => {
  const enabled = typeof value.enabled === "boolean" ? value.enabled : true
  const source = typeof value.pattern === "string" && value.pattern.length > 0 ? value.pattern : defaultPattern
  let pattern: RegExp
  try {
    pattern = new RegExp(source, "i")
  } catch {
    throw new Error('Injection option "pattern" must be a valid regular expression')
  }
  return { enabled, pattern }
}

const blocked = () =>
  new ModelError({
    reason: "denied",
    message: "This request was blocked by prompt-injection policy.",
  })

const matches = (value: unknown, pattern: RegExp): boolean => {
  if (typeof value === "string") return pattern.test(value)
  if (Array.isArray(value)) return value.some((item) => matches(item, pattern))
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((item) => matches(item, pattern))
  }
  return false
}

/**
 * Refuses Gateway requests whose native body matches a configured pattern.
 * Session `prompt` cannot return ModelError; matching Session text is replaced
 * rather than refused.
 */
export default Plugin.define({
  id: "example.injection",
  scope: "workspace",
  configuration: {
    title: "Prompt injection",
    description: "Blocks Gateway requests matching a pattern. Session prompts that match are rewritten, not refused.",
    fields: [
      { key: "enabled", type: "boolean", title: "Enable injection checks", default: true },
      {
        key: "pattern",
        type: "string",
        title: "Match pattern",
        description: "JavaScript regular expression tested against request text. Case-insensitive.",
        default: defaultPattern,
        required: true,
      },
    ],
  },
  async setup(context) {
    const { enabled, pattern } = options(context.options)
    if (!enabled) return
    await Promise.all([
      context.session.hook("prompt", (input) => {
        if (pattern.test(input.prompt.text)) input.prompt.text = "[Request blocked by policy]"
      }),
      context.gateway.hook("model.request", (input) => {
        if (matches(input.body, pattern)) return blocked()
      }),
    ])
  },
})
