# Bedrock execution and gateway translation

Status: domain and declarative interface approved; implemented with application verification.

## Implemented verification

- All 123 pinned Bedrock language candidates receive executable bindings. The
  pinned source's native package override selects Mantle; no runtime Model list
  or regional approval manifest remains.
- `packages/testing/test/bedrock-gateway.test.ts` exercises both transports and
  four ingress formats through the real Application, generated SDK setup, and
  external binary/SSE fixtures. It covers full and streaming replies, returned
  Tool calls in actual follow-up requests, persisted usage, HTTP failures,
  truncated/exception streams, cancellation, and saved credential precedence.
- `packages/core/test/bedrock-chain.test.ts` runs Integration and ModelResolver
  in an isolated child. A local ECS endpoint rotates credentials between
  signatures, proving automatic selection and refresh for both native packages.
- Translation is intentionally strict. Unknown request fields, stored-response
  references, strict/server-side tools, and unrepresentable generation controls
  are refused. Opaque signed/encrypted reasoning produces a translation failure
  rather than silently dropping continuation state.
- Mantle IAM authorization uses `bedrock-mantle:CreateInference`, as documented
  in the [AWS Responses API prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html#bedrock-mantle-prereq).

## Outcome

Sessions and the LLM Gateway can invoke every catalogued Bedrock language model
whose transport is supported, without an individual model or region approval
manifest. The gateway accepts its existing OpenAI Chat, OpenAI Responses,
Anthropic Messages, and Google Generate formats and returns the caller's format.
Converse and Mantle execution use the installed `@opencode-ai/ai` package. AWS
credentials are selected by Integration and resolved when a request needs them.

The user approved reuse of that package's existing AWS dependencies after an
isolated local check verified Converse/Mantle request lowering, ECS credential
resolution, and changed credentials on successive signatures.

## Investigation evidence (before implementation)

- `packages/core/src/model/direct.ts` restricts Bedrock execution bindings to
  `bedrockRuntimeCandidates`, while projecting the entire generated catalog.
- `packages/core/src/catalog.ts` independently gates execution on
  `bedrockRuntimeManifest` and its region list.
- `packages/core/src/model-resolver.ts` uses Converse directly with `Auth.none`
  and the separate `provider/bedrock-auth.ts` middleware.
- `packages/core/src/llm-gateway/catalog.ts` drops `bedrock-converse` entries.
- `ModelResolver.native` rejects regional execution; Gateway currently calls
  it for every request.
- Installed `@opencode-ai/ai@0.0.0-beta-19192` exports Converse and Mantle
  providers, canonical `LLMRequest`/`LLMEvent` types, an Effect LLM client,
  and `BedrockAuth.defaultChain`/`sigV4`. The installed auth implementation
  resolves the AWS chain per request. The inspected `../opencode` checkout
  differs and does not contain that native-package credential-chain addition.
- That package provides outbound request lowering and inbound provider event
  parsing. Gateway caller-request decoding and caller-response encoding remain
  ByMorning responsibilities.
- `../opencode/packages/core/src/catalog.ts` projects `model.package ??
  provider.package` and merges Provider/Model settings. Its ModelResolver loads
  that package and calls `module.model(modelID, settings)`. This declarative
  selection is the reference for execution binding, not an environment switch.
- `LayerNode.replace` supplies an existing transport substitution boundary for
  application tests; tests do not need to reconstruct the workspace graph.

## Public interfaces

### Declarative execution

Provider definitions declare a native `package` and non-secret `settings`;
Models inherit them and may override the package or settings. These are Catalog
execution facts. ModelResolver uses the selected package's existing
`model(modelID, settings)` contract instead of selecting a transport through
Bedrock-specific imperative branches.

Representative declaration data (the bundled execution binding, not a claim
that the current ByMorning Config schema already accepts provider authoring):

```jsonc
{
  "package": "@opencode-ai/ai/providers/amazon-bedrock",
  "settings": {},
  "models": {
    "amazon.nova-pro-v1:0": {},
    "openai.gpt-oss-120b": {
      "package": "@opencode-ai/ai/providers/amazon-bedrock/mantle"
    }
  }
}
```

The model map above only illustrates inheritance. The implementation projects
all compatible generated models; it does not replace the manifest with this
example's two entries. Source transport classification supplies the package
override for Mantle models. The initial declarations live in the bundled
Provider/Model definitions; generic user-authored Provider configuration is
the separate pending Catalog authoring design.

The Bedrock package's default authentication is the AWS credential chain when
no selected saved or environment credential overrides it. Declaring the native
Bedrock provider is sufficient to make that source eligible. No new environment
variable or deployment-auth activation flag is required. Optional package
settings are non-secret execution metadata. The current Integration deployment
projection selects `AWS_REGION`, then `AWS_DEFAULT_REGION`, then `us-east-1`.
The installed default chain handles AWS profile selection and credential refresh.

### Connection

Add this alternative to `Connection.Info` in
`packages/schema/src/connection.ts`. No credential material is persisted in it.

```ts
import { Schema } from "effect"
import { AwsRegion } from "./aws-region.js"

/** Deployment authentication available to the Bedrock Integration. */
export const Deployment = Schema.Struct({
  type: Schema.Literal("regional-deployment"),
  authKind: Schema.Literal("sigv4"),
  region: AwsRegion,
}).annotate({ identifier: "Connection.Deployment" })

/** Secret-free deployment authentication projection. */
export interface Deployment extends Schema.Schema.Type<typeof Deployment> {}
```

`Integration.connection.active(id)` and `resolve(connection)` keep their
signatures. `resolve` accepts the expanded `Connection.Info` and yields an
existing `Credential.AwsSigV4` value or `Integration.AuthorizationError`.
Deployment credentials remain transient. Saved member, permitted workspace,
and complete environment connections retain precedence over deployment auth.
A failed selected connection never switches to another source.

The native Bedrock declaration enables deployment authentication automatically
when no higher-precedence connection is selected. The existing `AWS_REGION`
already supplied by the AWS host remains sufficient; neither an activation
variable nor explicit access-key variables are required. Region parsing accepts
commercial AWS region syntax instead of a two-region enum; AWS decides actual
service availability. This uses the existing commercial-partition endpoint
strategy. Discovery reports a configured source, not proof of AWS entitlement;
credential resolution failures are reported when execution requests that source.

### Catalog

Extend the existing execution value in `packages/core/src/catalog.ts`:

```ts
import type { AwsRegion } from "@bymorning/schema/aws-region"
import type { Connection } from "@bymorning/schema/connection"
import type { Model } from "./model.js"

/** The selected source, without credential values. */
export type BedrockConnection =
  | {
      readonly type: "credential"
      readonly id: Extract<Connection.Info, { type: "regional-credential" }>["id"]
      readonly authKind: "bearer" | "sigv4"
    }
  | { readonly type: "env"; readonly authKind: "bearer" | "sigv4" }
  | { readonly type: "deployment"; readonly authKind: "sigv4" }

/** One selected execution, shared by Session and Gateway. */
export interface Execution {
  readonly selection: Model.Selection
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
  readonly routing:
    | { readonly type: "fixed" }
    | {
        readonly type: "aws-bedrock"
        readonly region: AwsRegion
        readonly connection: BedrockConnection
      }
}
```

`Catalog.model.requireExecution(ref)` retains its existing result/error
signature. The package and merged settings come from Provider/Model declarations.
Generated source classification supplies package overrides, not model-ID
heuristics or a replacement model allowlist. Model and Provider enabled state,
language compatibility, and Connection selection remain authoritative.

### ModelResolver

Add one operation in `packages/core/src/model-resolver.ts`:

```ts
import type { Effect } from "effect"
import type { Catalog } from "./catalog.js"

/** Prepare the already-selected execution for a physical model request. */
export interface PrepareInput {
  readonly execution: Catalog.Execution
  readonly baseURL?: string
  readonly headers: Readonly<Record<string, string>>
}

/** Existing interface plus preparation from an immutable execution. */
export interface Interface {
  readonly resolve: (input: ResolveInput) => Effect.Effect<Resolved, ResolutionError>
  readonly prepare: (input: PrepareInput) => Effect.Effect<Resolved, ResolutionError>
  readonly native: (execution: Catalog.Execution) => Effect.Effect<Native, ResolutionError>
}
```

`ResolveInput`, `Resolved`, `ResolutionError`, `Native`, and the existing
`ModelResolver.Service` tag retain their definitions. Session resolution selects
an execution and prepares it; Gateway prepares the execution it already selected.
The result contains the existing runtime model, selection, and final-request
authentication middleware. Preparation never invokes inference.

The resolver loads the declared built-in package and invokes its
`model(selection.info.apiID, settings)` entrypoint. The provider package
constructs Converse/Mantle routes. The final-dispatch
authentication boundary uses its auth implementation after request middleware,
checks the selected connection and canonical destination, and signs the exact
outgoing body. Origin-changing Session hooks must not receive AWS credentials.

### LLMGateway

The supported protocols and public operations remain:

```ts
import type { Effect, Scope } from "effect"

export interface Interface {
  readonly list: (input: ListInput) => Effect.Effect<Reply, never, Scope.Scope>
  readonly invoke: (input: InvokeInput) => Effect.Effect<Reply, never, Scope.Scope>
}
```

`ListInput`, `InvokeInput`, `Reply`, and `LLMGateway.Service` remain the existing
types. The changed contract is discovery/invocation compatibility: Bedrock
executions are offered through all four ingress formats. Existing public model
IDs are retained. Cross-provider ID collision policy is not changed by translation.

## Inputs, outputs, and typed failures

| Boundary | Success | Failure |
| --- | --- | --- |
| Connection resolution | Existing transient credential value | `Integration.AuthorizationError` on deployment credential failure; existing storage errors at their current boundaries |
| Catalog selection | `Catalog.Execution` with explicit transport and source | `Catalog.ModelUnavailableError` for disabled, missing, disconnected, or unsupported execution |
| Model preparation | `ModelResolver.Resolved` | Existing `ModelResolver.ResolutionError` reason union |
| Caller decoding | Canonical package request data | `LLMGateway.InputError` for malformed or unrepresentable fields; render HTTP 400 in the caller format |
| Admission | One selected and reserved invocation | Existing `DeniedError` (403/429) and `UnavailableError` (503) |
| Provider exchange | Canonical events, then caller-native JSON or stream | Package `AIError` and provider-error events mapped to safe caller-native failures; AWS auth, throttling, unavailable model, and validation remain distinguishable |
| Committed stream | Caller-native terminal event and observed usage | Caller-native error event when representable, otherwise `StreamError`; never append a success terminator after failure |

Private gateway error values may carry a safe upstream status and retry delay
for rendering. Raw credentials, signed headers, and arbitrary provider bodies
are not returned as error diagnostics.

Caller decoding covers messages/system instructions, text/media blocks, tool
definitions, tool choice, assistant calls, tool results, generation options,
and streaming options. Provider-specific or stateful features that cannot be
represented are rejected explicitly. Tools are returned to the external caller,
not executed by the gateway. Full replies and streams preserve public model IDs,
call IDs, finish reasons, and usage conventions for the caller's format.

## Minimum successful exchange

With the native Bedrock provider declared, AWS credentials available through the
normal chain, model enabled, and an authorized ingress Key:

```http
POST /inference/openai/v1/chat/completions
Authorization: Bearer <ByMorning Key>
Content-Type: application/json

{"model":"amazon.nova-pro-v1:0","messages":[{"role":"user","content":"Say hello."}]}
```

`stream` defaults to false; omitted generation options use the selected model's
defaults. The selected AWS region is installation/Connection configuration, not
caller input. The fixture returns `Hello.` with three input and two output tokens.
The reply is HTTP 200, `application/json`, with an OpenAI `chat.completion`
object, the public model ID, one assistant choice containing `Hello.`, finish
reason `stop`, and usage `3/2/5`. Response ID and creation time are generated at
invocation time. No error; one upstream exchange and one accounted invocation.

## Call and dependency graphs

```text
server/handlers/llm-gateway.ts
  LLMGateway.invoke(actor, protocol, request)
    gateway adapter: parse caller envelope
    gateway catalog: resolve public ID -> Catalog.requireExecution
    gateway adapter: decode canonical request and reject unsupported features
    Limiter.consume -> Budget.reserve
    ModelResolver.prepare(execution)
      Integration: selected connection
      declared @opencode-ai/ai package: model(modelID, merged settings)
    private Exchange
      LLMClient.stream(canonical request, final authentication)
        Integration.resolve(selected connection)
          installed BedrockAuth.defaultChain when deployment auth is selected
        installed BedrockAuth.sigV4 -> RequestExecutor -> AWS
        package provider parser -> LLMEvent
      Usage.record + Limiter.charge + Budget.settle
      gateway adapter -> caller-native reply

Failure example:
  unsupported caller field -> InputError -> caller-native HTTP 400
  no provider exchange and no spend reservation

Session -> ModelResolver.resolve -> Catalog.requireExecution -> prepare
        -> existing Provider.stream -> same package routes/auth
```

Layer composition keeps `Integration`, `Catalog`, and `ModelResolver` in their
existing member/workspace lease graphs. Private Gateway Exchange composes
`LLMClient.layer` with `RequestExecutor.layer` over its supplied Effect
`HttpClient`; `LLMGateway.layer` continues to require Lease, Budget, Limiter,
HttpClient, and Crypto. No Session or fabricated member enters the gateway graph.
Request scope owns stream cancellation, upstream resources, and reservation
release. Usage seen before interruption is settled once; unobserved usage is not
fabricated. Both streaming and full replies consume one upstream event stream.

## Private internals and deletion test

- Caller codecs live under `llm-gateway/`; deleting them would push four wire
  contracts and streaming state machines into the handler or exchange.
- ModelResolver preparation owns route construction and selected auth; deleting
  it would duplicate these decisions between Session and Gateway.
- Integration deployment resolution owns credential-source precedence and
  transient resolution; deleting it would spread identity selection into callers.
- Bedrock framing, signing, and request lowering remain in the existing AI
  package; local duplicates are removed or reduced to connection/origin binding.
- The runtime manifest is deleted. Its transport facts are represented by the
  generated model classification rather than approval entries.

## File changes

```text
CONTEXT.md                                     change  confirmed domain contract
packages/schema/src/aws-region.ts              change  region syntax
packages/schema/src/connection.ts              change  deployment projection
packages/core/src/integration.ts               change  deployment selection/resolution
packages/core/src/model/direct.ts              change  all compatible declarative bindings
packages/core/src/provider/registry.ts         change  native package/default settings
packages/core/src/model/definition.ts          change  model package/settings overrides
packages/core/src/model/bedrock-runtime-manifest.ts
                                              delete  individual model/region gate
packages/core/src/catalog.ts                   change  projected package/settings execution
packages/core/src/model-resolver.ts            change  shared preparation and Mantle route
packages/core/src/provider/bedrock-auth.ts      change  bind package auth at final dispatch
packages/core/src/llm-gateway.ts                change  translated execution selection
packages/core/src/llm-gateway/catalog.ts        change  four-format Bedrock discovery
packages/core/src/llm-gateway/exchange.ts        change  canonical event exchange/accounting
packages/core/src/llm-gateway/translation/**     add     private caller codecs
packages/core/src/llm-gateway/README.md         change  current contract and boundaries
infra/server.ts                                change  invocation IAM
packages/testing/src/llm.ts                    change  real external Bedrock fixtures
packages/testing/src/application.ts            change  fixture-owned outbound transport
packages/testing/src/scenario/bedrock.ts        add     reusable public-service scenario
packages/testing/test/bedrock-gateway.test.ts   add     application behavior matrix
packages/core/test/**                          change  focused auth/catalog/codec coverage
packages/schema/test/**                        change  projection and region coverage
packages/client/**, packages/protocol/openapi.json
                                              generate expanded Connection schema
```

## Verification

1. Run meaningful focused schema, catalog, resolver, and codec tests. Assert a
   model outside the old two-entry manifest and a region outside its old pair.
2. Use real `TestApp.make`, generated SDK-created credentials and service Keys,
   and real HTTP gateway routes. Extend `TestLLM` with external Converse binary
   and Mantle SSE fixtures. Substitute only outbound network transport through
   the existing LayerNode boundary; preserve exact signed URL/body/headers for
   fixture inspection. Session's existing executor seam supplies the same
   physical transport for its parity scenario.
3. Exercise all four caller formats against Converse and Mantle, with streaming
   and full replies. Verify text and a tool-call/result follow-up using the
   actual first reply, not a separately fabricated tool conversation.
4. Verify secret-free discovery, saved-source precedence, automatic native-package
   deployment selection with no activation variable, and unchanged auth identity
   after failure. Run default-chain
   rotation against a local credential endpoint in an isolated child process
   because the dependency reads process environment.
5. Verify byte-split Unicode/events, malformed frames, midstream failures,
   cancellation, unknown model, IAM denial, throttling, unsupported fields,
   and exactly one usage record/reservation settlement per invocation.
6. Verify Session execution with a formerly blocked model, including background
   title requests. No replacement SDK, service response, or Workspace graph.
7. Run package typechecks and appropriate suites from their owning directories;
   regenerate protocol/client output and run generated-output checks for the
   expanded Connection union. Run infrastructure checks for the IAM/env change.

Tests use gates/request receipt and test-context cancellation signals. The
offline suite verifies protocol and application behavior; real AWS account
entitlements remain a deployment property.
