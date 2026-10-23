import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Tool } from "../src/tool.js"
import { blockedAddress, makeNodeLookup, resolvePublic, type Address } from "../src/plugin/internal/tool/web-fetch-egress.js"

const public4 = "93.184.216.34"
const public6 = "2606:4700:4700::1111"

describe("WebFetch egress admission", () => {
  it("[SEC-SSRF-04] classifies every non-public IPv4 range", () => {
    const blockedV4 = [
      // loopback and "this host"
      "127.0.0.1",
      "127.63.0.9",
      "0.0.0.0",
      "0.1.2.3",
      // RFC 1918
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.1",
      // link-local, including cloud and ECS task metadata
      "169.254.169.254",
      "169.254.170.2",
      "169.254.1.1",
      // CGNAT
      "100.64.0.0",
      "100.127.255.255",
      // protocol assignments, benchmarking, documentation
      "192.0.0.1",
      "198.18.0.1",
      "198.19.255.255",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      // multicast and reserved
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ]
    for (const address of blockedV4) {
      expect(blockedAddress(address), address).toBe(true)
    }
    for (const address of [public4, "1.1.1.1", "8.8.8.8", "172.32.0.1", "100.63.255.255", "11.0.0.1", "192.169.0.1"]) {
      expect(blockedAddress(address), address).toBe(false)
    }
  })

  it("[SEC-SSRF-05] classifies IPv6 loopback, ULA, link-local, mapped, and unspecified forms", () => {
    const blockedV6 = [
      "::1",
      "[::1]",
      "::",
      "fd00::1",
      "fdbf:1234::abcd",
      "fc00::1", // ULA is fc00::/7; fd00::/8 is the commonly assigned half
      "fe80::1",
      "febf::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe",
      "::ffff:100.64.0.1",
      "[::ffff:7f00:1]",
    ]
    for (const address of blockedV6) {
      expect(blockedAddress(address), address).toBe(true)
    }
    expect(blockedAddress(public6)).toBe(false)
    expect(blockedAddress("::ffff:5db8:d822")).toBe(false) // mapped public 93.184.216.34
  })

  it.effect("[SEC-SSRF-06] resolves only when every answer is public", () =>
    Effect.gen(function* () {
      const lookup =
        (answers: ReadonlyArray<string>) =>
        (_hostname: string): Effect.Effect<ReadonlyArray<Address>, Tool.Error> =>
          Effect.succeed(answers.map((address) => ({ address, family: 4 as const })))

      expect(yield* resolvePublic("docs.example", lookup([public4]))).toEqual([public4])
      expect(yield* resolvePublic("dual.example", lookup([public4, public6]))).toEqual([public4, public6])

      const mixed = yield* resolvePublic("mixed.example", lookup([public4, "10.1.2.3"])).pipe(Effect.flip)
      expect((mixed as Tool.Error).message).toContain("non-public")

      const empty = yield* resolvePublic("empty.example", lookup([])).pipe(Effect.flip)
      expect((empty as Tool.Error).message).toContain("Unable to resolve")

      const failing = yield* resolvePublic("dead.example", () =>
        new Tool.Error({ message: "Unable to resolve fetch destination: dead.example" }),
      ).pipe(Effect.flip)
      expect((failing as Tool.Error).message).toContain("Unable to resolve")

      // Literals never reach DNS.
      expect(yield* resolvePublic(public4, () => Effect.die(new Error("DNS must not run")))).toEqual([public4])
      const literal = yield* resolvePublic("127.0.0.1", () => Effect.die(new Error("DNS must not run"))).pipe(
        Effect.flip,
      )
      expect((literal as Tool.Error).message).toContain("non-public")
      const mapped = yield* resolvePublic("[::ffff:127.0.0.1]").pipe(Effect.flip)
      expect((mapped as Tool.Error).message).toContain("non-public")
    }),
  )

  it("[SEC-SSRF-07] pins agent connections to screened answers through the lookup hook", () =>
    Effect.gen(function* () {
      const lookup = (hostname: string): Effect.Effect<ReadonlyArray<Address>, Tool.Error> =>
        Effect.succeed(
          hostname === "blocked.example"
            ? [{ address: "192.168.1.1", family: 4 }]
            : [
                { address: public4, family: 4 },
                { address: public6, family: 6 },
              ],
        )
      const nodeLookup = makeNodeLookup(lookup)

      const all = yield* Effect.callback<readonly Address[], Error>((resume) => {
        nodeLookup("docs.example", { all: true }, (error, addresses) =>
          error ? resume(Effect.fail(error)) : resume(Effect.succeed(addresses as readonly Address[])),
        )
      })
      expect(all).toEqual([
        { address: public4, family: 4 },
        { address: public6, family: 6 },
      ])

      const single = yield* Effect.callback<{ readonly address: string; readonly family: number }, Error>((resume) => {
        nodeLookup("docs.example", {}, (error, address, family) =>
          error
            ? resume(Effect.fail(error))
            : resume(Effect.succeed({ address: address as string, family: family ?? 0 })),
        )
      })
      expect(single).toEqual({ address: public4, family: 4 })

      // Bracketed IPv6 literals are unwrapped and screened without DNS.
      const literal = yield* Effect.callback<{ readonly address: string; readonly family: number }, Error>((resume) => {
        nodeLookup("[2606:4700:4700::1111]", {}, (error, address, family) =>
          error
            ? resume(Effect.fail(error))
            : resume(Effect.succeed({ address: address as string, family: family ?? 0 })),
        )
      })
      expect(literal).toEqual({ address: public6, family: 6 })

      const refused = yield* Effect.callback<Error, never>((resume) => {
        nodeLookup("blocked.example", {}, (error) => resume(Effect.succeed(error ?? new Error("expected an error"))))
      })
      expect(refused.message).toContain("non-public")
    }),
  )
})
