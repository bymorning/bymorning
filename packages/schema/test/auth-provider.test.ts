import { AuthProvider } from "@bymorning/schema/auth-provider"
import { Schema, Redacted } from "effect"
import { expect, test } from "vitest"

test("creates and validates Auth Provider identifiers", () => {
  const id = AuthProvider.ID.create()
  expect(id).toMatch(/^apv_/)
  expect(Schema.decodeUnknownSync(AuthProvider.ID)(id)).toBe(id)
  expect(() => Schema.decodeUnknownSync(AuthProvider.ID)("lgm_not-auth-provider")).toThrow()
})

test("normalizes domains and admits HTTPS issuers", () => {
  expect(Schema.decodeUnknownSync(AuthProvider.Domain)(" Example.COM ")).toBe("example.com")
  expect(Schema.decodeUnknownSync(AuthProvider.Issuer)("https://accounts.google.com")).toBe("https://accounts.google.com")
  expect(Schema.decodeUnknownSync(AuthProvider.Issuer)("http://127.0.0.1:8080/tenant")).toBe("http://127.0.0.1:8080/tenant")
  expect(() => Schema.decodeUnknownSync(AuthProvider.Issuer)("http://idp.example.test")).toThrow()
  expect(() => Schema.decodeUnknownSync(AuthProvider.Issuer)("https://user:pass@idp.example.test")).toThrow()
})

test("decodes create input with a redacted secret", () => {
  const created = Schema.decodeUnknownSync(AuthProvider.Create)({
    id: AuthProvider.ID.create(),
    displayName: "Google Workspace",
    kind: "google",
    domains: ["Example.COM", "example.com"],
    issuer: "https://accounts.google.com",
    clientID: "client",
    clientSecret: "secret",
  })
  expect(created.domains).toEqual(["example.com", "example.com"])
  expect(Redacted.value(created.clientSecret)).toBe("secret")
})

test("decodes seed input with a redacted secret and normalized domains", () => {
  const seeded = Schema.decodeUnknownSync(AuthProvider.Seed)({
    displayName: "Google Workspace",
    kind: "google",
    domains: ["Example.COM", "example.com"],
    issuer: "https://accounts.google.com",
    clientID: "client",
    clientSecret: "secret",
  })
  expect(seeded.domains).toEqual(["example.com", "example.com"])
  expect(Redacted.value(seeded.clientSecret)).toBe("secret")
})
