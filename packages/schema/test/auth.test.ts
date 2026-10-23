import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { AuthProvider } from "@bymorning/schema/auth-provider"
import { DateTime, Effect, Schema } from "effect"
import { expect, test } from "vitest"

test("creates and validates Auth identifiers", () => {
  const id = Auth.ID.create()
  expect(id).toMatch(/^aut_/)
  expect(Schema.decodeUnknownSync(Auth.ID)(id)).toBe(id)
  expect(() => Schema.decodeUnknownSync(Auth.ID)("acc_not-auth")).toThrow()
})

test("requires a non-empty sub", () => {
  expect(Schema.decodeUnknownSync(Auth.Sub)("person-123")).toBe("person-123")
  expect(() => Schema.decodeUnknownSync(Auth.Sub)("")).toThrow()
})

test("normalizes and validates email addresses", () => {
  expect(Schema.decodeUnknownSync(Auth.Email)("  PERSON@Example.COM ")).toBe("person@example.com")
  for (const email of ["", "person", "@example.com", "person@", "person@@example.com", "per son@example.com"]) {
    expect(() => Schema.decodeUnknownSync(Auth.Email)(email)).toThrow()
  }
  expect(() => Schema.decodeUnknownSync(Auth.Email)(`${"a".repeat(250)}@test.com`)).toThrow()
})

test("decodes an OIDC Subject and a Linked Subject", () => {
  const provider = AuthProvider.Ref.make({
    id: AuthProvider.ID.create(),
    revision: AuthProvider.Revision.make(1),
  })
  const subject = Schema.decodeUnknownSync(Auth.Subject)({
    type: "oidc",
    provider,
    sub: "person-123",
    email: " PERSON@Example.COM ",
    emailVerified: true,
  })
  expect(subject.type).toBe("oidc")
  if (subject.type !== "oidc") throw new Error("expected oidc subject")
  expect(subject.email).toBe("person@example.com")
  expect(subject.emailVerified).toBe(true)
  const linked = Schema.decodeUnknownSync(Auth.LinkedSubject)({
    id: Auth.ID.create(),
    providerID: provider.id,
    sub: subject.sub,
    accountID: Account.ID.create(),
  })
  expect(linked.accountID).toMatch(/^acc_/)
})

test("decodes a local Subject and a Login Session", () => {
  const subject = Schema.decodeUnknownSync(Auth.Subject)({
    type: "local",
    sub: "developer",
    email: "owner@local.test",
  })
  expect(subject.type).toBe("local")
  const now = DateTime.nowUnsafe()
  const session = Auth.Session.make({
    version: 2,
    type: "session",
    id: Auth.SessionID.create(),
    accountID: Account.ID.create(),
    issuedAt: now,
    expiresAt: DateTime.addDuration(now, "12 hours"),
  })
  expect(session.type).toBe("session")
  expect(session.id).toMatch(/^lgs_/)
})

test("refuses a version 1 Login Session payload", () => {
  const now = DateTime.nowUnsafe()
  const decoded = Schema.decodeUnknownEffect(Auth.Session)({
    version: 1,
    type: "session",
    accountID: Account.ID.create(),
    issuedAt: now,
    expiresAt: DateTime.addDuration(now, "12 hours"),
  })
  expect(() => Effect.runSync(decoded)).toThrow()
})
