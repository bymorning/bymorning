import { SessionError } from "@bymorning/schema/session-error"

import type { Provider } from "../provider.js"

/** Render a Provider failure as the Session error shown in the timeline, keeping its diagnostics. */
export function providerSessionError(failure: Provider.FailureError) {
  const provider = failure.provider?.replace(
    /(^|-)([a-z])/g,
    (_, separator: string, letter: string) => `${separator === "-" ? " " : ""}${letter.toUpperCase()}`,
  )
  const description =
    {
      auth: "authentication failed",
      "rate-limit": "rate limit exceeded",
      quota: "quota exceeded",
      "content-filter": "content filter blocked the response",
      transport: "transport failed",
      internal: "internal error",
      "invalid-request": "invalid request",
      "context-overflow": "context window exceeded",
      unknown: "request failed",
    }[failure.category ?? "unknown"] ?? "request failed"
  const summary = `${provider ?? "Provider"}: ${description}${failure.status === undefined ? "" : ` (${failure.status})`}`
  return SessionError.Provider.make({
    message: `${summary}: ${failure.message ?? "Provider execution failed"}`,
    ...(failure.category === undefined ? {} : { category: failure.category }),
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.provider === undefined ? {} : { provider: failure.provider }),
    ...(failure.model === undefined ? {} : { model: failure.model }),
    ...(failure.requestID === undefined ? {} : { requestID: failure.requestID }),
    ...(failure.responseBody === undefined ? {} : { responseBody: failure.responseBody }),
    ...(failure.bodyTruncated === undefined ? {} : { bodyTruncated: failure.bodyTruncated }),
  })
}
