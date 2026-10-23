/** Installation-owned OIDC login target. */
export * as AuthProvider from "./auth-provider.js"
export * as AuthProviderSchema from "./auth-provider.js"

import { Redacted, Schema, SchemaGetter } from "effect"
import { ascending } from "./identifier.js"
import { PositiveInt, statics } from "./schema.js"

/** Permanent Auth Provider identity. */
export const ID = Schema.String.check(Schema.isPattern(/^apv_[A-Za-z0-9]{26}$/)).pipe(
  Schema.brand("AuthProvider.ID"),
  statics((schema) => ({ create: () => schema.make(`apv_${ascending()}`) })),
)
/** Permanent Auth Provider identity. */
export type ID = typeof ID.Type

/** Monotonic configuration generation used by edits and login attempts. */
export const Revision = PositiveInt.pipe(Schema.brand("AuthProvider.Revision"))
/** Monotonic configuration generation. */
export type Revision = typeof Revision.Type

/** Guidance only; never an identity key or protocol switch. */
export const Kind = Schema.Literals(["google", "okta", "microsoft", "auth0", "ping", "custom"])
/** Guidance only; never an identity key or protocol switch. */
export type Kind = typeof Kind.Type

/** Whether an Auth Provider admits new sign-ins. */
export const Status = Schema.Literals(["enabled", "disabled"])
/** Whether an Auth Provider admits new sign-ins. */
export type Status = typeof Status.Type

/** Normalized bare email domain. */
export const Domain = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value) => value.trim().toLowerCase()),
    encode: SchemaGetter.transform((value) => value),
  }),
  Schema.check(
    Schema.isMaxLength(253),
    Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/),
  ),
  Schema.brand("AuthProvider.Domain"),
)
/** Normalized bare email domain. */
export type Domain = typeof Domain.Type

const loopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"

/** Exact OIDC issuer spelling. HTTPS, except loopback HTTP for the local fixture. */
export const Issuer = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      if (!URL.canParse(value)) return false
      const url = new URL(value)
      const secure = url.protocol === "https:" || (url.protocol === "http:" && loopback(url.hostname))
      return (
        value === value.trim() &&
        secure &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === ""
      )
    },
    { expected: "an HTTPS OIDC issuer" },
  ),
).pipe(Schema.brand("AuthProvider.Issuer"))
/** Exact OIDC issuer spelling. */
export type Issuer = typeof Issuer.Type

/** Wire secret that becomes Redacted after decode. */
const Secret = Schema.NonEmptyString.pipe(
  Schema.decodeTo(Schema.Redacted(Schema.NonEmptyString), {
    decode: SchemaGetter.transform((value) => Redacted.make(value)),
    encode: SchemaGetter.transform((value) => Redacted.value(value)),
  }),
)

const editable = {
  displayName: Schema.NonEmptyString.check(Schema.isMaxLength(120)),
  kind: Kind,
  domains: Schema.NonEmptyArray(Domain),
}

const credentials = {
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  clientSecret: Secret,
}

/** Creation fields without identity; used to insert-if-absent at boot. */
export const Seed = Schema.Struct({
  ...editable,
  ...credentials,
})
/** Parsed seed input. */
export interface Seed extends Schema.Schema.Type<typeof Seed> {}

/** All required creation fields; new Auth Providers start enabled at revision 1. */
export const Create = Schema.Struct({
  id: ID,
  ...editable,
  ...credentials,
})
/** Parsed creation input. */
export interface Create extends Schema.Schema.Type<typeof Create> {}

/** Exact configuration reference. */
export const Ref = Schema.Struct({
  id: ID,
  revision: Revision,
})
/** Exact configuration reference. */
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

/** Full editable form; omitted secret retains the stored value. */
export const Update = Schema.Struct({
  ...Ref.fields,
  ...editable,
  status: Status,
  clientSecret: Schema.optionalKey(Secret),
})
/** Parsed edit input. */
export interface Update extends Schema.Schema.Type<typeof Update> {}

/** Admin-readable configuration; never contains a client secret. */
export const Info = Schema.Struct({
  ...Ref.fields,
  ...editable,
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  status: Status,
})
/** Admin-readable configuration. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Token-authorized first configuration or targeted recovery. */
export const Setup = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("create"),
    token: Secret,
    value: Create,
  }),
  Schema.Struct({
    type: Schema.Literal("update"),
    token: Secret,
    value: Update,
  }),
])
/** Parsed setup or recovery input. */
export type Setup = typeof Setup.Type

/** Safe boundary parsing failure; contains no rejected values. */
export class InvalidError extends Schema.TaggedError<InvalidError>()("AuthProvider.InvalidError", {
  field: Schema.Literals([
    "id",
    "revision",
    "displayName",
    "kind",
    "issuer",
    "clientID",
    "clientSecret",
    "domains",
    "status",
    "token",
    "input",
  ]),
  message: Schema.String,
}) {}

/** The requested Auth Provider does not exist. */
export class MissingError extends Schema.TaggedError<MissingError>()("AuthProvider.MissingError", {
  id: ID,
  message: Schema.String,
}) {}

/** A create collided or an edit used an obsolete revision. */
export class ConflictError extends Schema.TaggedError<ConflictError>()("AuthProvider.ConflictError", {
  id: ID,
  reason: Schema.Literals(["exists", "revision"]),
  message: Schema.String,
}) {}

/** This Auth Provider is disabled. */
export class DisabledError extends Schema.TaggedError<DisabledError>()("AuthProvider.DisabledError", {
  id: ID,
  message: Schema.String,
}) {}

/** Discovery could not establish a compatible confidential OIDC client. */
export class DiscoveryError extends Schema.TaggedError<DiscoveryError>()("AuthProvider.DiscoveryError", {
  reason: Schema.Literals(["unreachable", "issuer", "endpoint", "grant", "pkce", "client-auth"]),
  message: Schema.String,
}) {}

/** Setup or recovery proof is incorrect. */
export class TokenError extends Schema.TaggedError<TokenError>()("AuthProvider.TokenError", {
  message: Schema.String,
}) {}

/** Configuration persistence or setup-token generation is unavailable. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("AuthProvider.UnavailableError", {
  operation: Schema.Literals(["init", "list", "get", "create", "update", "resolve", "inspect", "setup"]),
  message: Schema.String,
}) {}
