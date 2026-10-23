const oauthErrors = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "access_denied",
  "server_error",
  "temporarily_unavailable",
  "unsupported_response_type",
  "unsupported_token_type",
  "invalid_token",
  "method_not_allowed",
  "too_many_requests",
  "invalid_client_metadata",
  "invalid_redirect_uri",
  "insufficient_scope",
  "invalid_target",
])

/** Prevent SDK diagnostics from retaining untrusted HTTP error bodies or OAuth
 * descriptions. Status and recognized OAuth codes still drive the SDK protocol. */
export const request = (async (input, init) => {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch {
    throw new Error("MCP HTTP request failed")
  }
  if (response.ok) return response
  let error = "server_error"
  try {
    const value = await response.json() as unknown
    if (
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string" &&
      oauthErrors.has(value.error)
    )
      error = value.error
  } catch {
    // A non-OAuth error response has no safe protocol fields to retain.
  }
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  headers.delete("content-encoding")
  headers.set("content-type", "application/json")
  return new Response(response.status === 304 ? null : JSON.stringify({ error }), { status: response.status, headers })
}) as typeof fetch
