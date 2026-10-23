import { ModelError, Plugin } from "@bymorning/plugin"

type CompanyPolicyOptions = Readonly<{
  restrictProvider: boolean
}>

const restrictedProvider = "restricted"
const customerId = /\bCUST-\d{8}\b/g
const redacted = "CUST-[redacted]"

const options = (value: Readonly<Record<string, unknown>>): CompanyPolicyOptions => ({
  // Provider restriction is fail-closed when a caller bypasses the configuration form.
  restrictProvider: typeof value.restrictProvider === "boolean" ? value.restrictProvider : true,
})

const denied = () =>
  new ModelError({
    reason: "denied",
    message: "This Provider is restricted by company policy.",
  })

const providerOf = (model: string) => {
  const slash = model.indexOf("/")
  return slash < 0 ? undefined : model.slice(0, slash)
}

const redact = (value: unknown): unknown => {
  if (typeof value === "string") return value.replace(customerId, redacted)
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

/** Workspace-wide Provider admission and Gateway customer-ID redaction example. */
export default Plugin.define({
  id: "example.company-policy",
  scope: "workspace",
  configuration: {
    title: "Company policy",
    description: "Denies Provider ID restricted by default and redacts customer IDs from Gateway request bodies.",
    fields: [
      {
        key: "restrictProvider",
        type: "boolean",
        title: "Restrict provider",
        description: "Deny inference that resolves to Provider ID restricted. Enabled by default.",
        default: true,
      },
    ],
  },
  async setup(context) {
    const { restrictProvider } = options(context.options)
    const admit = (input: { readonly model: { readonly provider: string } }) => {
      if (restrictProvider && input.model.provider === restrictedProvider) return denied()
    }
    await Promise.all([
      context.session.hook("model.invoke", admit),
      context.gateway.hook("model.invoke", admit),
      context.gateway.hook("model.request", (input) => {
        redact(input.body)
        if (!restrictProvider) return
        const model = providerOf(input.model)
        const requested = providerOf(input.requestedModel)
        if (model === restrictedProvider || requested === restrictedProvider) return denied()
      }),
    ])
  },
})
