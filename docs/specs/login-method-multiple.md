# Multiple Login Methods — interface proposal

Status: **superseded**. The login target is an Auth Provider, not a Login Method.
Identity is a Subject / Linked Subject. See [Auth Provider](auth-provider.md)
and [Auth module](auth-module.md).

## 1. Summary and evidence

Admins configure Google Workspace, Okta, Microsoft Entra, or other standard OIDC
clients through Settings → Security. Configuration is persisted and takes effect
without a deployment. The public login page lists enabled methods. First setup
and recovery use the Installation's retained setup token.

The current implementation provides the following reusable seams:

| File / symbol                                                | Observed responsibility                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/web-provider.ts`, `WebProvider.Service` | Discovery, authorization code, PKCE, nonce, token signature/claims, userinfo; currently one static client.                         |
| `packages/server/src/handlers/auth.ts`, `authHandler`        | Start/callback redirects, encrypted attempts, account cookies, failure projection.                                                 |
| `packages/core/src/auth.ts`, `Auth.resolve`                  | Domain admission, identity/account resolution, invitation claims, provisioning; currently uses email as an additional linking key. |
| `packages/core/src/database/schema/auth.sql.ts`              | Unique `(provider, subject)` links; historical provider labels do not encode issuer/client provenance.                             |
| `packages/server/src/middleware/admin.ts`, `requireAdmin`    | Existing `admin` authorization at the HTTP edge.                                                                                   |
| `packages/server/src/application.ts`, `Application.process`  | Process-global LayerNode composition and explicit host adapters.                                                                   |
| `packages/core/src/database.ts`, `Database.transact`         | Calls through `Database.use` participate in the current transaction.                                                               |
| `packages/web/src/login/route.tsx`, `LoginRoute`             | One static sign-in link today.                                                                                                     |
| `packages/server/src/application/adapters/identity-local.ts` | Explicit development-only identity adapter.                                                                                        |

`Credential.client` was inspected: it owns Workspace/Integration outbound client
setup. Installation login credentials belong to LoginMethod, not that seam.
The root guide's referenced `references/domain-design.md` and
`references/service-design.md` are absent from this checkout; this proposal follows
the domain/public-service requirements written directly in `AGENTS.md`.

## 2. Proposed interfaces

### 2.1 Shared schemas

Proposed file: `packages/schema/src/login-method.ts`. Protocol reuses these
schemas; it does not import Core implementation. `Schema.TaggedError` is the API
available in the repository's installed Effect version.

```ts
/** Installation-owned OIDC configuration values. */
export * as LoginMethod from "./login-method.js"

import { Schema, SchemaGetter } from "effect"
import { ascending } from "./identifier.js"
import { PositiveInt, statics } from "./schema.js"

/** Permanent method identity, also allocated by the form before client registration. */
export const ID = Schema.String.check(Schema.isPattern(/^lgm_[A-Za-z0-9]{26}$/)).pipe(
  Schema.brand("LoginMethod.ID"),
  statics((schema) => ({ create: () => schema.make(`lgm_${ascending()}`) })),
)
/** Permanent method identity. */
export type ID = typeof ID.Type

/** Monotonic configuration generation used by edits and login attempts. */
export const Revision = PositiveInt.pipe(Schema.brand("LoginMethod.Revision"))
/** Monotonic configuration generation. */
export type Revision = typeof Revision.Type

/** Guidance only; never an identity key or protocol switch. */
export const Preset = Schema.Literals(["google", "okta", "microsoft", "auth0", "ping", "custom"])
/** Whether a method admits new sign-ins. */
export const Status = Schema.Literals(["enabled", "disabled"])

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
  Schema.brand("LoginMethod.Domain"),
)

/** Validated issuer identifier preserving its exact spelling for OIDC comparison. */
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
).pipe(Schema.brand("LoginMethod.Issuer"))

const editable = {
  displayName: Schema.NonEmptyString.check(Schema.isMaxLength(120)),
  preset: Preset,
  domains: Schema.NonEmptyArray(Domain),
}

/** All required creation fields; new methods start enabled at revision 1. */
export const Create = Schema.Struct({
  id: ID,
  ...editable,
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  clientSecret: Schema.Redacted(Schema.NonEmptyString),
})
/** Parsed creation input. */
export type Create = typeof Create.Type

/** Exact configuration reference. */
export const Ref = Schema.Struct({ id: ID, revision: Revision })
/** Exact configuration reference. */
export type Ref = typeof Ref.Type

/** Full editable form; omitted secret retains the stored value. */
export const Update = Schema.Struct({
  ...Ref.fields,
  ...editable,
  status: Status,
  clientSecret: Schema.optionalKey(Schema.Redacted(Schema.NonEmptyString)),
})
/** Parsed edit input. */
export type Update = typeof Update.Type

/** Admin-readable configuration; never contains a client secret. */
export const Info = Schema.Struct({
  ...Ref.fields,
  ...editable,
  issuer: Issuer,
  clientID: Schema.NonEmptyString,
  status: Status,
})
/** Admin-readable configuration. */
export type Info = typeof Info.Type

/** Token-authorized first configuration or targeted recovery. */
export const Setup = Schema.Union([
  Schema.Struct({ type: Schema.Literal("create"), token: Schema.Redacted(Schema.NonEmptyString), value: Create }),
  Schema.Struct({ type: Schema.Literal("update"), token: Schema.Redacted(Schema.NonEmptyString), value: Update }),
])
/** Parsed setup or recovery input. */
export type Setup = typeof Setup.Type

/** Safe boundary parsing failure; contains no rejected values. */
export class InvalidError extends Schema.TaggedError<InvalidError>()("LoginMethod.InvalidError", {
  field: Schema.Literals([
    "id",
    "revision",
    "displayName",
    "preset",
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
/** The requested method does not exist. */
export class MissingError extends Schema.TaggedError<MissingError>()("LoginMethod.MissingError", {
  id: ID,
  message: Schema.String,
}) {}
/** A create collided or an edit/login used an obsolete revision. */
export class ConflictError extends Schema.TaggedError<ConflictError>()("LoginMethod.ConflictError", {
  id: ID,
  reason: Schema.Literals(["exists", "revision"]),
  message: Schema.String,
}) {}
/** This method is disabled. */
export class DisabledError extends Schema.TaggedError<DisabledError>()("LoginMethod.DisabledError", {
  id: ID,
  message: Schema.String,
}) {}
/** Discovery could not establish a compatible confidential OIDC client. */
export class DiscoveryError extends Schema.TaggedError<DiscoveryError>()("LoginMethod.DiscoveryError", {
  reason: Schema.Literals(["unreachable", "issuer", "endpoint", "grant", "pkce", "client-auth"]),
  message: Schema.String,
}) {}
/** Setup/recovery proof is incorrect. */
export class TokenError extends Schema.TaggedError<TokenError>()("LoginMethod.TokenError", {
  message: Schema.String,
}) {}
/** Configuration persistence or setup-token generation is unavailable. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("LoginMethod.UnavailableError", {
  operation: Schema.Literals(["init", "list", "get", "create", "update", "resolve", "inspect", "setup"]),
  message: Schema.String,
}) {}
```

Input codecs parse at the boundary; parse issues are projected into `InvalidError`
without received values. Empty secret on edit is rejected; absence means retain.
Domain lists are deduplicated after normalization. Issuer identifiers retain their
OIDC spelling: do not casually add/remove a meaningful trailing slash.

**Proposed identity invariant:** issuer and client ID are immutable on a method.
A different issuer or client registration is a new method. Secret rotation, label,
preset, domains, and enabled status are edits. This prevents an existing subject
link from silently changing its issuer/client meaning.

### 2.2 LoginMethod service

Proposed sole Core entrypoint: `packages/core/src/login-method.ts`.

```ts
/** Login Method configuration and setup authority. */
export * as LoginMethod from "./login-method.js"

import { LoginMethod } from "@bymorning/schema/login-method"
import { Context, Crypto, Effect, Layer, Redacted } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Database } from "./database.js"

/** Resolved secret-bearing configuration, consumed only by the server's OIDC adapter. */
export interface Active extends Omit<LoginMethod.Info, "status"> {
  readonly status: "enabled"
  readonly clientSecret: Redacted.Redacted<string>
}

/** Installation-wide configuration, independent of the caller's Workspace. */
export interface Interface {
  /** Initialize the durable token and report it only while initial Setup is pending. */
  readonly init: () => Effect.Effect<void, LoginMethod.UnavailableError>
  /** All methods, including disabled methods, in stable ID order. */
  readonly list: () => Effect.Effect<ReadonlyArray<LoginMethod.Info>, LoginMethod.UnavailableError>
  /** One method's secret-free configuration. */
  readonly get: (
    id: LoginMethod.ID,
  ) => Effect.Effect<LoginMethod.Info, LoginMethod.MissingError | LoginMethod.UnavailableError>
  /** Create one independently identified method after discovery admission. */
  readonly create: (
    input: LoginMethod.Create,
  ) => Effect.Effect<
    LoginMethod.Info,
    LoginMethod.ConflictError | LoginMethod.DiscoveryError | LoginMethod.UnavailableError
  >
  /** Compare-and-set one method's editable fields and increment its revision. */
  readonly update: (
    input: LoginMethod.Update,
  ) => Effect.Effect<
    LoginMethod.Info,
    LoginMethod.MissingError | LoginMethod.ConflictError | LoginMethod.DiscoveryError | LoginMethod.UnavailableError
  >
  /** Resolve current enabled configuration, optionally requiring an exact revision. */
  readonly resolve: (input: {
    readonly id: LoginMethod.ID
    readonly revision?: LoginMethod.Revision
  }) => Effect.Effect<
    Active,
    LoginMethod.MissingError | LoginMethod.DisabledError | LoginMethod.ConflictError | LoginMethod.UnavailableError
  >
  /** Verify recovery proof and expose secret-free configuration for a recovery form. */
  readonly inspect: (
    token: Redacted.Redacted<string>,
  ) => Effect.Effect<ReadonlyArray<LoginMethod.Info>, LoginMethod.TokenError | LoginMethod.UnavailableError>
  /** Verify recovery proof, then apply the selected create/update operation. */
  readonly setup: (
    input: LoginMethod.Setup,
  ) => Effect.Effect<
    LoginMethod.Info,
    | LoginMethod.TokenError
    | LoginMethod.MissingError
    | LoginMethod.ConflictError
    | LoginMethod.DiscoveryError
    | LoginMethod.UnavailableError
  >
}

/** Process-global configuration authority. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/LoginMethod") {}

/** Public composition contract; private ports/adapters are supplied inside this Layer. */
export declare const layer: Layer.Layer<Service, never, Database.Service | HttpClient.HttpClient | Crypto.Crypto>
```

The HTTP edge uses `requireAdmin` before admin operations. Core never discovers a
request Actor. `resolve` has no HTTP endpoint: `Redacted` is not permission to
serialize a secret. Auth uses secret-free `get` for final admission.

Updates to a disabled state must work while the IdP is unavailable. Discovery is
required on create, re-enable, and secret replacement for an enabled method;
ordinary label/domain edits reuse the admitted issuer contract. Saving proves
discovery compatibility, not that the IdP will accept the secret or assigned user.

Every successful update advances revision, including disabling. Reads used to
select or finish login come from Postgres, not an eventually consistent method
cache. Discovery/JWKS/client caches are bounded, keyed by method ID and revision,
and contain no secrets in their keys.

### 2.3 Auth assertion and browser adapter

Proposed additions/replacement in `packages/schema/src/auth.ts` reuse the existing
`Subject` and `Email` schemas. The explicit local branch belongs exclusively to
the host-selected Local Login adapter; it is never accepted from an HTTP payload.

```ts
import { LoginMethod } from "./login-method.js"

/** Verified evidence, bound to the selected method generation or explicit Local Login. */
export const Assertion = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("oidc"),
    method: LoginMethod.Ref,
    subject: Subject,
    verifiedEmail: Email,
  }),
  Schema.Struct({
    type: Schema.Literal("local"),
    subject: Subject,
    verifiedEmail: Email,
  }),
])
/** Evidence accepted by Auth, never a public request body. */
export type Assertion = typeof Assertion.Type
```

The corresponding replacements/additions in `packages/core/src/auth.ts` reuse
the existing `ProvisionError`:

```ts
import { AccountActor } from "@bymorning/schema/actor"
import { Auth } from "@bymorning/schema/auth"

/** The selected evidence cannot admit an available Account. */
export class RejectedError extends Schema.TaggedError<RejectedError>()("Auth.RejectedError", {
  reason: Schema.Literals([
    "email-domain",
    "method-missing",
    "method-disabled",
    "method-changed",
    "local-disabled",
    "account-unavailable",
  ]),
  message: Schema.String,
}) {}

/** Ordinary database/configuration failure during account resolution. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Auth.UnavailableError", {
  operation: Schema.Literal("resolve"),
  message: Schema.String,
}) {}

/** Final login admission and exact identity-to-account resolution. */
export interface Interface {
  readonly resolve: (
    assertion: Auth.Assertion,
  ) => Effect.Effect<AccountActor, RejectedError | ProvisionError | UnavailableError>
}
```

Auth performs final method/revision/status and domain admission inside its account
transaction. `LoginMethod.get` takes a shared row lock in that transaction, while
updates take the conflicting write lock. This gives a defined ordering between
login admission and disable/edit without holding a database transaction over IdP
network calls. Login already admitted before an edit can finish creating its cookie.

Auth looks up only `(method ID, subject)` for OIDC identities. A new subject with
the same email creates a separate Account; it never receives an existing Account
through an email link. Existing invitation claiming and membership rules still
apply. Local identity linking remains separately namespaced. The existing
`Auth.ConflictError` caused by provider/email disagreement is retired from this
refactored path.

Persist the latest asserted email as a non-unique Account attribute, updated by
Auth in that same transaction. Account profile, member listing, invitation lookup,
and usage attribution read this attribute rather than synthetic `provider=email`
identity rows. The existing consumers are `account.ts`, `user.ts`, and `usage.ts`;
their response shapes remain the same. This permits two separate Accounts to
display the same email without a uniqueness conflict or an implicit merge.

Proposed changed browser contracts in `packages/server/src/web-provider.ts`:

```ts
import { LoginMethod } from "@bymorning/schema/login-method"

/** Explicit host-supported login selection. */
export type Selection = { readonly type: "oidc"; readonly id: LoginMethod.ID } | { readonly type: "local" }

/** Selected identity authority captured at login start. */
export type Binding = { readonly type: "oidc"; readonly method: LoginMethod.Ref } | { readonly type: "local" }

/** Server-generated attempt data held in the encrypted cookie. */
export interface Attempt {
  readonly binding: Binding
  readonly state: Redacted.Redacted<string>
  readonly verifier: Redacted.Redacted<string>
  readonly redirectURI: URL
}

/** Redirect and the exact attempt that must complete it. */
export interface StartResult {
  readonly redirect: URL
  readonly attempt: Attempt
}

/** OIDC protocol authority, or explicit host-selected Local Login. */
export interface Interface {
  readonly start: (input: {
    readonly selection: Selection
    readonly redirectURI: URL
  }) => Effect.Effect<StartResult, ProviderError>
  readonly complete: (input: {
    readonly attempt: Attempt
    readonly response: Redacted.Redacted<URLSearchParams>
  }) => Effect.Effect<Auth.Assertion, ProviderError>
}
```

`ProviderError` retains its current tagged class and safe optional OAuth error
code; its `reason` adds `method-missing | method-disabled | method-changed |
configuration | callback` to `discovery | authorization | exchange | token |
claims | userinfo`. `operation` remains `start | complete`. All underlying
LoginMethod failures map into these reasons.

The adapter validates the actual authorization response, including expected state
and the response issuer when advertised. Remove the current single-issuer
`skipStateCheck`/issuer-check override. Each OIDC method uses
`${APP_ORIGIN}/auth/callback/${id}`; the handler compares that path ID with the
encrypted binding and reconstructs the callback from trusted `APP_ORIGIN`.
Code, state, `iss`, and OAuth error response fields reach protocol validation.
The cookie's path matches that method callback; encrypted attempts remain bounded
to ten minutes. PKCE, nonce, issuer, audience, signature, and expiry checks remain
mandatory. Attempts from two methods in the same browser need method-specific
cookie names as well as paths so they cannot shadow each other.

The Local Login adapter adopts these explicit contracts and retains its separate
`/auth/callback` route. Production exposes only OIDC selection. `Auth` receives
local admission settings only from an explicitly local host binding.

## 3. HTTP contracts and call graphs

Transport schemas belong in `packages/protocol/src/groups/login-method.ts` and
the existing auth group. New methods generate `client.loginMethod.list/get/create/update`
and `client.auth.method/inspect/setup` rather than handwritten SDK request types.

| Endpoint                                  | Authorization                              | Parsed input                                 | Success                                                                                                                               |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/method`                        | Public                                     | None                                         | `{ state: "setup", callbackBase: string }` or `{ state: "ready", callbackBase: string, methods: Array<{ id, displayName, preset }> }` |
| `POST /auth/inspect`                      | Setup/recovery token; same-origin request  | `{ token }`                                  | Secret-free `LoginMethod.Info[]`, including disabled methods                                                                          |
| `POST /auth/setup`                        | Setup/recovery token; same-origin mutation | `LoginMethod.Setup`                          | `LoginMethod.Info` (200)                                                                                                              |
| `GET /auth/login?method=<id>&redirect=/…` | Public                                     | Method ID and validated relative return path | 302 to that IdP                                                                                                                       |
| `GET /auth/callback/:methodID`            | Encrypted attempt + protocol validation    | Method ID and callback query                 | 303 to return path, or `/login?auth=failed`                                                                                           |
| `GET /api/login-method`                   | Existing Workspace admin                   | Standard Workspace query                     | `LoginMethod.Info[]`                                                                                                                  |
| `GET /api/login-method/:methodID`         | Existing Workspace admin                   | ID and Workspace query                       | `LoginMethod.Info`                                                                                                                    |
| `POST /api/login-method`                  | Existing Workspace admin + origin check    | `LoginMethod.Create` and Workspace query     | `LoginMethod.Info` (201)                                                                                                              |
| `PUT /api/login-method/:methodID`         | Existing Workspace admin + origin check    | `Update` without body ID; ID comes from path | `LoginMethod.Info`                                                                                                                    |

Admin and public projections never expose secrets. Public output also omits
issuer, client ID, domains, disabled methods, and revisions. `callbackBase` is the
trusted `${APP_ORIGIN}/auth/callback/`; the form appends its generated ID before
the IdP client is registered. All these responses use `Cache-Control: no-store`.

`setup` is a never-configured installation, not “no enabled methods.” When all
methods are disabled, state is `ready` with an empty list and a recovery action.
The token remains valid for targeted recovery after first setup. The recovery UI
first calls `auth.inspect` with the token in the request body, obtains the current
IDs/revisions and editable metadata, then calls `auth.setup` to update only the
selected method or add a new one. Every request independently verifies the token;
it is never placed in a URL or persisted in browser storage. Ordinary admins use
the admin routes.

Error projection: `InvalidError` → 400; `MissingError` → 404; `ConflictError` →
409; `DiscoveryError` → 422; `TokenError` and existing `ForbiddenError` → 403;
`UnavailableError` → existing `ServiceUnavailableError` (503). Existing missing
session errors remain 401. Callback failures always clear the applicable attempt
cookie and use the generic failure redirect; diagnostic reasons stay in safe
structured logs. Login-start failures map to the existing 503 behavior.

### Primary call path

```text
SecurityRoute → generated client.loginMethod.create
  → LoginMethodHandler                                  server/handlers/login-method.ts
    → requireAdmin + input/origin parsing               server/middleware/admin.ts
    → LoginMethod.create                               core/login-method.ts
      → private discovery admission                    core/login-method/discovery.ts
      → private transactional insert                   core/login-method/store.ts
    ← secret-free Info, revision 1

LoginRoute → generated client.auth.method → enabled button inventory
  → GET /auth/login?method=<id>
    → WebProvider.start                                server/web-provider.ts
      → LoginMethod.resolve({ id })
      → discovered authorization URL + PKCE
    ← encrypted method/revision attempt + 302

GET /auth/callback/<id>                                 server/handlers/auth.ts
  → WebCookie.decrypt + path/binding/expiry comparison
  → WebProvider.complete
    → LoginMethod.resolve({ id, revision })
    → code exchange + signed ID token + optional userinfo
    ← Auth.Assertion { type: "oidc", method, subject, verifiedEmail }
  → Auth.resolve                                       core/auth.ts
    → LoginMethod.get inside account transaction → final admission
    → exact Identity lookup → Account / invitation / provisioning
    ← AccountActor
  → WebCookie.encrypt account cookie → 303
```

### Failure traces

```text
Admin changes method at revision 1 → update returns revision 2
Callback presents encrypted revision 1
  → LoginMethod.resolve → ConflictError { reason: "revision" }
  → ProviderError { operation: "complete", reason: "method-changed" }
  → expire attempt; 303 /login?auth=failed; no Account resolution

Member submits POST /api/login-method
  → requireAdmin → ForbiddenError → 403; no Core operation

Admin saves unreachable issuer
  → LoginMethod.create → DiscoveryError { reason: "unreachable" }
  → 422; no persisted method; editable form remains visible
```

## 4. Authority, private internals, and composition

| Owner       | Authority                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| LoginMethod | Configuration identity/revisions, enabled state, discovery admission, secret containment, setup/recovery proof. |
| WebProvider | Selected OIDC exchange and evidence verification.                                                               |
| Auth        | Final domain admission, Identity → Account decision, account provisioning.                                      |
| HTTP edge   | Session authentication, admin authorization, callback path/cookie binding, redirects.                           |
| UI          | Preset guidance, forms, selection, displaying safe errors.                                                      |

The proposed Core private files are `login-method/store.ts` (database adapter and
locks), `login-method/discovery.ts` (OIDC metadata adapter), and
`login-method/token.ts` (token generation/proof). Their application-owned ports
remain private and are composed by the public Layer. Database/HTTP/Crypto errors
are translated before crossing the LoginMethod boundary. Discovery completes
before opening a write transaction. Mutations use a unique ID and expected
revision; SDK mutations do not automatically retry. On an uncertain save outcome,
the UI reads that same ID and reconciles instead of submitting a fresh create.

Deletion test: removing LoginMethod would spread token lifecycle, discovery
admission, revision consistency, disabled checks, and secret-safe projections
across startup, handlers, Auth, and the OIDC adapter. The seam centralizes real
invariants. Credential's Workspace/Integration scope and Auth's account decision
are different reasons to change.

```text
LoginMethod.layer
  ├─ Database.Service       shared Postgres instance
  ├─ HttpClient.HttpClient  discovery via host-selected transport
  └─ Crypto.Crypto          setup token and constant-time proof adapter

WebProvider.dynamic
  ├─ LoginMethod.Service
  └─ HttpClient.HttpClient  oauth4webapi custom-fetch transport bridge

Auth.layer
  ├─ LoginMethod.Service
  ├─ Database.Service       same transaction context as LoginMethod
  └─ Storage.Service        existing provisioning dependency

Auth/admin handler Layers
  ├─ Auth.Service + LoginMethod.Service + WebProvider.Service
  └─ WebCookie.Service + existing Account/Workspace middleware
```

`Application.process` binds these process-global nodes once, with Database,
HttpClient, and NodeCrypto selected by the host. The LoginMethod public `layer`
internally composes its private adapters; `WebProvider.dynamic` requires
`LoginMethod.Service | HttpClient.HttpClient`; the revised Auth Layer requires
`LoginMethod.Service | Database.Service | Storage.Service`. Explicit initialization
runs after migrations and before serving HTTP. Its typed failure stops startup.
Core never imports Server and neither Core domain imports another's private files.

Client secrets follow the existing approved spec's database storage model:
plaintext fields protected by deployment database encryption at rest. `Redacted`
protects application handling, not database encryption. Only the setup token's
pending-boot message intentionally reveals a credential. Generic request logging,
errors, query logging, and responses must not include submitted secrets or tokens.

## 5. Minimum happy path and UI

The following values are proposed examples, not real provider credentials:

```json
{
  "id": "lgm_000000000001AAAAAAAAAAAAAA",
  "preset": "google",
  "displayName": "Google Workspace",
  "issuer": "https://accounts.google.com",
  "clientID": "example.apps.googleusercontent.com",
  "clientSecret": "example-secret",
  "domains": ["example.com"]
}
```

The form generates the ID once when opened, showing
`https://app.example.com/auth/callback/lgm_000000000001AAAAAAAAAAAAAA` before save.
`clientSecret` is decoded to `Redacted` at the boundary. After successful discovery
and persistence, `create` returns this complete wire output and **no error**:

```json
{
  "id": "lgm_000000000001AAAAAAAAAAAAAA",
  "revision": 1,
  "preset": "google",
  "displayName": "Google Workspace",
  "issuer": "https://accounts.google.com",
  "clientID": "example.apps.googleusercontent.com",
  "domains": ["example.com"],
  "status": "enabled"
}
```

Initial setup wraps the same creation input in `{ type: "create", token, value }`.
The subsequent login inventory contains one button. An Okta method adds a second
independent button; another Okta organization adds a third independent method.
Identical email domains are allowed across methods; selection is explicit.

The form's preset defaults are Google Workspace/Google issuer, Microsoft Entra/
tenant-derived v2 issuer, Okta/org-derived issuer, and vendor-specific guidance for
the other presets. Client ID, secret, and domains have no hidden defaults. Updates
submit the displayed revision; conflict responses refetch and ask the admin to
reconcile the edit. No client secret is prefilled or returned after save.

The UI uses the existing selected Workspace admin gate, with explicit copy that
these settings apply to the entire installation. The form is shared by Setup,
recovery, and Settings. A successful Setup response shows a sign-in action. A
disabled method remains editable in Settings. All-disabled login offers recovery;
it never silently selects another identity authority. Local Login remains an
explicit host mode, not a public OIDC method or production request option.

## 6. File layout and rollout

```text
CONTEXT.md                                         change  confirmed multi-method glossary
packages/schema/src/login-method.ts                add     shared configuration values/errors
packages/schema/src/auth.ts                        change  method-bound evidence
packages/core/src/login-method.ts                  add     public Effect contract and Layer
packages/core/src/login-method/{store,discovery,token}.ts
                                                  add     private adapters and invariants
packages/core/src/database/schema/login-method.sql.ts
                                                  add     method rows and setup singleton
packages/core/src/database/schema/auth.sql.ts       change  method/subject identity linkage
packages/core/src/database/schema/account.sql.ts    change  non-unique asserted email attribute
packages/core/src/database/migration/*             add     generated forward migration
packages/core/src/auth.ts                          change  selected-method admission and linking
packages/core/src/auth/provision.ts                change  exact-identity provisioning
packages/core/src/{account,user,usage}.ts           change  read email as an Account attribute
packages/protocol/src/groups/{auth,login-method}.ts change/add public/admin HTTP schemas
packages/client/src/{promise,effect}/**             generate SDK contracts
packages/server/src/handlers/{auth,login-method}.ts change/add transport and admin authorization
packages/server/src/{web-provider,web-cookie}.ts    change  explicit method-bound attempts
packages/server/src/application.ts                 change  shared process composition
packages/server/src/application/adapters/identity-local.ts
                                                  change  explicit local branch
packages/web/src/login/*                           change  method inventory and setup/recovery
packages/web/src/settings/security/*               add     admin inventory and shared form
packages/web/src/{shell,project/sidebar}/**         change  route/navigation registration
app/aws/src/index.ts                               change  persisted method selection
app/local/src/{index,settings}.ts                  change  explicit local/dynamic selection
infra/server.ts                                    change  retire static AUTH_* settings
docs/terraform-production/**                       change  persisted-auth deployment guidance
docs/guides/identity-provider-setup.md               change  UI-based registration instructions
```

The installed database must preserve existing Accounts and identity links. Before
finalizing migration for an existing installation, inventory its historical
`Auth.Provider` labels and confirm the issuer/client registration behind each.
An explicitly matched legacy `(provider, subject)` can be rekeyed to `(method ID,
subject)` while retaining Account IDs. Do not infer that mapping from a preset or
email; ambiguous historical rows require an operator decision. Backfill Account
email using the same latest-link ordering currently used by `Account.get`, then
stop using legacy email links for both login and display. Retain historical rows
until the explicit migration establishes that no supported reader depends on them.

The current `AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_PROVIDER`,
and `AUTH_EMAIL_DOMAINS` settings are retired after explicit import/cutover for
existing installations. Fresh installations need none of them. Keep `APP_ORIGIN`
and `WEB_COOKIE_KEY` as host settings. The new callback URLs must be registered
with the IdPs before cutover. Outstanding legacy attempts may expire and restart.

## 7. Verification strategy

Use the real Application harness, generated SDK, Postgres, and local OIDC fixture.
Expose the fixture from a neutral test-only location consumable without introducing
a Core → Server dependency; preserve its actual discovery/token/JWKS exchanges.
The configured HTTP adapter bridges fixture loopback transport in tests while
public production issuer input remains HTTPS-only.

Required behavioral scenarios:

1. Blank installation exposes Setup; bad token cannot read recovery configuration
   or mutate; correct token configures the first method; restart retains
   configuration and recovery proof. The fixture captures the actual pending-boot
   token through its scoped log sink, not a fabricated authentication response.
2. Existing admin adds/edits methods through generated SDK; a member receives 403
   even when directly calling the endpoint. Public/admin outputs contain no secrets.
3. Two separate issuers with the same preset, subject, and email resolve to distinct
   Accounts; repeat login through either returns its own Account. An invitation
   remains governed by existing membership rules.
4. Each method's domain list applies only to that method. Google-style post auth,
   Okta-style basic auth, and Entra-style path issuer/email fallback are exercised.
5. Swap callback paths, state, codes, response issuers, or attempt cookies between
   methods: no Account cookie is created. Preserve signature/audience/nonce/expiry
   and userinfo-subject tests from the existing adapter.
6. Disable/edit while an attempt is pending: stale attempt fails. Serialize a
   concurrent Auth admission and update to verify the documented transaction order.
   Disabled methods are absent from the next public inventory on another process.
7. Rotate a secret, edit with an old revision, save with an uncertain response,
   and disable while discovery is down: observe the specified outcomes.
8. Browser flow: Setup → sign in → Security → add second method → logout → second
   button → sign in. Use existing fixtures and real SDK; verify independent cookies
   for parallel attempts through different methods.
9. Existing-database migration, once its mapping is confirmed, preserves known
   Account IDs and refuses ambiguous identity reassignment.

Implementation checks: formatting; affected Schema/Core/Server/Testing/Web/AWS
package typechecks and tests; Protocol/SDK generation and generated-output checks;
application browser tests and screenshot. These are proposed checks, not results.

## 8. Approval boundary

Confirmed: multiple active methods per installation, explicit user selection,
per-method domains, admin-managed UI, and existing no-email-merge identity rule.

Proposed for interface approval: the contracts above, immutable issuer/client ID,
revision-bound edits and attempts, disabled-state management, per-method callback
URLs, and token-authorized targeted recovery. Existing-installation migration also
requires the historical configuration mapping before an executable cutover can be
specified.
