import { Plugin } from "@bymorning/plugin"

function options(input: Readonly<Record<string, unknown>>) {
  const maxRetries = input.maxRetries
  const minDelay = input.minDelay
  if (typeof maxRetries !== "number" || !Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error('Retry control option "maxRetries" must be a non-negative integer')
  }
  if (typeof minDelay !== "number" || !Number.isInteger(minDelay) || minDelay < 0) {
    throw new Error('Retry control option "minDelay" must be a non-negative integer')
  }
  return { maxRetries, minDelay }
}

/** Restricts automatic Session provider retries without changing retry eligibility. */
export default Plugin.define({
  id: "example.retry-control",
  configuration: {
    title: "Retry control",
    description: "Limits automatic Session provider retries and can enforce a minimum retry delay.",
    fields: [
      { key: "maxRetries", type: "integer", title: "Maximum retries", minimum: 0, default: 2 },
      { key: "minDelay", type: "integer", title: "Minimum delay (ms)", minimum: 0, default: 1000 },
    ],
  },
  async setup(context) {
    const configured = options(context.options)
    await context.session.hook("retry", (event) => {
      // The runner numbers the initial physical request as attempt 1, so this
      // retry hook first receives attempt 2. Never revive an earlier veto.
      if (!event.decision.retry) return
      if (event.attempt - 1 > configured.maxRetries) {
        event.decision = { retry: false }
        return
      }
      event.decision = { retry: true, delay: Math.max(event.decision.delay, configured.minDelay) }
    })
  },
})
