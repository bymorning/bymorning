import { describe, expect, test } from "vitest"
import { redirectOrigins } from "./oauth-consent.js"

describe("redirectOrigins", () => {
  test("keeps scheme, host, and a non-default port of a web redirect, and nothing else", () => {
    expect(redirectOrigins(["http://127.0.0.1:33418/callback"])).toEqual(["http://127.0.0.1:33418"])
    expect(redirectOrigins(["https://app.example:443/cb?code=1"])).toEqual(["https://app.example"])
    expect(redirectOrigins(["http://[::1]:3000/cb"])).toEqual(["http://[::1]:3000"])
  })

  test("drops embedded credentials, paths, and queries, and normalizes case", () => {
    expect(redirectOrigins(["https://user:password@Evil.EXAMPLE/steal?token=secret"])).toEqual(["https://evil.example"])
  })

  test("keeps scheme and host of a custom scheme, and the scheme of a hostless one", () => {
    expect(redirectOrigins(["cursor://anysphere.cursor-retrieve-mcp/oauth/callback"])).toEqual([
      "cursor://anysphere.cursor-retrieve-mcp",
    ])
    expect(redirectOrigins(["com.example.app:/oauth2redirect"])).toEqual(["com.example.app:"])
  })

  test("is distinct, sorted, and ignores what is not a URL", () => {
    expect(
      redirectOrigins(["https://b.example/x", "not a url", "https://a.example/y", "https://b.example/z", ""]),
    ).toEqual(["https://a.example", "https://b.example"])
    expect(redirectOrigins([])).toEqual([])
  })
})
