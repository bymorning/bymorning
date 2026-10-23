import { Tool } from "@bymorning/plugin"

export const requestTimeoutMs = 15_000
export const maxJSONBytes = 64 * 1024

export function toolError(message: string): Tool.Error {
  return new Tool.Error({ message })
}

/** Reject URLs outside the product's Google API origin before any credential leaves the host. */
export function assertAPIOrigin(url: URL, expectedOrigin: string, failure: string): void {
  if (url.protocol !== "https:" || url.origin !== expectedOrigin) throw toolError(failure)
}

/**
 * Validate one user-supplied path segment before it is encoded into a Google API URL.
 * The allowlist keeps crafted input on the expected origin even before encoding.
 */
export function pathSegment(value: string, pattern: RegExp, maxLength: number, failure: string): string {
  if (value.length === 0 || value.length > maxLength || !pattern.test(value)) throw toolError(failure)
  return encodeURIComponent(value)
}

/** Clamp an optional numeric Tool input into an inclusive range with a fallback default. */
export function clampInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}

export interface JSONRequest {
  readonly access?: string
  readonly method?: "GET" | "POST"
  readonly body?: URLSearchParams
  readonly accept?: string
  readonly timeoutMs?: number
  readonly maxBytes?: number
  /** Sanitized label used for every failure from this request. Never includes secrets or bodies. */
  readonly failure: string
}

/** GET or form-POST JSON from Google with timeout, redirect refusal, and a bounded body. */
export async function requestJSON(url: URL, request: JSONRequest): Promise<unknown> {
  const response = await send(url, request)
  if (!response.ok) {
    await discard(response.body)
    throw toolError(`${request.failure} (${response.status})`)
  }
  try {
    return JSON.parse(await readBounded(response, request.maxBytes ?? maxJSONBytes))
  } catch (error) {
    if (error instanceof Tool.Error) throw error
    throw toolError(`${request.failure} (invalid response)`)
  }
}

/** GET text (Drive export) with the same transport policy as JSON requests. */
export async function requestText(url: URL, request: JSONRequest): Promise<string> {
  const response = await send(url, request)
  if (!response.ok) {
    await discard(response.body)
    throw toolError(`${request.failure} (${response.status})`)
  }
  return readBounded(response, request.maxBytes ?? maxJSONBytes)
}

async function send(url: URL, request: JSONRequest): Promise<Response> {
  try {
    return await fetch(url, {
      method: request.method ?? "GET",
      headers: {
        Accept: request.accept ?? "application/json",
        ...(request.access === undefined ? {} : { Authorization: `Bearer ${request.access}` }),
        ...(request.body === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: request.body ?? undefined,
      redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs ?? requestTimeoutMs),
    })
  } catch {
    throw toolError(request.failure)
  }
}

export async function readBounded(response: Response, maximumBytes: number): Promise<string> {
  const length = response.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await discard(response.body)
    throw toolError("Response is too large")
  }
  if (response.body === null) throw new Error("Response has no body")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximumBytes) {
        await reader.cancel()
        throw toolError("Response is too large")
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(concat(chunks, size))
}

export async function discard(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel()
  } catch {
    // The response is already being converted to a sanitized Tool.Error.
  }
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
