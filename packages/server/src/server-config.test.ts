import { ConfigProvider, Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"
import { serverConfig } from "./server-config.js"

const read = (input: Record<string, string | undefined>) =>
  Effect.runPromiseExit(serverConfig.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input)))))

describe("Server configuration", () => {
  it("parses the trusted application origin", async () => {
    const exit = await read({ APP_ORIGIN: "http://localhost:3000" })

    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.appOrigin.origin).toBe("http://localhost:3000")
      expect(Object.keys(exit.value)).toEqual(["appOrigin"])
    }
  })

  it("ignores leftover AUTH_* variables when all five are valid", async () => {
    const exit = await read({
      APP_ORIGIN: "https://app.example",
      AUTH_ISSUER: "https://auth.example",
      AUTH_CLIENT_ID: "client",
      AUTH_CLIENT_SECRET: "secret",
      AUTH_PROVIDER: "okta",
      AUTH_EMAIL_DOMAINS: "example.com",
      AUTH_REDIRECT_URI: "https://stale.example/callback",
    })

    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.appOrigin.origin).toBe("https://app.example")
      expect(exit.value.auth).toMatchObject({
        kind: "okta",
        displayName: "Okta",
        issuer: "https://auth.example",
        clientID: "client",
        domains: ["example.com"],
      })
    }
  })

  it("rejects a partial AUTH_* set", async () => {
    const exit = await read({
      APP_ORIGIN: "https://app.example",
      AUTH_ISSUER: "https://auth.example",
    })

    expect(exit._tag).toBe("Failure")
  })

  it("decodes a microsoft seed with domains", async () => {
    const exit = await read({
      APP_ORIGIN: "https://app.example",
      AUTH_ISSUER: "https://login.microsoftonline.com/tenant/v2.0",
      AUTH_CLIENT_ID: "client",
      AUTH_CLIENT_SECRET: "secret",
      AUTH_PROVIDER: "microsoft",
      AUTH_EMAIL_DOMAINS: " Contoso.COM , Fabrikam.com ",
    })

    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value.auth).toMatchObject({
        kind: "microsoft",
        displayName: "Microsoft Entra",
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        clientID: "client",
        domains: ["contoso.com", "fabrikam.com"],
      })
      expect(Redacted.value(exit.value.auth!.clientSecret)).toBe("secret")
    }
  })

  it.each<[string, Record<string, string | undefined>]>([
    ["an application URL with a path", { APP_ORIGIN: "https://app.example/private" }],
    ["an application URL with a query", { APP_ORIGIN: "https://app.example?x=1" }],
    ["a missing application origin", { APP_ORIGIN: undefined }],
    ["an empty application origin", { APP_ORIGIN: "" }],
    ["a non-URL application origin", { APP_ORIGIN: "not-a-url" }],
  ])("rejects %s", async (_name, invalid) => {
    const exit = await read({ APP_ORIGIN: "https://app.example", ...invalid })

    expect(exit._tag).toBe("Failure")
  })
})
