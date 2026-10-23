export * as Diagnostics from "./diagnostics.js"

import { Error } from "./ai-error.js"
import { Headers, HttpClientRequest } from "effect/unstable/http"

const sensitive = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|credential|signature|x-amz-signature/i
const queryKey = /^(key|sig)$/i
const field = `(?:${sensitive.source}|key)`
const jsonField = new RegExp(`("${field}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi")
const queryField = new RegExp(`((?:${field}|key|sig)=)[^&\\s"]+`, "gi")
const redacted = "<redacted>"

/** Request-local diagnostics redaction; provider credentials never enter persisted failures. */
export const make = () => {
  const secrets = new Set<string>()
  const add = (value: string) => {
    if (value.length < 4) return
    secrets.add(value)
    secrets.add(encodeURIComponent(value))
  }
  const captureBody = (body: HttpClientRequest.HttpClientRequest["body"]) => {
    // Do not consume streaming bodies just to improve diagnostics. The normal
    // provider JSON/form bodies are materialized and can safely contribute
    // their credential values to this request-local redactor.
    const value = "body" in body ? body.body : undefined
    const text = typeof value === "string"
      ? value
      : value instanceof Uint8Array
        ? new TextDecoder().decode(value)
        : undefined
    if (text === undefined) return
    for (const match of text.matchAll(/(?:^|[,{&\s])\s*["']?([\w-]*(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|credential|signature|x-amz-signature|key|sig)[\w-]*)["']?\s*(?::|=)\s*["']?([^"'&,}\s]+)/gi)) {
      add(match[2]!)
    }
  }
  const capture = (request: HttpClientRequest.HttpClientRequest) => {
    for (const [name, value] of Object.entries(request.headers)) {
      if (!sensitive.test(name) && name !== "cookie") continue
      add(value)
      const bearer = /^Bearer\s+(.+)$/i.exec(value)?.[1]
      if (bearer !== undefined) add(bearer)
    }
    const url = HttpClientRequest.toUrl(request)
    if (url._tag === "Some")
      url.value.searchParams.forEach((value, key) => {
        if (sensitive.test(key) || queryKey.test(key)) add(value)
      })
    captureBody(request.body)
  }
  const text = (value: string) => {
    let result = value.replace(jsonField, `$1"${redacted}"`).replace(queryField, `$1${redacted}`)
    for (const secret of secrets) result = result.split(secret).join(redacted)
    return result
  }
  const providerMessage = (body: string | undefined) => {
    if (body === undefined) return undefined
    try {
      const decoded = JSON.parse(text(body))
      if (typeof decoded !== "object" || decoded === null) return undefined
      const value = decoded as { readonly message?: unknown; readonly error?: unknown }
      if (typeof value.error === "string") return value.error
      if (typeof value.error === "object" && value.error !== null && "message" in value.error) {
        const message = (value.error as { readonly message?: unknown }).message
        if (typeof message === "string") return message
      }
      return typeof value.message === "string" ? value.message : undefined
    } catch {
      return undefined
    }
  }
  const details = (reason: Error.AIErrorReason) => ({
    message: providerMessage(reason.body) ?? text(reason.message),
    body: reason.body === undefined ? undefined : text(reason.body).slice(0, 16_384),
    http: reason.http === undefined ? undefined : new Error.HttpContext({
      url: text(reason.http.url),
      status: reason.http.status,
      headers: Object.fromEntries(Object.entries(Headers.redact(Headers.fromInput(reason.http.headers), [
        sensitive, "cookie", "set-cookie",
      ])).map(([name, value]) => [name, text(String(value))])),
    }),
    // Native transport causes can retain the complete credential-bearing request.
    cause: undefined,
  })
  const reason = Error.AIErrorReason.match({
    Authentication: (value) => new Error.AuthenticationError({ ...value, ...details(value) }),
    ContentPolicy: (value) => new Error.ContentPolicyError({ ...value, ...details(value) }),
    InvalidProviderOutput: (value) => new Error.InvalidProviderOutputError({ ...value, ...details(value) }),
    InvalidRequest: (value) => new Error.InvalidRequestError({ ...value, ...details(value) }),
    NoRoute: (value) => new Error.NoRouteError({ ...value, ...details(value) }),
    ProviderInternal: (value) => new Error.ProviderInternalError({ ...value, ...details(value) }),
    QuotaExceeded: (value) => new Error.QuotaExceededError({ ...value, ...details(value) }),
    RateLimit: (value) => new Error.RateLimitError({ ...value, ...details(value) }),
    Transport: (value) => new Error.TransportError({ ...value, ...details(value), url: value.url === undefined ? undefined : text(value.url) }),
    UnknownProvider: (value) => new Error.UnknownProviderError({ ...value, ...details(value) }),
    UnsupportedOperation: (value) => new Error.UnsupportedOperationError({ ...value, ...details(value) }),
  })
  return {
    capture,
    text,
    truncated: (error: Error.AIError) => error.reason.body !== undefined && text(error.reason.body).length > 16_384,
    error: (error: Error.AIError) => new Error.AIError({ reason: reason(error.reason) }),
  }
}
