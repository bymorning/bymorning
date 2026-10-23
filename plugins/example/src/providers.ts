import { ModelError, Plugin } from "@bymorning/plugin"

const name = /^(?!prv_)[a-z0-9][a-z0-9._-]*$/

const options = (value: Readonly<Record<string, unknown>>) => {
  const raw = value.allowed === undefined ? "" : value.allowed
  if (typeof raw !== "string") throw new Error('Provider allowlist option "allowed" must be a string')
  const allowed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (allowed.some((item) => !name.test(item))) {
    throw new Error('Provider allowlist option "allowed" must be a comma-separated list of Provider names')
  }
  return { allowed: new Set(allowed) }
}

const denied = (provider: string) =>
  new ModelError({
    reason: "denied",
    message: `Provider ${provider} is not on the company allowlist.`,
  })

const providerOf = (model: string) => {
  const slash = model.indexOf("/")
  return slash <= 0 ? undefined : model.slice(0, slash)
}

/** Admits only configured Provider names. An empty list admits every Provider. */
export default Plugin.define({
  id: "example.providers",
  scope: "workspace",
  configuration: {
    title: "Provider allowlist",
    description: "When the list is non-empty, only those Provider names may be invoked. Empty admits all.",
    fields: [
      {
        key: "allowed",
        type: "string",
        title: "Allowed providers",
        description: "Comma-separated Provider names, for example anthropic,openai. Leave empty to admit all.",
        default: "",
      },
    ],
  },
  async setup(context) {
    const { allowed } = options(context.options)
    const admit = (input: { readonly model: { readonly provider: string } }) => {
      if (allowed.size === 0) return
      if (!allowed.has(input.model.provider)) return denied(input.model.provider)
    }
    await Promise.all([
      context.session.hook("model.invoke", admit),
      context.gateway.hook("model.invoke", admit),
      context.gateway.hook("model.request", (input) => {
        if (allowed.size === 0) return
        const model = providerOf(input.model)
        const requested = providerOf(input.requestedModel)
        if (model !== undefined && !allowed.has(model)) return denied(model)
        if (requested !== undefined && !allowed.has(requested)) return denied(requested)
      }),
    ])
  },
})
