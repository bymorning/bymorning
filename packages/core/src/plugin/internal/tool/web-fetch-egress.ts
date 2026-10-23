import { Effect } from "effect"
import { lookup } from "node:dns"
import { isIP, type LookupFunction } from "node:net"
import { Tool } from "../../../tool.js"

/**
 * Egress admission for the webfetch Tool.
 *
 * Every fetched host is resolved and every resolved address is screened against
 * the non-public ranges below before a connection opens, and again inside the
 * HTTP agent's lookup hook so the socket is pinned to the screened answers and
 * a DNS re-resolution cannot swap in a private address (rebinding). Redirects
 * repeat the check per hop because the Tool follows them itself.
 */

const parseIPv4 = (value: string): [number, number, number, number] | undefined => {
  const parts = value.split(".")
  if (parts.length !== 4) return undefined
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1))
  if (octets.some((octet) => octet < 0 || octet > 255)) return undefined
  return octets as [number, number, number, number]
}

/** Parse an IPv6 literal to its 128-bit value; handles `::` compression and an embedded IPv4 tail. */
const parseIPv6 = (value: string): bigint | undefined => {
  let input = value.toLowerCase()
  const zone = input.indexOf("%")
  if (zone !== -1) input = input.slice(0, zone)
  if (input.includes(".")) {
    const at = input.lastIndexOf(":")
    if (at === -1) return undefined
    const tail = parseIPv4(input.slice(at + 1))
    if (tail === undefined) return undefined
    const packed = (BigInt(tail[0]) << 24n) | (BigInt(tail[1]) << 16n) | (BigInt(tail[2]) << 8n) | BigInt(tail[3])
    input = `${input.slice(0, at)}:${(packed >> 16n).toString(16)}:${(packed & 0xffffn).toString(16)}`
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

/** The IPv4 ranges a fetched document may never come from. */
const blockedIPv4 = (octets: readonly [number, number, number, number]): boolean => {
  const [a, b] = octets
  return (
    a === 0 || // 0.0.0.0/8 "this host" network, including 0.0.0.0
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) || // link-local; covers 169.254.169.254 and 169.254.170.2 metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 192 && b === 0 && octets[2] === 0) || // 192.0.0.0/24 protocol assignments
    (a === 192 && b === 0 && octets[2] === 2) || // documentation 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18.0.0/15
    (a === 198 && b === 51 && octets[2] === 100) || // documentation 198.51.100.0/24
    (a === 203 && b === 0 && octets[2] === 113) || // documentation 203.0.113.0/24
    a >= 224 // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (incl. 255.255.255.255)
  )
}

/** The IPv6 ranges a fetched document may never come from. */
const blockedIPv6 = (bits: bigint): boolean => {
  if (bits === 0n || bits === 1n) return true // :: unspecified and ::1 loopback
  const head = bits >> 120n
  if ((bits >> 32n) === 0xffffn) {
    const mapped = Number(bits & 0xffff_ffffn)
    return blockedIPv4([mapped >>> 24, (mapped >>> 16) & 255, (mapped >>> 8) & 255, mapped & 255])
  }
  if (head === 0xffn) return true // ff00::/8 multicast
  if ((bits >> 121n) === 0x7en) return true // fc00::/7 unique local (includes fd00::/8)
  if ((bits >> 118n) === 0x3fan) return true // fe80::/10 link-local
  if ((bits >> 96n) === 0x20010db8n) return true // 2001:db8::/32 documentation
  return false
}

/** True when the address literal is loopback, private, link-local, metadata, multicast, or otherwise non-public. */
export const blockedAddress = (value: string): boolean => {
  const trimmed = value.trim()
  const unbracketed = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed
  const v4 = parseIPv4(unbracketed)
  if (v4 !== undefined) return blockedIPv4(v4)
  if (!isIP(unbracketed)) return true // not an address literal at all: never connect
  const v6 = parseIPv6(unbracketed)
  return v6 === undefined ? true : blockedIPv6(v6)
}

const blocked = (hostname: string) =>
  new Tool.Error({ message: `Blocked fetch destination: ${hostname} resolves to a non-public address` })

export interface Address {
  readonly address: string
  readonly family: 4 | 6
}

/** DNS lookup shape used by the Tool; injected in tests, `node:dns` in production. */
export type Lookup = (
  hostname: string,
) => Effect.Effect<ReadonlyArray<Address>, Tool.Error>

const dnsLookupAll = ((hostname: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise<Array<Address>>((resolvePromise, reject) => {
        lookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
          error === null ? resolvePromise(addresses as Array<Address>) : reject(error),
        )
      }),
    catch: () => new Tool.Error({ message: `Unable to resolve fetch destination: ${hostname}` }),
  })) satisfies Lookup

/**
 * Resolve and screen a fetch destination host. Address literals skip DNS and
 * are screened directly. A hostname is refused when resolution fails, answers
 * are empty, or ANY answer is non-public (fail closed against mixed answers).
 */
export const resolvePublic = Effect.fn("WebFetch.resolvePublic")(function* (
  hostname: string,
  lookup: Lookup = dnsLookupAll,
) {
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
  if (isIP(host)) {
    if (blockedAddress(host)) return yield* blocked(host)
    return [host]
  }
  const addresses = yield* lookup(host)
  if (addresses.length === 0) return yield* new Tool.Error({ message: `Unable to resolve fetch destination: ${host}` })
  if (addresses.some((entry) => blockedAddress(entry.address))) return yield* blocked(host)
  return addresses.map((entry) => entry.address)
})

/**
 * Node `lookup` hook that pins agent connections to screened answers: the
 * lookup runs at connection time, so every redirect hop and retry re-screens
 * and a rebound answer is refused instead of connected to.
 */
export const makeNodeLookup =
  (lookup: Lookup = dnsLookupAll): LookupFunction =>
  (hostname, options, callback) => {
    const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
    void Effect.runPromise(
      Effect.match(resolvePublic(host, lookup), {
        onFailure: (error: Tool.Error) => ({ error }),
        onSuccess: (addresses) => ({ addresses }),
      }),
    ).then((result) => {
      if ("error" in result) {
        callback(new Error(result.error.message), "", 0)
        return
      }
      const addresses = result.addresses
      if (options.all === true) {
        callback(
          null,
          addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 })),
        )
        return
      }
      const first = addresses[0]
      if (first === undefined) {
        callback(new Error(`Unable to resolve fetch destination: ${host}`), "", 0)
        return
      }
      callback(null, first, isIP(first) === 6 ? 6 : 4)
    }, () => callback(new Error("Blocked fetch destination"), "", 0))
  }
