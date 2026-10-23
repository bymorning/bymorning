import { expect, test } from "vitest"
import { Oidc } from "../src/auth/oidc.js"

// Entra v2.0 ID tokens carry no `email_verified`; the optional `xms_edov` claim
// (email domain owner verified) is the documented equivalent for its `email` claim.
test("email_verified true verifies the email", () => {
  expect(Oidc.emailVerified({ email_verified: true }, true)).toBe(true)
  expect(Oidc.emailVerified({ email_verified: true }, false)).toBe(true)
})

test("xms_edov true verifies an email taken from the ID token", () => {
  expect(Oidc.emailVerified({ xms_edov: true }, true)).toBe(true)
})

test("xms_edov does not vouch for an email fetched from userinfo", () => {
  expect(Oidc.emailVerified({ xms_edov: true }, false)).toBe(false)
})

test("missing or non-true claims leave the email unverified", () => {
  expect(Oidc.emailVerified({}, true)).toBe(false)
  expect(Oidc.emailVerified({ xms_edov: false }, true)).toBe(false)
  expect(Oidc.emailVerified({ email_verified: false }, true)).toBe(false)
  for (const value of ["true", "1", 1, null, {}, []]) {
    expect(Oidc.emailVerified({ xms_edov: value }, true)).toBe(false)
    expect(Oidc.emailVerified({ email_verified: value }, true)).toBe(false)
  }
})

test("an explicit email_verified false is not overridden by xms_edov", () => {
  expect(Oidc.emailVerified({ email_verified: false, xms_edov: true }, true)).toBe(false)
})

test("the Microsoft verified-email optional claims are not treated as evidence", () => {
  expect(Oidc.emailVerified({ verified_primary_email: ["person@example.test"] }, true)).toBe(false)
  expect(Oidc.emailVerified({ preferred_username: "person@example.test" }, true)).toBe(false)
})
