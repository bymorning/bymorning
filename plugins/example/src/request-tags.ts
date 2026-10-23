import { Plugin } from "@bymorning/plugin"

const costCenterPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/
const headerPattern = /^[\t\x20-\x7e]*$/

function options(input: Readonly<Record<string, unknown>>) {
  const providerID = input.providerID
  if (typeof providerID !== "string" || providerID.length === 0) {
    throw new Error('Request tags option "providerID" must be a provider ID')
  }

  const costCenter = input.costCenter
  // Form normalization omits blank optional strings. Accept one defensively in
  // case this plugin is activated directly with raw options.
  if (costCenter === "") return { providerID }
  if (costCenter !== undefined && (typeof costCenter !== "string" || !costCenterPattern.test(costCenter))) {
    throw new Error(
      'Request tags option "costCenter" must contain only letters, numbers, dot, slash, dash, or underscore',
    )
  }
  return { providerID, ...(costCenter === undefined ? {} : { costCenter }) }
}

function header(value: string) {
  return headerPattern.test(value) ? value : undefined
}

/** Adds trace tags to Session inference requests for one configured provider. */
export default Plugin.define({
  id: "example.request-tags",
  configuration: {
    title: "Request tags",
    description: "Adds non-secret trace headers to Session model requests for one provider.",
    fields: [
      {
        key: "providerID",
        type: "string",
        title: "Provider ID",
        required: true,
        placeholder: "openai",
      },
      {
        key: "costCenter",
        type: "string",
        title: "Cost center",
        description: "Optional non-secret tag: letters, numbers, dot, slash, dash, and underscore only.",
        maxLength: 64,
      },
    ],
  },
  async setup(context) {
    const configured = options(context.options)
    await context.session.hook("model.request", (event) => {
      // This hook applies to physical Session inference only. `purpose`
      // distinguishes assistant, generate, compaction, and title requests.
      if (event.model.provider !== configured.providerID) return

      const sessionID = header(event.sessionID)
      if (sessionID !== undefined) event.headers["X-ByMorning-Session-ID"] = sessionID
      event.headers["X-ByMorning-Purpose"] = event.purpose
      if (configured.costCenter !== undefined) event.headers["X-ByMorning-Cost-Center"] = configured.costCenter
    })
  },
})
