import { describe, expect, it } from "vitest"
import { clientIP, limitedRoute, makeLimiter, parseIP, parseTrustedProxy } from "./rate-limit.js"

describe("rate-limit client identity", () => {
  it("[SEC-RATE-03] parses IPv4 and IPv6 literals for trust decisions", () => {
    expect(parseIP("127.0.0.1")).toBeDefined()
    expect(parseIP("255.255.255.255")).toBeDefined()
    expect(parseIP("256.0.0.1")).toBeUndefined()
    expect(parseIP("::1")).toBeDefined()
    expect(parseIP("[::1]")).toBeDefined()
    expect(parseIP("2001:db8::1")).toBeDefined()
    expect(parseIP("fe80::1%eth0")).toBeDefined()
    expect(parseIP("not-an-ip")).toBeUndefined()
    expect(parseIP("")).toBeUndefined()
  })

  it("[SEC-RATE-08] canonicalizes IPv4-mapped IPv6 peers so trust lists stay in IPv4", () => {
    const mapped = parseIP("::ffff:127.0.0.1")
    expect(mapped).toEqual(parseIP("127.0.0.1"))
    const trusted = [parseTrustedProxy("127.0.0.1")!]
    expect(clientIP({ peer: "::ffff:127.0.0.1", forwardedFor: "203.0.113.1", trusted })).toBe("203.0.113.1")
  })

  it("[SEC-RATE-04] parses exact and CIDR trusted proxies", () => {
    expect(parseTrustedProxy("10.0.0.8")).toMatchObject({ width: 32, prefix: 32 })
    expect(parseTrustedProxy("10.0.0.0/8")).toMatchObject({ width: 32, prefix: 8 })
    expect(parseTrustedProxy("2606:4700::/32")).toMatchObject({ width: 128, prefix: 32 })
    expect(parseTrustedProxy("10.0.0.0/33")).toBeUndefined()
    expect(parseTrustedProxy("10.0.0.0/-1")).toBeUndefined()
    expect(parseTrustedProxy("example.com")).toBeUndefined()
  })

  it("[SEC-RATE-05] uses the peer unless it is trusted, then walks the forwarded chain right-to-left", () => {
    const trusted = [parseTrustedProxy("127.0.0.1")!, parseTrustedProxy("10.0.0.0/8")!]
    // Untrusted peer: forwarded entries are ignored entirely.
    expect(clientIP({ peer: "198.51.100.9", forwardedFor: "203.0.113.1", trusted })).toBe("198.51.100.9")
    // Trusted peer with no chain: the peer is the key.
    expect(clientIP({ peer: "127.0.0.1", trusted })).toBe("127.0.0.1")
    // Trusted peer: the rightmost untrusted entry is the client.
    expect(clientIP({ peer: "127.0.0.1", forwardedFor: "203.0.113.1", trusted })).toBe("203.0.113.1")
    expect(clientIP({ peer: "127.0.0.1", forwardedFor: "198.51.100.2, 203.0.113.1", trusted })).toBe("203.0.113.1")
    // Trusted hops inside the chain are skipped.
    expect(clientIP({ peer: "127.0.0.1", forwardedFor: "203.0.113.1, 10.0.0.8", trusted })).toBe("203.0.113.1")
    // A chain of only trusted hops falls back to its leftmost entry.
    expect(clientIP({ peer: "127.0.0.1", forwardedFor: "10.0.0.8", trusted })).toBe("10.0.0.8")
    // An unparseable peer or entry is never trusted, and never crashes the decision.
    expect(clientIP({ peer: "unknown", forwardedFor: "203.0.113.1", trusted })).toBe("unknown")
    expect(clientIP({ peer: "127.0.0.1", forwardedFor: "garbage", trusted })).toBe("garbage")
    expect(clientIP({ trusted })).toBe("unknown")
  })

  it("[SEC-RATE-06] refills token buckets over time and refuses exhausted keys", () => {
    let now = 1_000_000
    const limiter = makeLimiter({ capacity: 2, refillPerMinute: 60, now: () => now })
    expect(limiter("a").allowed).toBe(true)
    expect(limiter("a").allowed).toBe(true)
    const exhausted = limiter("a")
    expect(exhausted.allowed).toBe(false)
    expect(exhausted.retryAfter).toBe(1)
    // Independent keys keep independent buckets.
    expect(limiter("b").allowed).toBe(true)
    // Half a refill interval is not enough for a full token; one interval is.
    now += 500
    expect(limiter("a").allowed).toBe(false)
    now += 1_000
    expect(limiter("a").allowed).toBe(true)
  })

  it("[SEC-RATE-07] classifies the throttled public authentication and OAuth routes", () => {
    expect(limitedRoute("/auth/login")).toBe("/auth/login")
    expect(limitedRoute("/auth/callback")).toBe("/auth/callback")
    expect(limitedRoute("/auth/callback/apv_00000000000000000000000001")).toBe("/auth/callback")
    expect(limitedRoute("/auth/inspect")).toBe("/auth/inspect")
    expect(limitedRoute("/auth/setup")).toBe("/auth/setup")
    expect(limitedRoute("/oauth/token")).toBe("/oauth/token")
    expect(limitedRoute("/oauth/register")).toBe("/oauth/register")
    // The read-only sign-in inventory is exempt: the sign-in page reads it on every visit.
    expect(limitedRoute("/auth/method")).toBeUndefined()
    expect(limitedRoute("/api/providers")).toBeUndefined()
    expect(limitedRoute("/oauth/authorize")).toBeUndefined()
    expect(limitedRoute("/inference/openai/v1/models")).toBeUndefined()
    expect(limitedRoute("/")).toBeUndefined()
  })
})
