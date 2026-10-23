# Auth Provider — interface proposal

Status: **proposed interfaces; awaiting approval**. Domain terms were confirmed
on 2026-09-11 and recorded in `CONTEXT.md`: multiple Auth Providers, conservative
Subject identity, Linked Subject as the durable account link. Runtime operations
live in [Auth module](auth-module.md). This replaces Login Method.

## 1. Summary

Admins configure Google Workspace, Okta, Microsoft Entra, or other standard OIDC
clients as Auth Providers through Settings → Security. Configuration is persisted
and takes effect without a deployment. The public login page lists enabled Auth
Providers. First setup and recovery use the Installation's setup token.

Mio's login target is called Provider. ByMorning keeps Catalog **Provider** as
the inference endpoint and names the login target **Auth Provider**.

## 2. Proposed schemas

Proposed file: `packages/schema/src/auth-provider.ts`. Protocol reuses these
schemas. `AuthProvider` is two public words.

```ts
/** Installation-owned OIDC login target. */
export * as AuthProvider from "./auth-provider.js"

import { Schema, SchemaGetter } from "effect"
import { ascending } from "./identifier.js"
import { PositiveInt, statics } from "./schema.js"

/** Permanent Auth Provider identity, allocated by the form before IdP registration. */
export const ID = Schema.String.check(Schema.isPattern(/^apv_[A-Za-z0-9]{26}$/)).pipe(
  Schema.brand("AuthProvider.ID"),
  statics((schema) => ({ create: () => schema.make(`apv_${ascending()}`) })),
)
export type ID = typeof ID.Type

/** Monotonic configuration generation used by edits and login attempts. */
export const Revision = PositiveInt.pipe(Schema.brand("AuthProvider.Revision"))
export type Revision = typeof Revision.Type

/** Guidance only; never an identity key or protocol switch. */
export const Kind = Schema.Literals(["google", "okta", "microsoft", "auth0", "ping", "custom"])
export const Status = Schema.Literals(["enabled", "disabled"])

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

/** Exact OIDC issuer spelling; HTTPS, no credentials, query, or fragment. */
export const Issuer = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      if (!URL.canParse(value)) return false
      const url = new URL(value)
      return (
        value === value.trim() &&
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === ""
      )
    },
    { expected: "an HTTPS OIDC issuer" },
  ),
).pipe(Schema.brand("AuthProvider.Issuer"))

const editable = {
  displayName: Schema.NonEmptyString.check(Schema.isMaxLength(120)),
  kind: Kind,
  domains: Schema.NonEmptyArray(Domain),
}

export const Create = Schema.Struct({
  id: ID,
  ...editable,
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  clientSecret: Schema.Redacted(Schema.NonEmptyString),
})
export type Create = typeof Create.Type

export const Ref = Schema.Struct({ id: ID, revision: Revision })
export type Ref = typeof Ref.Type

export const Update = Schema.Struct({
  ...Ref.fields,
  ...editable,
  status: Status,
  clientSecret: Schema.optionalKey(Schema.Redacted(Schema.NonEmptyString)),
})
export type Update = typeof Update.Type

export const Info = Schema.Struct({
  ...Ref.fields,
  ...editable,
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  status: Status,
})
export type Info = typeof Info.Type

export const Setup = Schema.Union([
  Schema.Struct({ type: Schema.Literal("create"), token: Schema.Redacted(Schema.NonEmptyString), value: Create }),
  Schema.Struct({ type: Schema.Literal("update"), token: Schema.Redacted(Schema.NonEmptyString), value: Update }),
])
export type Setup = typeof Setup.Type

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
export class MissingError extends Schema.TaggedError<MissingError>()("AuthProvider.MissingError", {
  id: ID,
  message: Schema.String,
}) {}
export class ConflictError extends Schema.TaggedError<ConflictError>()("AuthProvider.ConflictError", {
  id: ID,
  reason: Schema.Literals(["exists", "revision"]),
  message: Schema.String,
}) {}
export class DisabledError extends Schema.TaggedError<DisabledError>()("AuthProvider.DisabledError", {
  id: ID,
  message: Schema.String,
}) {}
export class DiscoveryError extends Schema.TaggedError<DiscoveryError>()("AuthProvider.DiscoveryError", {
  reason: Schema.Literals(["unreachable", "issuer", "endpoint", "grant", "pkce", "client-auth"]),
  message: Schema.String,
}) {}
export class TokenError extends Schema.TaggedError<TokenError>()("AuthProvider.TokenError", {
  message: Schema.String,
}) {}
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("AuthProvider.UnavailableError", {
  operation: Schema.Literals(["init", "list", "get", "create", "update", "resolve", "inspect", "setup"]),
  message: Schema.String,
}) {}
```

Issuer and client ID are immutable on an Auth Provider. A different issuer or
client registration is a new Auth Provider. Secret, label, kind, domains, and
status are edits. This keeps a Linked Subject bound to one issuer/client pair.

## 3. AuthProvider service

Proposed sole Core entrypoint: `packages/core/src/auth-provider.ts`.

```ts
export * as AuthProvider from "./auth-provider.js"

import { AuthProvider } from "@bymorning/schema/auth-provider"
import { Context, Crypto, Effect, Layer, Redacted } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Database } from "./database.js"

export interface Active extends Omit<AuthProvider.Info, "status"> {
  readonly status: "enabled"
  readonly clientSecret: Redacted.Redacted<string>
}

export interface Interface {
  readonly init: () => Effect.Effect<void, AuthProvider.UnavailableError>
  readonly list: () => Effect.Effect<ReadonlyArray<AuthProvider.Info>, AuthProvider.UnavailableError>
  readonly get: (
    id: AuthProvider.ID,
  ) => Effect.Effect<AuthProvider.Info, AuthProvider.MissingError | AuthProvider.UnavailableError>
  readonly create: (
    input: AuthProvider.Create,
  ) => Effect.Effect<
    AuthProvider.Info,
    AuthProvider.ConflictError | AuthProvider.DiscoveryError | AuthProvider.UnavailableError
  >
  readonly update: (
    input: AuthProvider.Update,
  ) => Effect.Effect<
    AuthProvider.Info,
    AuthProvider.MissingError | AuthProvider.ConflictError | AuthProvider.DiscoveryError | AuthProvider.UnavailableError
  >
  readonly resolve: (input: {
    readonly id: AuthProvider.ID
    readonly revision?: AuthProvider.Revision
  }) => Effect.Effect<
    Active,
    AuthProvider.MissingError | AuthProvider.DisabledError | AuthProvider.ConflictError | AuthProvider.UnavailableError
  >
  readonly inspect: (
    token: Redacted.Redacted<string>,
  ) => Effect.Effect<ReadonlyArray<AuthProvider.Info>, AuthProvider.TokenError | AuthProvider.UnavailableError>
  readonly setup: (
    input: AuthProvider.Setup,
  ) => Effect.Effect<
    AuthProvider.Info,
    | AuthProvider.TokenError
    | AuthProvider.MissingError
    | AuthProvider.ConflictError
    | AuthProvider.DiscoveryError
    | AuthProvider.UnavailableError
  >
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/AuthProvider") {}
```

`resolve` has no HTTP endpoint. Admin HTTP uses `requireAdmin`. Discovery is
required on create, re-enable, and secret replacement; disable works while the
IdP is down. Every update advances revision.

## 4. Subject and Linked Subject

Mio's conservative identity: link by `(provider, sub)`, never by email.
`email` and `emailVerified` are attributes of a Subject.

Proposed in `packages/schema/src/auth.ts`:

```ts
import { AuthProvider } from "./auth-provider.js"
import { Account } from "./account.js"

export const Sub = Schema.NonEmptyString.pipe(Schema.brand("Auth.Sub"))

/** Verified evidence from one Auth Provider generation, or explicit Local Login. */
export const Subject = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("oidc"),
    provider: AuthProvider.Ref,
    sub: Sub,
    email: Email,
    emailVerified: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("local"),
    sub: Sub,
    email: Email,
  }),
])

/** Durable (Auth Provider, sub) → Account. */
export const LinkedSubject = Schema.Struct({
  providerID: AuthProvider.ID,
  sub: Sub,
  accountID: Account.ID,
})
```

Auth admits an OIDC Subject only when `emailVerified` is true and the email
domain is on that Auth Provider. Lookup uses `(providerID, sub)` only. Email
is stored as a non-unique Account attribute.

## 5. HTTP

| Endpoint                             | Authorization     | Success                                                                                                               |
| ------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/method`                   | Public            | `{ state: "setup", callbackBase }` or `{ state: "ready", callbackBase, providers: Array<{ id, displayName, kind }> }` |
| `POST /auth/inspect`                 | Setup token       | Secret-free `AuthProvider.Info[]`                                                                                     |
| `POST /auth/setup`                   | Setup token       | `AuthProvider.Info`                                                                                                   |
| `GET /auth/login?provider=<id>`      | Public            | 302 to that IdP                                                                                                       |
| `GET /auth/callback/:providerID`     | Encrypted attempt | 303                                                                                                                   |
| `GET /api/auth-provider`             | Workspace admin   | `AuthProvider.Info[]`                                                                                                 |
| `POST /api/auth-provider`            | Workspace admin   | `AuthProvider.Info` (201)                                                                                             |
| `GET /api/auth-provider/:providerID` | Workspace admin   | `AuthProvider.Info`                                                                                                   |
| `PUT /api/auth-provider/:providerID` | Workspace admin   | `AuthProvider.Info`                                                                                                   |

Callback URL is `${APP_ORIGIN}/auth/callback/${id}`. Public output omits
secrets, issuer, client ID, domains, disabled providers, and revisions.

## 6. File layout

```text
packages/schema/src/auth-provider.ts               add
packages/schema/src/auth.ts                        change  Subject, LinkedSubject; drop Auth.Provider as identity key
packages/core/src/auth-provider.ts                 add
packages/core/src/auth-provider/{store,discovery,token}.ts  add
packages/core/src/database/schema/auth-provider.sql.ts      add
packages/core/src/database/schema/auth.sql.ts      change  Linked Subject rows
packages/protocol/src/groups/auth-provider.ts      add
packages/web/src/settings/security/*               add
```

Existing-installation migration maps historical `Auth.Provider` labels to Auth
Provider IDs only with an explicit operator mapping, never from email.

## 7. Approval boundary

- Auth Provider is the login target; Provider remains the inference endpoint.
- Subject is ephemeral evidence; Linked Subject is `(AuthProvider.ID, sub)`.
- Email does not merge Accounts. OIDC requires `emailVerified`.
- Runtime remains [Auth module](auth-module.md): `open` / `complete` /
  `authenticate` / `end`.
