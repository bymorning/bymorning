export * as Auth from "./auth.js"
export * as AuthSchema from "./auth.js"

import { Schema, SchemaGetter } from "effect"
import * as Account from "./account.js"
import * as AuthProvider from "./auth-provider.js"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

/** Durable Linked Subject row identity. */
export const ID = Schema.String.check(Schema.isStartsWith("aut_")).pipe(
  Schema.brand("Auth.ID"),
  statics((schema) => ({ create: () => schema.make("aut_" + ascending()) })),
)
/** Durable Linked Subject row identity. */
export type ID = typeof ID.Type

/** Durable Login Session record identity. */
export const SessionID = Schema.String.check(Schema.isStartsWith("lgs_")).pipe(
  Schema.brand("Auth.SessionID"),
  statics((schema) => ({ create: () => schema.make("lgs_" + ascending()) })),
)
/** Durable Login Session record identity. */
export type SessionID = typeof SessionID.Type

/** Stable external subject string asserted by an Auth Provider or Local Login. */
export const Sub = Schema.NonEmptyString.pipe(Schema.brand("Auth.Sub"))
/** Stable external subject string. */
export type Sub = typeof Sub.Type

/** @deprecated Identity key label used by the current auth table. Prefer AuthProvider.ID. */
export const Provider = Schema.NonEmptyString.pipe(Schema.brand("Auth.Provider"))
/** @deprecated Identity key label used by the current auth table. */
export type Provider = typeof Provider.Type

/**
 * Coarse sign-in failure reason that the login callback adds as `reason` to its
 * `/login?auth=failed` redirect. Each value names an operator remedy; none
 * carries a token, an email, or an identity provider response.
 */
export const FailureReason = Schema.Literals([
  "exchange",
  "claims",
  "domain",
  "provider",
  "expired",
  "account",
  "unknown",
])
/** Coarse sign-in failure reason. */
export type FailureReason = typeof FailureReason.Type

/** Normalized email attribute on a Subject or Account. */
export const Email = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value) => value.trim().toLowerCase()),
    encode: SchemaGetter.transform((value) => value),
  }),
  Schema.check(Schema.isMaxLength(254), Schema.isPattern(/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+$/)),
  Schema.brand("Auth.Email"),
)
/** Normalized email attribute. */
export type Email = typeof Email.Type

/** Verified evidence from one Auth Provider generation. */
export const OidcSubject = Schema.Struct({
  type: Schema.Literal("oidc"),
  provider: AuthProvider.Ref,
  sub: Sub,
  email: Email,
  emailVerified: Schema.Boolean,
})
/** Verified evidence from one Auth Provider generation. */
export interface OidcSubject extends Schema.Schema.Type<typeof OidcSubject> {}

/** Verified evidence from explicit Local Login. */
export const LocalSubject = Schema.Struct({
  type: Schema.Literal("local"),
  sub: Sub,
  email: Email,
})
/** Verified evidence from explicit Local Login. */
export interface LocalSubject extends Schema.Schema.Type<typeof LocalSubject> {}

/** Verified evidence handed to Auth; never a public request body. */
export const Subject = Schema.Union([OidcSubject, LocalSubject])
/** Verified evidence handed to Auth. */
export type Subject = typeof Subject.Type

/** Durable (Auth Provider, sub) → Account link. */
export const LinkedSubject = Schema.Struct({
  id: ID,
  providerID: Schema.NullOr(AuthProvider.ID),
  sub: Sub,
  accountID: Account.ID,
})
/** Durable (Auth Provider, sub) → Account link. */
export interface LinkedSubject extends Schema.Schema.Type<typeof LinkedSubject> {}

/** One-use login attempt bound to an Auth Provider generation. */
export const Attempt = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("attempt"),
  binding: Schema.Union([
    Schema.Struct({ type: Schema.Literal("oidc"), provider: AuthProvider.Ref }),
    Schema.Struct({ type: Schema.Literal("local") }),
  ]),
  state: Schema.Redacted(Schema.NonEmptyString),
  verifier: Schema.Redacted(Schema.NonEmptyString),
  redirectURI: Schema.URL,
  redirect: Schema.optionalKey(Schema.String),
  expiresAt: Schema.DateTimeUtc,
})
/** One-use login attempt. */
export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}

/** @deprecated Use Auth.Subject. Kept while Auth.resolve still consumes provider labels. */
export const Assertion = Schema.Struct({
  provider: Provider,
  subject: Sub,
  verifiedEmail: Email,
})
/** @deprecated Use Auth.Subject. */
export interface Assertion extends Schema.Schema.Type<typeof Assertion> {}

/** @deprecated Use Auth.LinkedSubject. */
export const Info = Schema.Struct({
  id: ID,
  provider: Provider,
  subject: Sub,
  accountId: Account.ID,
})
/** @deprecated Use Auth.LinkedSubject. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Authenticated grant for one Account. Distinct from a conversation Session. */
export const Session = Schema.Struct({
  version: Schema.Literal(2),
  type: Schema.Literal("session"),
  id: SessionID,
  accountID: Account.ID,
  issuedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
})
/** Authenticated grant for one Account. */
export interface Session extends Schema.Schema.Type<typeof Session> {}

/** Secret-free Login Session summary for self-service review. */
export const LoginInfo = Schema.Struct({
  id: SessionID,
  createdAt: Schema.DateTimeUtc,
  activeAt: Schema.DateTimeUtc,
  idleUntil: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
})
/** Secret-free Login Session summary for self-service review. */
export interface LoginInfo extends Schema.Schema.Type<typeof LoginInfo> {}
