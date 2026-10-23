# Auth module — interface proposal

Status: **proposed interfaces; awaiting approval**. This deepens Auth using
Mio's issuer shape, and it is the runtime that the
[Auth Provider](auth-provider.md) configuration plugs into.

## 1. Summary

Auth becomes the single login runtime. Callers open a selected Auth Provider,
complete the callback, authenticate a Login Session, and end it. OIDC, PKCE,
discovery, Linked Subject resolution, domain admission, and first-Account
provisioning stay behind that interface. AuthProvider remains the configuration
module. HTTP handlers encrypt Auth's domain values into cookies; they do not
run OIDC or decide Accounts.

Mio's `@mio/auth` is the reference for this depth, not a package to copy.

## 2. Evidence from Mio and ByMorning

Mio's auth library is an OpenAuth-style issuer with no Mio account tables:

| Mio module                                          | Interface a caller learns                    | Hidden implementation                                       |
| --------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `Issuer` (`begin`, `complete`, `verify`, `refresh`) | selected provider name in, URL or tokens out | PKCE, pending storage, provider HTTP, `resolve`, token mint |
| `Provider` (`authorize`, `exchange`, `userinfo`)    | one login target                             | OAuth endpoints and userinfo decoding                       |
| `Subject`                                           | `(issuer, sub)` plus email attributes        | —                                                           |
| `Storage`                                           | pending authorizations and refresh records   | memory or SQL adapters                                      |
| `resolve` callback                                  | verified subject in, account ID out          | `@mio/core/auth` `LinkedSubject`                            |

Application code depends on `mio/AuthIssuer`, not on OAuth internals. Core
Auth shrinks to account linking. Handler.ts is a thin HTTP adapter.

ByMorning's current login cluster is the opposite shape. A browser login
crosses four public seams:

```text
LoginRoute
  → GET /auth/login                         protocol/groups/auth.ts
    → authHandler                           server/handlers/auth.ts
      → WebProvider.start                   server/web-provider.ts
      → WebCookie.encrypt(Attempt)          server/web-cookie.ts
  → GET /auth/callback
    → WebProvider.complete → Auth.Assertion (today)
    → Auth.resolve(assertion)               core/auth.ts
    → WebCookie.encrypt(Account cookie)
  → Account middleware decrypts the cookie  server/middleware/auth.ts
```

Observed problems:

- `WebProvider` is named like Catalog `Provider` (an inference endpoint).
- `Auth.Provider` is a free-form label and the identity key. Mio keys links by
  `(issuer, sub)`.
- `Auth.resolve` still links by email, against the Linked Subject glossary.
- Handlers own protocol failure mapping, cookie lifetimes, and account
  completion. Mio's handler only translates Issuer results.
- Login Session exists in the glossary but the implementation is an encrypted
  Account ID with no Auth operation to authenticate or end it.
- Local Login fakes the OIDC `WebProvider` interface instead of being a second
  Auth adapter.

Do not copy from Mio:

| Mio choice                                   | Why ByMorning should not take it                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Unqualified `Provider` for Google/Okta       | Catalog `Provider` already means an inference endpoint. The login target is Auth Provider.                                                 |
| Service name `Issuer`                        | Collides with the OIDC issuer URL. Keep `Auth`.                                                                                            |
| Minted access/refresh JWTs as the session    | Auth already owns Login Sessions; people authenticate with cookies. Token already means API/MCP credentials.                               |
| Userinfo as sole identity proof              | ByMorning already verifies signed ID tokens; keep that. Mio lists JWKS as outstanding.                                                     |
| HTTP contract inside the auth package        | `@bymorning/protocol` is the HTTP source of truth.                                                                                         |
| New `@bymorning/auth` package                | Auth here knows Accounts and Auth Providers. Mio extracted a package because that library has no Mio domain. Core remains the public seam. |
| Static `providers: Record<string, Provider>` | Auth Providers are persisted and change without restart.                                                                                   |

## 3. Proposed modules

Two public Core modules, one transport adapter:

```text
AuthProvider    configuration: list/get/create/update/setup
Auth            login runtime: open/complete/authenticate/end
WebCookie       server adapter: encrypt/decrypt Auth values
```

Auth is Mio's Issuer. AuthProvider is Mio's provider map, persisted, named so
it does not collide with Catalog Provider. WebCookie is not an identity
authority.

```ts
// packages/core/src/auth.ts
export * as Auth from "./auth.js"

import { AccountActor } from "@bymorning/schema/actor"
import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { AuthProvider } from "@bymorning/schema/auth-provider"
import { Context, Effect, Layer, Redacted } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Crypto } from "effect"
import { Database } from "./database.js"
import { Storage } from "./storage.js"
import { AuthProvider as AuthProviderService } from "./auth-provider.js"

/** Verified evidence. Never a public request body. */
export const Subject = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("oidc"),
    provider: AuthProvider.Ref,
    sub: Auth.Sub,
    email: Auth.Email,
    emailVerified: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("local"),
    sub: Auth.Sub,
    email: Auth.Email,
  }),
])

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

/** Authenticated grant for one Account. Distinct from a conversation Session. */
export const Session = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("session"),
  accountID: Account.ID,
  issuedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
})

export class RejectedError extends Schema.TaggedError<RejectedError>()("Auth.RejectedError", {
  reason: Schema.Literals([
    "email-domain",
    "email-unverified",
    "provider-missing",
    "provider-disabled",
    "provider-changed",
    "local-disabled",
    "account-unavailable",
    "callback",
  ]),
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Auth.UnavailableError", {
  operation: Schema.Literals(["open", "complete", "authenticate", "end"]),
  message: Schema.String,
}) {}

export class ExpiredError extends Schema.TaggedError<ExpiredError>()("Auth.ExpiredError", {
  reason: Schema.Literals(["attempt", "session"]),
  message: Schema.String,
}) {}

/** Login runtime. Callers never import OIDC, PKCE, or identity SQL. */
export interface Interface {
  readonly open: (input: {
    readonly selection: { readonly type: "oidc"; readonly id: AuthProvider.ID } | { readonly type: "local" }
    readonly redirectURI: URL
    readonly redirect?: string
  }) => Effect.Effect<{ readonly redirect: URL; readonly attempt: Attempt }, RejectedError | UnavailableError>

  readonly complete: (input: {
    readonly attempt: Attempt
    readonly response: Redacted.Redacted<URLSearchParams>
  }) => Effect.Effect<
    { readonly actor: AccountActor; readonly session: Session },
    RejectedError | ExpiredError | ProvisionError | UnavailableError
  >

  readonly authenticate: (
    session: Session,
  ) => Effect.Effect<AccountActor, RejectedError | ExpiredError | UnavailableError>

  readonly end: (session: Session) => Effect.Effect<void, UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/Auth") {}
```

`open` is Mio `begin`. `complete` is Mio `complete`, including account
resolution. `authenticate` is Mio `verify` over a Login Session instead of a
JWT. `end` is logout; cookie clearing stays in the HTTP adapter.

OIDC `email_verified` (or Microsoft's `xms_edov` for the ID-token email) is part of the Subject. Admission requires it unless
the selected path is Local Login. That closes the current hole where
`email_verified: false` is stored as `verifiedEmail`.

Linked Subject lookup is `(AuthProvider.ID, sub)` only. Email is an Account
attribute, not a link key, matching Mio's `LinkedSubject` and the glossary.

### Private Auth internals

```text
packages/core/src/auth.ts                 public Issuer-style interface
packages/core/src/auth/oidc.ts            confidential-client OIDC (today's WebProvider)
packages/core/src/auth/identity.ts        (AuthProvider.ID, sub) → Account, provisioning
packages/core/src/auth/session.ts         Login Session issue/authenticate/end
packages/core/src/auth/local.ts           explicit Local Login adapter
```

`oidc.ts` keeps today's discovery, PKCE S256, nonce, JWKS, client-auth method
selection, and userinfo-only-when-email-absent behavior. It is not a public
service. Tests that currently import `WebProvider` move to Auth or to the
private OIDC module's own tests.

Local Login is a second Auth Layer, like Mio `layerStatic`: `open`/`complete`
never call OIDC. Production composition does not install that Layer.

### AuthProvider

Unchanged from [auth-provider.md](auth-provider.md):
`list`/`get`/`create`/`update`/`resolve`/`setup`/`inspect`. Auth calls
`AuthProvider.resolve` during `open`/`complete`. Auth does not expose Auth
Provider CRUD.

## 4. Nested call graph

```text
GET /auth/login?provider=<id>
  → Auth.open({ selection: { type: "oidc", id }, redirectURI, redirect })
      → AuthProvider.resolve({ id })
      → private OIDC start (discovery, PKCE, nonce)
    ← { redirect, attempt }
  → WebCookie.encrypt(attempt) + 302

GET /auth/callback/<id>
  → WebCookie.decrypt(attempt cookie)
  → Auth.complete({ attempt, response })
      → AuthProvider.resolve({ id, revision })
      → private OIDC complete (code, state, nonce, JWKS, claims)
      → private Linked Subject (AuthProvider.ID, sub)
          → domain admission from that Auth Provider
          → provision Account / claim invitation
      → private session issue
    ← { actor, session }
  → WebCookie.encrypt(session) + expire attempt + 303

Account middleware
  → WebCookie.decrypt(session cookie)
  → Auth.authenticate(session)
    ← AccountActor

POST /auth/logout
  → Auth.end(session)
  → expire session cookie
```

Failure: stale revision during `complete` becomes `RejectedError` reason
`provider-changed`. The handler expires the attempt cookie and redirects to
`/login?auth=failed`. It does not inspect OIDC internals.

Member calling `POST /api/auth-provider` still dies in `requireAdmin` before
Auth or AuthProvider run.

## 5. Inputs, outputs, errors

| Operation      | Input                                                          | Output                 | Errors                                                                                                                            |
| -------------- | -------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `open`         | selection, trusted callback URL, optional relative return path | IdP redirect + Attempt | `provider-missing/disabled/local-disabled`, `UnavailableError`                                                                    |
| `complete`     | Attempt + redacted callback params                             | AccountActor + Session | `provider-changed/disabled`, `email-domain`, `email-unverified`, `callback`, `ExpiredError`, `ProvisionError`, `UnavailableError` |
| `authenticate` | Session                                                        | AccountActor           | `account-unavailable`, `ExpiredError`, `UnavailableError`                                                                         |
| `end`          | Session                                                        | void                   | `UnavailableError`                                                                                                                |

HTTP mapping stays in the server adapter: expected login failures collapse to
the generic callback redirect; `UnavailableError` is 503 on `open`;
`authenticate` failures are existing 401.

## 6. Minimum happy path

Admin has created Google Workspace Auth Provider `apv_…` at revision 1, domain
`example.com`. Person selects that button.

`Auth.open` returns an authorization URL at `accounts.google.com` and an
Attempt bound to `{ id: apv_…, revision: 1 }`. After Google redirects with a
signed ID token `{ sub: "google-sub", email: "a@example.com", email_verified: true }`,
`Auth.complete` returns an `AccountActor` and a 12-hour Session. Repeat login
with the same Auth Provider and `sub` returns that Account. A second Auth
Provider with the same email and a different `sub` returns a different Account.

No error.

## 7. File layout

```text
packages/schema/src/auth.ts                         change  Subject, LinkedSubject, Attempt, Session; drop Auth.Provider as identity key
packages/core/src/auth.ts                           change  open/complete/authenticate/end
packages/core/src/auth/{oidc,identity,session,local}.ts  add  private internals
packages/core/src/auth-provider.ts                 add     configuration module (separate proposal)
packages/server/src/web-provider.ts                 delete  absorbed by auth/oidc.ts
packages/server/src/application/adapters/identity-local.ts
                                                    change  Auth.layerLocal, not a fake OIDC client
packages/server/src/handlers/auth.ts                change  thin cookie/redirect adapter
packages/server/src/middleware/auth.ts              change  decrypt then Auth.authenticate
packages/server/src/web-cookie.ts                   change  encrypt Auth.Attempt / Auth.Session only
packages/server/src/application.ts                  change  bind Auth, not WebProvider
```

Host composition selects `Auth.layer` (OIDC via AuthProvider) or
`Auth.layerLocal` (development). That is Mio's real seam: two adapters.

## 8. Verification

Keep Mio's test rule: the interface is the test surface.

1. Auth.open/complete against the existing OIDC fixture, through Core, with
   Google-style post auth and a path issuer. Subjects include
   `email_verified`.
2. Two Auth Providers, same email, distinct Accounts; repeat login is stable.
3. Stale attempt revision, swapped callbacks, and disabled Auth Providers fail
   before Account writes.
4. Local Login adapter: open/complete never touch discovery; production layer
   rejects `{ type: "local" }`.
5. HTTP tests assert redirects and cookies only; they do not reimplement OIDC.
6. Existing WebProvider unit tests move next to `auth/oidc.ts` or become Auth
   tests. Do not keep both.

## 9. Approval boundary

Approve together with [Auth Provider](auth-provider.md):

- Auth is the deep login runtime (`open`/`complete`/`authenticate`/`end`).
- AuthProvider is configuration only.
- Linked Subject key is `(AuthProvider.ID, sub)`.
- Do not name login targets unqualified Provider. Do not mint JWTs. Do not add
  `packages/auth`.
- Local Login is a second Auth adapter.
- `email_verified` is required for OIDC admission.
