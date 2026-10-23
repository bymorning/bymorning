import { Effect, Option } from "effect"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

/**
 * In-process admission throttle for the unauthenticated authentication and
 * OAuth endpoints. One deployment runs a single task, so per-process state is
 * the whole story: a token bucket per client IP and route class. Client IP
 * comes from the connection peer; X-Forwarded-For is honored only when the
 * peer is a configured trusted proxy.
 */

const parseIPv4 = (value: string): bigint | undefined => {
  const parts = value.split(".")
  if (parts.length !== 4) return undefined
  let out = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    out = (out << 8n) | BigInt(octet)
  }
  return out
}

const parseIPv6 = (value: string): bigint | undefined => {
  let input = value.toLowerCase()
  const zone = input.indexOf("%")
  if (zone !== -1) input = input.slice(0, zone)
  if (input.includes(".")) {
    const at = input.lastIndexOf(":")
    if (at === -1) return undefined
    const tail = parseIPv4(input.slice(at + 1))
    if (tail === undefined) return undefined
    input = `${input.slice(0, at)}:${(tail >> 16n).toString(16)}:${(tail & 0xffffn).toString(16)}`
  }
  const halves = input.split("::")
  if (halves.length > 2) return undefined
  const left = halves[0] === undefined || halves[0] === "" ? [] : halves[0].split(":")
  const right = halves.length === 2 ? (halves[1] === undefined || halves[1] === "" ? [] : halves[1]!.split(":")) : []
  if (halves.length === 1 && left.length !== 8) return undefined
  const fill = 8 - left.length - right.length
  if (halves.length === 2 && fill < 1) return undefined
  const full = [...left, ...Array<string>(fill).fill("0"), ...right]
  if (full.length !== 8) return undefined
  let out = 0n
  for (const group of full) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined
    out = (out << 16n) | BigInt(parseInt(group, 16))
  }
  return out
}

/** Parse an exact IP literal (v4 or v6). IPv4-mapped IPv6 peers are canonicalized to IPv4. */
export const parseIP = (value: string): { readonly bits: bigint; readonly width: 32 | 128 } | undefined => {
  const trimmed = value.trim()
  const bracketed = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed
  const v4 = parseIPv4(bracketed)
  if (v4 !== undefined) return { bits: v4, width: 32 }
  const v6 = parseIPv6(bracketed)
  if (v6 === undefined) return undefined
  // A dual-stack listener reports IPv4 peers in mapped form; match trust against the real IPv4 value.
  if (v6 >> 32n === 0xffffn) return { bits: v6 & 0xffff_ffffn, width: 32 }
  return { bits: v6, width: 128 }
}

/** One trusted proxy hop: an exact address or CIDR range. */
export interface TrustedProxy {
  readonly bits: bigint
  readonly width: 32 | 128
  readonly prefix: number
}

/** Parse a trusted proxy entry: an IP literal or CIDR such as `10.0.0.0/8`. */
export const parseTrustedProxy = (value: string): TrustedProxy | undefined => {
  const slash = value.indexOf("/")
  const ip = parseIP(slash === -1 ? value : value.slice(0, slash))
  if (ip === undefined) return undefined
  if (slash === -1) return { bits: ip.bits, width: ip.width, prefix: ip.width }
  const prefix = Number(value.slice(slash + 1))
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > ip.width) return undefined
  return { bits: ip.bits, width: ip.width, prefix }
}

const matches = (ip: { readonly bits: bigint; readonly width: 32 | 128 }, proxy: TrustedProxy) =>
  ip.width === proxy.width && (proxy.prefix === 0 || ip.bits >> BigInt(ip.width - proxy.prefix) === proxy.bits >> BigInt(proxy.width - proxy.prefix))

/**
 * Resolve the client key for throttling. Without a trusted peer the connection
 * peer is used and any forwarded chain is ignored; with a trusted peer the
 * rightmost untrusted forwarded entry wins so a client cannot pick its own key
 * by smuggling extra entries (they would be its own untrusted hop at worst).
 */
export const clientIP = (input: {
  readonly peer?: string | undefined
  readonly forwardedFor?: string | undefined
  readonly trusted: ReadonlyArray<TrustedProxy>
}): string => {
  const peer = input.peer?.trim()
  const parsedPeer = peer === undefined || peer === "" ? undefined : parseIP(peer)
  if (peer === undefined || peer === "" || parsedPeer === undefined || !input.trusted.some((proxy) => matches(parsedPeer, proxy))) {
    return peer === undefined || peer === "" ? "unknown" : peer
  }
  const chain = (input.forwardedFor ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "")
  for (let index = chain.length - 1; index >= 0; index--) {
    const candidate = chain[index]!
    const parsed = parseIP(candidate)
    if (parsed !== undefined && input.trusted.some((proxy) => matches(parsed, proxy))) continue
    return candidate
  }
  return chain[0] ?? peer
}

export interface Decision {
  readonly allowed: boolean
  /** Seconds until one token is available again; zero when allowed. */
  readonly retryAfter: number
}

export interface LimiterOptions {
  readonly capacity?: number
  readonly refillPerMinute?: number
  readonly now?: () => number
}

/** Token bucket keyed by an opaque string; bounded by sweeping idle keys. */
export const makeLimiter = (options: LimiterOptions = {}) => {
  const capacity = options.capacity ?? 10
  const refillMs = 60_000 / (options.refillPerMinute ?? 10)
  const now = options.now ?? (() => Date.now())
  const idleMs = Math.max(600_000, capacity * refillMs)
  const buckets = new Map<string, { tokens: number; updated: number }>()
  let swept = 0
  return (key: string): Decision => {
    const at = now()
    if (buckets.size > 4096 && at - swept > 60_000) {
      swept = at
      for (const [held, bucket] of buckets) {
        if (at - bucket.updated > idleMs) buckets.delete(held)
      }
    }
    const current = buckets.get(key)
    const tokens = current === undefined ? capacity : Math.min(capacity, current.tokens + (at - current.updated) / refillMs)
    if (tokens < 1) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(((1 - tokens) * refillMs) / 1000)) }
    }
    buckets.set(key, { tokens: tokens - 1, updated: at })
    return { allowed: true, retryAfter: 0 }
  }
}

/**
 * Route classes throttled per client: the credential- and grant-bearing public
 * authentication surface. The read-only `/auth/method` inventory is exempt —
 * the sign-in page reads it on every visit, so a shared egress address (an
 * office NAT, or the load balancer peer when no proxies are trusted) must never
 * take the sign-in page down with an exhausted bucket.
 */
const limitedRoutes = [
  "/auth/login",
  "/auth/callback",
  "/auth/inspect",
  "/auth/setup",
  "/auth/logout",
  "/auth/integration/callback",
  "/oauth/token",
  "/oauth/register",
] as const

export const limitedRoute = (pathname: string) =>
  limitedRoutes.find((route) => pathname === route || pathname.startsWith(`${route}/`))

export interface Options extends LimiterOptions {
  readonly trustedProxies?: ReadonlyArray<string>
}

/** Throttle the public authentication and OAuth grant endpoints; answered 429 with Retry-After. */
export const rateLimit = (options: Options = {}) => {
  const trusted = (options.trustedProxies ?? [])
    .map((value) => parseTrustedProxy(value))
    .filter((value): value is TrustedProxy => value !== undefined)
  const limiter = makeLimiter(options)
  return HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.method === "OPTIONS") return yield* httpEffect
      const route = limitedRoute(new URL(request.url, "http://localhost").pathname)
      if (route === undefined) return yield* httpEffect
      const decision = limiter(
        `${clientIP({
          peer: Option.getOrUndefined(request.remoteAddress),
          forwardedFor: Option.getOrUndefined(Headers.get(request.headers, "x-forwarded-for")),
          trusted,
        })}|${route}`,
      )
      if (!decision.allowed) {
        return HttpServerResponse.jsonUnsafe(
          { error: "rate_limited" },
          {
            status: 429,
            headers: {
              "retry-after": String(decision.retryAfter),
              "cache-control": "no-store",
              "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
              "x-content-type-options": "nosniff",
            },
          },
        )
      }
      return yield* httpEffect
    }),
  ).layer
}
