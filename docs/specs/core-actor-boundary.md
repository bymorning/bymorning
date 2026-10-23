# Core Actor boundary: exhaustive usage audit and migration requirements

**Status:** historical audit plus migration plan; the member-invitation slice below is implemented. Other replacement interfaces and authority changes remain unresolved.
**Snapshot:** 2026-09-09, `bm`, including the existing uncommitted worktree.
**User constraint:** “we dont want to pass whole actor in core anymore thats anti pattern. trace every usage of it and put in a spec file.” **Core must not accept a whole Actor.**

**Confirmed follow-up requirements:** the only Roles are **admin** and **member**; there is no owner Role in the target model. Authentication must populate `UserActor.role` (currently `properties.role`) so selected routes can require admin. **Route authorization belongs on the server side**, and whole Actor must not be passed into Core. The first route selected for this pattern is **member invitation (`POST /api/users`)**; additional route classifications are deferred. References to owner/admin below describe current code, not the desired role model.

## First implementation slice: member invitation

User selected member invitation as the first demonstration of server-side admin authorization and approved this replacement Core signature:

```ts
User.invite(
  workspaceID: Workspace.ID,
  input: InviteInput,
): Effect.Effect<Member, InviteError>
```

The server authenticates the request and selects its membership. Before invoking Core, the handler uses `requireAdmin` from `packages/server/src/middleware/admin.ts`, requiring a UserActor with `properties.role === "admin"`. The handler checks the existing `@bymorning.ai` invitation-domain restriction, extracts workspaceID, and forwards invitation input. Core User owns invitation and reinvitation persistence, with no caller Actor or caller Role input. InviteInput contains only `email: Auth.Email` and the target member's `role: admin | member`; it contains no email-domain admission rule.

- Route authentication errors remain HTTP 401; authenticated non-admin callers receive HTTP 403. Core InviteError retains the persistence-unavailable case; invitation-forbidden moves out of Core.
- Dependencies: the server guard reads CurrentActor; User.Service uses Database.Service. No new Core service is needed. Account and workspace authentication middleware precede the admin guard.
- Call graph: request → Account authentication → Workspace membership selection → admin route guard → handler → User.invite(workspaceID, input) → Database.
- Layer graph: Database → existing User.layer; existing authenticated server middleware layers → endpoint admin guard → User handler. Member runtime composition remains as currently supplied by workspace middleware.
- Private internals remain identity lookup and invitation/membership upsert. Deleting User's seam would spread those persistence rules into transport callers; a separate Core authorization service adds no value for this slice.
- Verify through the application harness: admin invitation and reinvitation succeed; member gets 403 without mutation; unauthenticated request gets 401; a requested workspace without membership is rejected. Verify owner-to-admin data migration and initial-admin provisioning as part of the two-role prerequisite.
- Trade-off: Core invitation is an authorized-caller capability; every entrypoint must perform admission before invoking it. Other Actor migrations remain governed by this audit.

Implemented alongside the two-role schema, initial-admin provisioning, an owner-to-admin database migration, regenerated clients, and affected UI/fixture role projections. Application tests in `packages/testing/test/invitation.test.ts` cover role admission, role refresh with the same cookie, invitation persistence, workspace isolation, and server-only email admission. `packages/testing/test/member-role.test.ts` exercises the legacy data migration. User.invite no longer accepts an Actor, reducing the remaining whole-Actor-input Core operations from eleven to ten.

The inventory below records the pre-migration implementation and the work needed to meet that constraint. The member-invitation slice above was subsequently approved and implemented. Whole Actor outputs and internal construction are included because they keep Actor propagation alive even after inputs change. Whether Core must also stop producing Actors is an explicit decision below.

## 1. Scope, evidence, and vocabulary

- Read root `AGENTS.md`, `packages/core/AGENTS.md`, `packages/protocol/AGENTS.md`, and `CONTEXT.md`.
- The root guide's `references/domain-design.md` and `references/service-design.md` are absent from this checkout. Read the copies in a separate checkout as process guidance only; their product examples are not evidence about this checkout. The root guide independently requires confirmation before interface/authority changes.
- `CONTEXT.md:31-41` distinguishes authenticated **Actor** from explicit **Scope** and says the edge derives Scope. Its Actor wording also says Actor is handed explicitly to operations. Reconcile that wording with the user's constraint before implementation; do not silently redefine Actor or Scope here.
- `CONTEXT.md:27-29,47-77` defines shared inference policy, Budget, Limiter, and Usage; `CONTEXT.md:149-151` defines Role. These are requirements, not proof that every policy feature is implemented.
- Current authentication persistence differs from newer glossary/login specifications. Email linking, Login Session redesign, and Installation/Workspace terminology changes are not decided by this audit.
- All source references below are repository-relative `file:line` anchors. Ranges identify the complete operation or wiring block; comma-separated anchors identify multiple sites in that file. Line numbers describe this mutable snapshot.

### What counts

| Category | Meaning |
| --- | --- |
| Whole Actor | A schema `AccountActor`, `UserActor`, `ServiceAccountActor`, `WorkspaceActor`, `SystemActor`, `Actor.Info`, or `Actor.Caller`, including aliases, inferred results, object fields, closures, and structurally equivalent values. |
| Extracted data | IDs or other purpose-specific facts extracted from an Actor. A whole `.properties` bag is not automatically a satisfactory replacement: assess which facts the receiving operation needs. |
| `Actor.Binding` | Construction-time `{ workspaceID, accountID, userID }` for a retained member graph, with no discriminator, Role, or Key. It is not `Actor.Caller` and not request authentication. Its ambient scope/lifecycle is nevertheless a separate migration consideration. |
| Other `Principal`/`Binding` | `Usage.Principal`, `Credential.Binding`, `WorkspaceMap.Owner`, `Session.Owner`, Plugin binding, and protocol binding strings are not aliases for the Actor union. Trace their derivation and isolation semantics without conflating them. |

## 2. Complete whole-Actor Core surface and internal flow

There are **eleven public operations with whole-Actor inputs**: `Account.validate`, `Workspace.list`, `User.select`, `User.list`, `User.invite`, `OAuth.approve`, `LLMGateway.list`, `LLMGateway.invoke`, `Budget.reserve`, `Limiter.consume`, and `Limiter.charge`. Four operations return whole Actors: `Account.validate`, `Auth.resolve`, `User.select`, and `Actor.resolve`. The private Exchange adds one more whole-Actor input. Avoid counting shared input types as only one operation.

| Surface / internal site | Current input → output | Actually consumed and migration requirements |
| --- | --- | --- |
| `packages/core/src/account.ts:14,29-45` | `validate(AccountActor) → AccountActor`, `UnavailableError` | Reads only `properties.accountID`; verifies active, non-deleted Account; returns a newly constructed canonical AccountActor. Preserve durable validation and its error mapping. |
| `packages/core/src/workspace.ts:16,27-46` | `list(AccountActor) → Workspace.Info[]` | Reads only account ID; joins membership and filters active/non-deleted Workspaces and non-deleted memberships; stable creation/ID ordering. Account validation currently occurs earlier at ingress. |
| `packages/core/src/user.ts:20,27-30,50-83` | `select({ account: AccountActor, workspaceID? }) → UserActor`, `AccessError` | Reads account ID, optionally exact Workspace; verifies Account and Workspace availability and membership; selects stable oldest usable membership otherwise. Returns account ID, user ID, workspace ID, and current Role. Preserve exact-vs-default selection and error reasons. |
| `packages/core/src/user.ts:24,86-115` | `list(UserActor) → MemberList` | Reads workspace ID to list active/pending members and **Role to return `MemberList.role`**. Does not use actor account/user ID or revalidate actor Role. A workspace-ID-only replacement needs an explicit answer for that response Role. |
| `packages/core/src/user.ts:22,118-175` | `invite(UserActor, InviteInput) → Member`, `InviteError` | Rejects actor Role `member` at line 120; owner/admin proceed. Uses workspace ID in both pending and known-account upsert paths (139,153). Input target Role is distinct from caller Role. Preserve reinvitation, membership identity, and forbidden/persistence error reasons. |
| `packages/core/src/auth.ts:40-44,185` | `resolve(Assertion) → AccountActor`, `ConflictError / RejectedError / ProvisionError` | No Actor input. Produces an AccountActor after the existing identity/provisioning transaction. Downstream code immediately extracts account ID or calls User.select. Changing the output requires caller migration even though it is outside the literal input ban. |
| `packages/core/src/oauth.ts:42-46,163-204` | `approve({ requestID, workspaceID, account: AccountActor }) → redirect string`, `RequestNotFoundError / User.AccessError` | Calls `users.select` at 169; receives whole UserActor locally and persists its account/user/workspace IDs at 182-184. Membership validation belongs to current Core orchestration, not just the consent handler. Preserve pending-request recheck/transaction and exact membership binding. |
| `packages/core/src/actor.ts:3-23,27-67` | Schema reexports; `resolve(Redacted<string> \| undefined) → Caller`, `UnauthorizedError` | Token authentication authority in Core. `bm_` branch verifies Key and constructs ServiceAccountActor at 49-56; OAuth branch wraps returned authority in UserActor at 58-60. No Actor input. Reexports also expose all Actor schema types and the independent binding node. |
| `packages/core/src/llm-gateway.ts:39-58,81-98` | `list(Input { actor: Actor.Caller, protocol, request }) → Reply` | Discovery reads **only workspace ID** at 85 to acquire runtime. Model discovery does not run invocation admission. Do not accidentally add rate/spend consumption while reducing the input. |
| `packages/core/src/llm-gateway.ts:100-172` | `invoke(same Input) → Reply` | `const principal = input.actor` at 104 is a whole-Actor alias. Workspace lease at 107; forwards whole value to Limiter.consume at 120, Budget.reserve at 131, and Exchange.invoke as `principal` at 143. Public errors are rendered into native replies; lifetime includes abort signal and response stream. |
| `packages/core/src/llm-gateway/exchange.ts:20-35,48-166` | Private `invoke({ principal: Actor.Caller, ... }) → Reply` | Uses discriminator and user ID/service-account ID for `UsagePrincipal` at 92-98. Forwards the whole Actor to Limiter.charge at 112-116. `record` and streaming completion close over `input`, so identity survives beyond initial invocation. Preserve accounting, token charging, settling, stream failure/cancellation semantics. |
| `packages/core/src/budget.ts:26-34,58-138` | `reserve({ actor: Actor.Caller }) → Reservation` | Destructures `{ actor }`; uses workspace ID, discriminator, optional service-account ID. Looks up service-account policy by workspace/ID; workspace and service-account reservation keys; Actor type also labels reserve/release metrics at 119,123,134. Release closure retains Actor for the metric. Does not use Role, account ID, user ID, or key ID. |
| `packages/core/src/limiter.ts:20-29,48-56,96-150` | `consume({ actor: Caller, model })`, `charge({ actor: Caller, tokens }) → void` | Both destructure Actor and pass it to private `policy(actor)`; use discriminator, workspace ID, optional service-account ID. Config + ServiceAccount lookup supply effective implemented limits. No Role, account ID, user ID, or key ID reads. |
| `packages/core/src/usage.ts:24-25,145-277` | `sessionProviderLayer`, internal Actor construction and propagation | Aliased `User.Service` import is `UserService`. On **each physical Provider stream**, binding → new AccountActor (167) → User.select (165-169) → compare returned user ID with retained binding (172) → Limiter.consume (186), Budget.reserve (199), Limiter.charge (249-253). The stream callback closes over whole `actor`. This must migrate with Gateway admission, not after it. |

There is also one private Actor-taking policy helper, `Limiter.policy`. Counts exclude Actor-valued results and binding-based constructors.

### Fields and policy effects that must not disappear

| Fact | Current uses |
| --- | --- |
| `accountID` | Account validation, Workspace discovery, membership selection, OAuth consent persistence, member runtime/connection key, MCP binding, cookie payload. It is not the same as User ID. |
| `workspaceID` | Persistence isolation, exact membership choice, capability/lease selection, shared Budget/RateLimiter keys, service-account policy lookup, cache invalidation, filesystem scope. |
| `userID` | Durable membership identity; session ownership, credential ownership, Usage attribution, selected-member permission rules, refreshed-membership equality check. |
| `role` | Returned by User.select and OAuth.resolveAccess; User.invite authorization in Core; User.list response; Config/Agent/Permission author checks in handlers. Binding deliberately has no Role. |
| `serviceAccountID` | Automation policy and consumption attribution; separate limit bucket. Creator identity is not read or applied to inference. |
| `keyID` | Produced by Key verification and carried by ServiceAccountActor; none of Gateway/Budget/Limiter/Exchange consumes it in the audited implementation. Decide whether it is edge-only authentication evidence or needed downstream; do not retain it by habit. |
| Actor discriminator | Budget metric labels, service-account policy branches, Usage principal projection; handler user-only checks. Removing the wrapper cannot erase the person/automation distinction. |

Current inference policy is narrower than the glossary: Budget enforces configured Workspace spend plus ServiceAccount spend; Limiter checks Workspace and ServiceAccount model lists/RPM/TPM. Neither reads User Role nor User-specific overrides. Workspace limits are shared and remain applicable alongside service-account limits. This refactor must not claim it implements the glossary's fuller policy inheritance. Any policy-authority redesign is a separate approved decision.

## 3. Actor schemas and adjacent projections

| File:line | Inventory |
| --- | --- |
| `packages/schema/src/actor.ts:1,11-16` | Namespace export; AccountActor `{ type: "account", properties: { accountID } }`. |
| `packages/schema/src/actor.ts:19-24` | WorkspaceActor `{ type: "workspace", properties: { workspaceID } }`. No production construction/consumer found beyond schema/Core reexports. |
| `packages/schema/src/actor.ts:27-35` | UserActor with account/user/workspace IDs and `User.Role`. |
| `packages/schema/src/actor.ts:38-45` | ServiceAccountActor with workspace/service-account/key IDs. |
| `packages/schema/src/actor.ts:48-53` | SystemActor with workspace ID. No production construction/consumer found beyond schema/Core reexports; background inference currently acts as a refreshed User, not SystemActor. |
| `packages/schema/src/actor.ts:56-64` | `Info` union excludes AccountActor but includes Workspace/User/ServiceAccount/System; `Caller` includes only User/ServiceAccount. Reexported at `packages/core/src/actor.ts:3-11`, including inline Caller return import at 31. |
| `packages/core/src/oauth.ts:58,65-70,368-414` | `Authority` is the unwrapped `{ accountID, userID, workspaceID, role }` precursor to UserActor. `resolveAccess` joins live Account/User/Workspace and checks token expiry/deletion, rather than returning a stale token Role. Renaming Actor to Authority and passing the same entire bag would not establish operation-specific inputs. |
| `packages/core/src/service-account.ts:43-50,308-349` | Key verification returns workspace ID, full ServiceAccount.Info, key ID. Enforces active ServiceAccount/Workspace and non-revoked, non-deleted, non-expired Key; updates time-used. Actor.resolve projects this result. This is authentication data, not an Actor input. |
| `packages/schema/src/usage.ts:22` and `packages/core/src/llm-gateway/exchange.ts:92-98` | Usage.Principal is an accounting union with user ID or service-account ID, not Caller. Budget also constructs a Usage Principal for service-account spend (`budget.ts:91-95`). Preserve that distinction. |
| `packages/schema/src/user.ts` / `packages/protocol/src/groups/user.ts` | Member list Role and invitation target Role are observable API data even if Actor transport stays internal. Removing Actor must preserve or deliberately migrate these contracts. |

## 4. Ingress creation, provision, handlers, and call chains

### Authentication and member graph flow

```text
Auth callback
  handlers/auth.ts:209-217
  → Auth.resolve(assertion) → AccountActor → cookie.encrypt({ accountID, ... })

Account middleware
  middleware/auth.ts:63-76
  cookie decode/decrypt/expiry → new AccountActor → Account.validate
  → provideService(CurrentAccount, validated AccountActor)
    ├─ Workspace handler → Workspace.list(account)
    ├─ OAuth consent handler → OAuth.approve({ account, ... })
    │    → User.select → UserActor → persist account/user/workspace IDs
    └─ Workspace middleware → User.select({ account, workspaceID? })
         → UserActor → WorkspaceMap.get({ workspaceID, accountID, userID })
         → provide retained capability Layer + CurrentActor
              ├─ User handlers → User.list / User.invite(whole actor)
              ├─ Permission selectedUser → User.list(whole actor)
              └─ ID projection / handler Role checks / member-bound operations

Session-specific middleware
  middleware/auth.ts:179-249
  CurrentAccount + persisted Session/User/Account/Workspace join
  → verify same Account, live member/account/workspace
  → new UserActor with current row Role
  → WorkspaceMap.get({ ...session, accountID }) + CurrentActor

Token middleware
  middleware/auth.ts:87-104
  Authorization / x-api-key / x-goog-api-key → Actor.resolve
    ├─ ServiceAccount.key.verify → ServiceAccountActor
    └─ OAuth.resolveAccess → Authority → UserActor
  → provideService(CurrentActor, Caller)
  → LLMGateway handler → whole Caller → LLMGateway.list / invoke
```

The Session middleware passes a **spread database projection** to WorkspaceMap at line 248, not a whole Actor. That projection contains more fields than `WorkspaceMap.Owner`; narrowing inputs should inspect this too. Testing similarly passes `.properties` objects that carry Role even where the declared binding type does not.

### All request context declarations and consumers

| File:line | Current behavior / change impact |
| --- | --- |
| `packages/protocol/src/middleware/account-middleware.ts:1,7-15` | CurrentAccount Context service stores AccountActor; AccountMiddleware provides it. |
| `packages/protocol/src/middleware/workspace-middleware.ts:1,8,19-20` | CurrentActor Context service stores Caller; WorkspaceMiddleware provides it and requires CurrentAccount. |
| `packages/protocol/src/middleware/token-middleware.ts:3,6` | TokenMiddleware provides the same CurrentActor. |
| `packages/server/src/api.ts:11-12,25-26,36-37` | Server middleware declares CurrentActor plus WorkspaceMap.Capabilities for ordinary and Session-specific workspace paths, requires CurrentAccount. |
| `packages/server/src/middleware/auth.ts:4,14-15,25,48-108,124-162,179-254` | All Actor creation, authentication, context provision, graph derivation described above. Origin validation also precedes unsafe workspace operations. |
| `packages/server/src/handlers/auth.ts:209-217` | Consumes Auth.resolve result under alias `account`; extracts account ID into cookie. No explicit Actor import. |
| `packages/server/src/handlers/workspace.ts:2,12-14` | Passes whole CurrentAccount to Workspace.list. |
| `packages/server/src/handlers/oauth-consent.ts:3,16-21` | Passes whole CurrentAccount to OAuth.approve; maps access failure to Forbidden and missing request to not-found. |
| `packages/server/src/handlers/user.ts:3,14-17,23-31` | Requires user discriminator, then forwards whole actor to list/invite; invitation Role check is in Core, not here. |
| `packages/server/src/handlers/permission.ts:7,26-34,59-63,74-108` | `selectedUser` validates requested member by `User.Service.use(users => users.list(actor))`; called by discovery/update. `requirePermissionAuthor` checks user discriminator + owner/admin Role in handler. |
| `packages/server/src/handlers/llm-gateway.ts:7,22-35` | Both generic transport helpers forward whole CurrentActor to Gateway. Protocol-specific routes reuse these helpers, so changing only an individual native route is incomplete. |
| `packages/server/src/handlers/config.ts:5,17-29,35-40` | Checks Role when permission rules change; forwards config data, not Actor, to Core. Uses workspace ID to invalidate Gateway lease after update/reload. Not a blanket authorization check on every Config field. |
| `packages/server/src/handlers/agent.ts:4,22-23,36-42` | Handler restricts creation with nonempty permissions and changes to existing permissions to owner/admin Users. Agent Core receives payload/IDs, not Actor. |
| `packages/server/src/handlers/service-account.ts:3,14-80` | Eight consumers: listSummaries (16), create (24), get (32), update (43), remove (52), key.list (61), key.create (70), key.revoke (80). All extract workspace ID; none passes Actor or checks Role locally. Core ServiceAccount uses workspace/record IDs. |
| `packages/server/src/handlers/budget.ts:4,17-24` | Status uses `CurrentActor.use` (not `yield*`); update extracts workspace ID for lease invalidation/status. No local Role check. Budget.setWorkspace itself gets budget data, not Actor. |
| `packages/server/src/handlers/project.ts:5,49-52` | Extracts workspace ID to provide ProjectDirectory with project ID. |
| `packages/server/src/handlers/mcp.ts:14,21-22,51,155-160` | Requires user; closes over Actor to build workspace/account/user binding string for MCP transport; projects three IDs into WorkspaceMap.get. MCPGateway receives member-bound capabilities, not whole Actor. |
| `packages/server/src/handlers/form.ts:26` | Comment describes authenticated member graph; Form isolation is indirect through provided capabilities, not an Actor input. |

**Authorization placement is mixed today.** Account/membership/Key availability and OAuth approval membership checks are in Core; Session-to-account check is in server middleware; User invitation Role authorization is in Core; permanent Permission author checks are in handlers. The confirmed target moves route Role authorization to the server using the authenticated UserActor. Preserve durable identity/membership validation as distinct from route admission. The route matrix and non-HTTP caller contract must be specified before removing the current Core invite check; do not infer new admin restrictions merely from route names.

### Inference and background chains

```text
Gateway.invoke(Caller)
  → lease.acquire(workspaceID) → Catalog / ModelResolver destination
  → Limiter.consume({ actor }) → private policy(actor)
  → Budget.reserve({ actor }) → spend lookup + shared reservation ledger
  → Exchange.invoke({ principal: actor })
       → provider HTTP response / streaming completion
       → Usage.record(projected Usage.Principal)
       → Limiter.charge({ actor: principal }) → reservation.settle

Retained member graph
  → SessionExecution.sharedLayer [session/execution.ts:82-95]
       builds Usage.sessionProviderLayer with shared Budget/Limiter
       → Runner / title / compaction Provider streams
  → SessionOperations.sharedLayer [session-operations.ts:71-75,98-107]
       separately builds same decorator → one-shot generate
  → decorator [usage.ts:153-199,249-253]
       Actor.Binding → AccountActor → UserService.select → refreshed UserActor
       → exact userID check → Limiter.consume → Budget.reserve
       → physical Provider call → durable Session Usage → Limiter.charge → settle
```

Physical stream anchors include `packages/core/src/session/runner.ts:399`, `packages/core/src/session/title.ts:141`, and `packages/core/src/session/compaction.ts:235`. They need no Actor import to be affected. The durable Usage write derives workspace/user IDs from the Session row (`usage.ts:224-244`), while admission uses the freshly selected membership. Preserve their consistency, cancellation finalizers, exactly-once observation, and shared process-level ledgers. Do not replace refresh with a fabricated UserActor or a cached Role.

## 5. Complete `Actor.Binding` inventory (not whole Actor)

`packages/core/src/actor/binding.ts:9-19` defines `Value`, Context tag, and unbound workspace node. `packages/core/src/actor.ts:13,19,23` reexports Binding and aliases `node as bindingNode` as `Actor.binding`. Each row below includes all Core reads/graph dependencies, including aliases and destructuring.

| File:line | Binding use / retained facts |
| --- | --- |
| `packages/core/src/agent.ts:25,354-359` | Workspace ID → Agent layer; dependency on Actor.binding. |
| `packages/core/src/config.ts:22,391-402` | Workspace ID → both default node and configured/defaults variant; bus/database composition. |
| `packages/core/src/credential.ts:13,143-161,675-676` | **Whole Binding passed as `Effect.map(Actor.Binding.Service, layer)`**. Layer destructures only workspace/user ID for workspace/shared-member credential visibility; account ID is unused. This is not whole Actor but is an overbroad construction handoff. |
| `packages/core/src/instruction-entry.ts:15,177-178` | Workspace ID → persistence layer. |
| `packages/core/src/managed-policy.ts:12,211-212` | Workspace ID → policy/storage layer. |
| `packages/core/src/mcp-gateway.ts:16,284-285` | Workspace/user ID → member-bound gateway layer; permission/config/tool/form dependencies. |
| `packages/core/src/mcp/index.ts:9,556-560` | Workspace/account ID → MCP layer (connection/runtime identity). |
| `packages/core/src/plugin.ts:22,274-280,306` | Alias `owner`; workspace/account ID → Plugin binding. |
| `packages/core/src/plugin/runtime-facade.ts:4,50-52` | Ignores fields; dependency allocates runtime cell at member lifetime. Deleting dependency changes lifecycle/sharing even though no ID is read. |
| `packages/core/src/plugin/source.ts:14,176-186` | Alias `owner`; workspace ID → plugin source layer. |
| `packages/core/src/plugin/supervisor.ts:15,190-193` | Alias `owner`; workspace ID → private Plugin `Binding.layer`, distinct from Actor.Binding. |
| `packages/core/src/project.ts:15,186-187` | Workspace ID → project layer. |
| `packages/core/src/session.ts:22,143-145,842-855` | Alias `binding`, then `const owner: Owner = binding`; workspace ID captured; owner.userID restricts Session operations. Compatibility `layer(workspaceID, owner)` constructs Binding from IDs. |
| `packages/core/src/session.ts:193,204,226,246,269,284,306,324,357,411,475,564,750,801` | Downstream `owner.userID` creation/access/list/read/write filters. Not whole Actor, but removing binding must retain all membership isolation. |
| `packages/core/src/session/execution.ts:14,297-303` | Workspace ID → retained execution layer; shares application Budget/Limiter state through graph dependencies. |
| `packages/core/src/session/graph.ts:5,22` | Includes Actor.binding in member root; no field read. |
| `packages/core/src/session/permission.ts:13,92-93` | Workspace ID → Session permission policy layer. |
| `packages/core/src/session/tools.ts:16,123-124` | Workspace ID → tools layer. |
| `packages/core/src/skill.ts:15,220-224` | Workspace ID → skill layer. |
| `packages/core/src/state.ts:5,46-47` | Ignores fields; makes member-lifetime coordinator. Preserve lifetime rather than merely removing unused identity. |
| `packages/core/src/tool-output.ts:13,182-183` | Workspace ID → output storage/config layer. |
| `packages/core/src/tool-usage.ts:13,161-169` | Workspace ID → reporting node and recorder node. |
| `packages/core/src/usage.ts:21,153-173,679-680` | Member binding feeds fresh inference membership lookup; separate Usage node consumes workspace ID. |

### Binding producers, composition, and server/background consumers

| File:line | Current composition |
| --- | --- |
| `packages/server/src/workspace-map.ts:41-58,67-68,103-108,144-166` | Owner has workspace/account/user IDs. RuntimeKey keys retained graphs by workspace/account; `bind` rejects a changed user ID for the same key. Capabilities includes Binding.Service. No Role is part of the declared Owner or key. |
| `packages/server/src/workspace-map/graph.ts:6,154,196-225` | Member graph includes Actor.binding; production replaces its unbound node with `Layer.succeed(Actor.Binding.Service, owner)`, and supplies separate WorkspaceMap.Runtime key. |
| `packages/server/src/routes.ts:24,136-160` | Process graph composes Account/User/Auth/Workspace/OAuth and Actor.node alongside selected Gateway node. Any Actor resolver output/location change affects this composition. |
| `packages/server/src/event-feed.ts:3,52,56` | Alias `identity`; supplies sourceLayer and feed subscriptions from retained binding, not CurrentActor. Inspect member event filtering when scope is changed. |
| `packages/server/src/workspace-event-broadcaster.ts:10,89-94,107-118` | Alias `owner`; member runtime registration and credential-change invalidation consume binding. These scoped background registrations outlive requests. |
| `packages/server/src/llm-gateway-lease.ts:23,35-40,46-77` | Workspace-only Gateway lease intentionally does **not** construct a member Binding. Recipe constructs Credential/Config/Usage with workspace ID and shares Provider/Model/Database. A ServiceAccount must not be converted to an invented User to reuse WorkspaceMap. |
| `packages/core/src/llm-gateway/lease.ts:24` | Binding mentioned as construction analogy only; not Actor input. |
| `packages/testing/src/application.ts:170-175,236-247` | Test helper uses selected Actor.properties for WorkspaceMap and Binding replacement; actual value can carry extra Role though declared Binding has none. Narrowing must consider runtime objects, not only annotations. |

The user's whole-Actor input constraint does not, by itself, authorize deleting retained member runtimes. `CONTEXT.md:39-45` distinguishes explicit operation Scope from Member-owned live state. Whether binding-based stateless services should become explicit-scope operations, and which member services retain construction data, remain decisions.

## 6. Tests, fixtures, and indirect consumers

### Every direct Actor-dependent test/fixture file

| File:line | Migration impact |
| --- | --- |
| `packages/schema/test/actor.test.ts:1,12-17,23-54` | All five schema variants; Account excluded from Info; malformed Actor validation. No direct production use of WorkspaceActor/SystemActor was found. |
| `packages/core/test/actor.test.ts:1,10-35` | Core schema reexport assertions, user Role and service-account ID. These are not token-resolution behavior coverage. |
| `packages/core/test/integration/auth.test.ts:59,111,146-148,201,264,297,336-337` | Inferred `account`, `actors`, and returned `.properties.accountID` from Auth.resolve; no Actor import needed. Concurrent resolution, invitation/provisioning, and failure scenarios share output shape. |
| `packages/core/test/integration/user.test.ts:5,68-98,149-166,196,243-280` | Constructs AccountActor/UserActor; exact/default selection, membership failures, list Role, invitation/reinvitation, member refusal. |
| `packages/core/test/integration/workspace.test.ts:4,94` | Whole AccountActor passed via `(yield* Workspace.Service).list(...)`. |
| `packages/core/test/budget.test.ts:8,90,176-177,189-204,214-248` | User/service-account fixtures; reservation concurrency, shared/individual limits, release/settle and failures. |
| `packages/core/test/limiter.test.ts:3,17,117-140,154-158,171-172,183-197` | Both caller kinds; request/model/token/store behavior; whole actors passed through Service.use and direct service variable. |
| `packages/core/test/llm-gateway.test.ts:8,23,161,192,232,248,266,275,283,302,334,358,363,379` | Every list/invoke case carries Actor, including native protocols, refusal, compatibility, streaming and cancellation. |
| `packages/core/test/llm-gateway/exchange.test.ts:12,34` | Whole Caller fixture named **principal**, reused by Exchange invocation inputs and token-charge assertions. |
| `packages/core/test/usage-session-provider.test.ts:4,8,14,19,56,72,99-102,131` | Aliases `UserService`, `UserInterface`; destructured `actor: current` in Budget/Limiter fakes; asserts forwarded Actors; separate Binding fixture. |
| `packages/core/test/session-operations.test.ts:26-27,121-138` | Binding fixture plus aliased UserService stub. Stub's select returns an inferred plain `{ type: "user", properties: ... }`, not a constructor/imported Actor type. |
| `packages/server/src/handlers/llm-gateway.test.ts:3,23,188-197` | Actor fixture and fake Actor.resolve; exercises TokenMiddleware and native transport forwarding. |
| `packages/server/src/routes.test.ts:32,62-63,428-430,445-489,879-885` | Account/User/CoreAuth service fakes return Actors; invite takes `selectedActor`; OAuth authority fake returns `.properties`. Must update together or handler-only tests can mask interface mistakes. |
| `packages/server/src/routes.test.ts:474,736,764,1460,2022,2031,2044,2083` | Further actor-derived user IDs/Role in member, Session, usage and query fixtures; these are projections, not new Actor-taking APIs. |
| `packages/server/src/integration-ownership.test.ts:2,49-52` | Binding node replacement for credential isolation. |
| `packages/testing/src/application.ts:5,13,82,170-175,203-247` | Public fixture `login() → UserActor`; `workspace(User.SelectInput, effect)` calls User.select; login uses Auth.resolve then User.select; bootstrap provides Actor.properties as Binding. |
| `packages/testing/src/scenario/chat.ts:10,25-29,43,52,58` | login result named `owner`; reconstructs AccountActor then uses app.workspace for project/session setup. Shared by backend and browser behavior suites. |
| `packages/testing/src/scenario/tool-auth.ts:8,22-28,65-85,103-121` | Whole UserActor parameters in helpers; account projection, member runtimes, two-user/MCP scenarios; workspace/user projection into Credential.layer. |
| `packages/testing/test/application.test.ts:8,24-35,64-78,103-104` | Whole AccountActor for memberServices helper; login output property comparisons and isolation assertions. |
| `packages/testing/test/code-interpreter.test.ts:4,31-39,93,109,151` | Reconstructs AccountActor for workspace execution setup. |
| `packages/testing/test/form-caller.test.ts:3,17-25,32` | Reconstructs AccountActor; owner/member Form isolation. |
| `packages/testing/test/mcp-output.test.ts:2,29-36,70-71` | Reconstructs AccountActor; Tool service acquisition and MCP workspace projection. |
| `packages/testing/test/permission-scope.test.ts:1,14,27,44-86,135-151` | Whole UserActor → AccountActor helper; aliases **CoreAuth/CoreUser**; Auth.resolve/User.select for foreign membership; Actor-derived user IDs in permission policy tests. |

Indirect graph/HTTP coverage also matters even without Actor tokens: `packages/server/src/auth-postgres.test.ts` (real login, membership and OAuth routes), `packages/server/src/workspace-map.test.ts`, `packages/server/test/workspace-map.ts`, `packages/server/src/llm-gateway-lease.test.ts`, and `packages/server/src/application/recovery-postgres.test.ts` (retained graph and recovery behavior). TestApp scenarios and generated-SDK callers reach the above middleware transitively; they do not constitute additional whole-Actor interfaces.

For implementation, follow `packages/testing/src/README.md` and the root harness rules: seed through services and real generated SDK, exercise both HTTP and background inference, and retain focused unit coverage for pure policy/accounting. This documentation-only audit does not run behavior tests or claim those behaviors passed.

## 7. Confirmed two-role target and owner migration inventory

The target is `admin | member`, with a populated Role on authenticated UserActor at the server edge. Existing schema, persistence, provisioning, generated contracts, UI and tests still contain the third `owner` Role. This is a migration requirement, not an unresolved choice about whether owner should exist.

### Authentication and route admission requirements

- Browser workspace authentication already selects current Role through `User.select` (`packages/core/src/user.ts:64-68,83`; `packages/server/src/middleware/auth.ts:142-157`). Preserve the authenticated membership Role while narrowing Core inputs/results.
- Session routes already read Role from the persisted member and construct UserActor (`packages/server/src/middleware/auth.ts:201,237-244`). Keep this path aligned with ordinary workspace authentication.
- OAuth token authentication reads current Role through `OAuth.resolveAccess` (`packages/core/src/oauth.ts:373-376`) and wraps it in UserActor (`packages/core/src/actor.ts:58-60`). ServiceAccountActor has no member Role; do not synthesize admin for automation.
- AccountActor exists before membership selection and has no workspace Role. Admin admission must use an authenticated membership, not a bare Account cookie or a Role supplied in the request body.
- Server admin-required routes must inspect the authenticated UserActor Role. Core operations get only approved purpose-specific inputs. The exact location of a reusable route guard and its failure type are interface design details still to agree.
- Current candidate decision points are User invite, Config permission mutation, Agent permission mutation, and Permission tools update. Budget mutation, ServiceAccount/Key management, and other administrative-looking routes require an explicit user-approved route matrix; their names do not prove they should be admin-only.
- Invitation target Role (`InviteInput.role`) is already admin/member and is not evidence of the caller's authorization.

### Production schema, persisted data, API and UI

| File:line | Current owner dependency / required migration |
| --- | --- |
| `packages/schema/src/user.ts:26-32,38-79` | Role includes owner; flows to User.Info, Member, MemberList and CreateInput. InvitationRole is already admin/member. Reduce Role to the confirmed set and preserve invitation semantics. |
| `packages/schema/src/actor.ts:33` | UserActor uses User.Role; populated role remains required in target Actor. |
| `packages/core/src/database/schema/user.sql.ts:17-21,39` | Type enum and `user_role_check` permit owner. Existing stored owner rows need conversion before tightening the constraint. |
| `packages/core/src/auth/provision.ts:55-70` | First Workspace membership is currently provisioned as owner. New provisioning must produce a valid two-role membership; **admin is recommended to preserve existing initial privileges**, with rollout/data mapping to confirm. |
| `packages/core/src/user.ts:120,139-157` | Core invite currently authorizes by `role !== member`; replace whole-Actor dependency with server route admission according to the confirmed direction and approved invite route rule. Persistence still receives the target admin/member Role. |
| `packages/core/src/user.ts:68,115`; `packages/core/src/oauth.ts:376`; `packages/server/src/middleware/auth.ts:201,243` | Role readers/output projections inherit the data/schema transition; ensure old owner values cannot leak into authenticated target Actors during rollout. |
| `packages/server/src/handlers/config.ts:23-25`; `packages/server/src/handlers/agent.ts:23-24,42-44`; `packages/server/src/handlers/permission.ts:61-62` | Existing owner/admin checks are expressed as user + non-member, with owner wording in errors. Target checks should explicitly require admin on selected routes. Failure mapping/client expectations must migrate consistently. |
| `packages/protocol/src/groups/user.ts:9-20` | User list/invite reuse schema outputs. This is an observable Role contract change even though internal Actor is not serialized. |
| `packages/protocol/openapi.json:818,830,930` | Generated enum values include owner. Regenerate through the supported contract generation workflow. |
| `packages/client/src/promise/generated/types.ts:2448,2452,2466`; `packages/client/src/effect/api/api.ts:87,91,105` | Generated public Role unions include owner. Regenerate; do not hand-edit derived files. |
| `packages/web/src/members/route.tsx:31,210-211` | Invitation UI checks owner/admin; roleLabel type and Owner label include owner. UI availability should reflect the two-role contract, while server remains authoritative. |
| `packages/web/src/integration/route.tsx:50,128` | Permission editing UI checks owner/admin and displays owner/admin denial copy. |

Existing migration history carries the original three-role constraint. Anchors: `packages/core/src/database/migration/20260829074928_baseline/migration.sql:197`; snapshots at `20260829074928_baseline/snapshot.json:2976`, `20260829094235_remove_session_activity/snapshot.json:2963`, `20260830112449_add_integration_oauth_client_configuration/snapshot.json:3117`, `20260830141843_mcp-oauth/snapshot.json:3791`, `20260831104613_usage/snapshot.json:4111`, `20260831221651_workspace-invitations/snapshot.json:4152`, `20260831224513_usage-cost-completeness/snapshot.json:4178`, `20260903111355_inference/snapshot.json:4783`, `20260903113134_tool-usage/snapshot.json:5059`, `20260905024404_credential-owner/snapshot.json:5040`, `20260907100000_session-sequence/snapshot.json:4766` (all under the same migration directory). Use a forward data/schema migration rather than rewriting applied history. Recommended legacy mapping is owner → admin to retain existing privileges; exact deployment/compatibility sequencing remains open.

### Additional role-only test and documentation impacts

These files are additional to whole-Actor usage inventory; many contain no Actor import but will fail or become stale when owner is removed.

| File:line | Owner expectation |
| --- | --- |
| `packages/schema/test/user.test.ts:8,26,30-34`; `packages/schema/test/actor.test.ts:21,51`; `packages/core/test/actor.test.ts:9` | Three-role type/schema acceptance; retain rejection of owner for target contracts. |
| `packages/core/test/integration/auth.test.ts:158,280`; `packages/core/test/integration/user.test.ts:145,198,231,237,281-283`; `packages/core/test/integration/workspace.test.ts:88` | Provisioning/membership rows and expected Role. |
| `packages/core/test/integration/workspace-fixture.ts:27`; `packages/core/test/integration/integration.test.ts:190`; `packages/core/test/integration/session.test.ts:824-825,1809`; `packages/core/test/integration/usage-inference.test.ts:84`; `packages/core/test/integration/tool-usage.test.ts:46` | Shared SQL and object seed fixtures insert owner. |
| `packages/core/test/usage-session-provider.test.ts:21`; `packages/core/test/session-operations.test.ts:132`; `packages/server/src/application/recovery-postgres.test.ts:98` | Actor/background/recovery fixtures carry or persist owner. |
| `packages/protocol/test/client-contract.test.ts:74,88` | Generated-client list Role expectations. |
| `packages/server/src/routes.test.ts:1018,1263,1280` | Owner/admin denial message assertions. |
| `packages/web/src/members/route.test.tsx:31,33,109,114,176`; `packages/web/src/integration/route.test.tsx:133,177`; `packages/web/src/context/data.test.tsx:875`; `packages/web/e2e/docs/fixtures.ts:255,257` | UI Role fixtures, labels, visibility and denial text. |
| `CONTEXT.md:61,103,191`; `docs/specs/login-method.md:208,293` | Owner-specific canonical/spec authority statements need reconciliation with confirmed two-role target; this spec-only task does not edit them. |
| `packages/plugin/AGENTS.md:117`; `packages/docs/src/02-work/03-tools-and-permissions.mdx:33`; `packages/docs/src/05-connect/01-inbound-mcp.mdx:59`; `packages/docs/src/06-developer-reference/01-permission-model.mdx:12,110`; `packages/docs/src/06-developer-reference/04-provider-integration-plugins.mdx:357`; `packages/docs/src/07-configure/05-permissions.mdx:6,65` | Permanent-authority documentation uses owner/admin and should say admin after approved migration. |

`owner` used as a variable, runtime/credential ownership term, account label, or scenario name is not necessarily the deleted Role. For example, `packages/testing/src/scenario/tool-auth.ts:79` and `packages/testing/test/tool-auth.test.ts:13-24` use `"owner"` as an external test-member label; `WorkspaceMap.Owner`, Session.Owner and Credential ownership still describe relationships. Do not mechanically replace all occurrences of the word owner.

## 8. Recommended work units and unresolved decisions

These are sequencing recommendations, not approved replacement signatures.

1. **Record the confirmed target and agree remaining boundary details.** Two Roles (admin/member), populated authenticated UserActor Role, and server-side route authorization are confirmed. Confirm whether the ban includes Actor outputs/internal construction and whether `Actor.resolve` remains a Core authentication authority. Reconcile glossary owner/Actor/Scope wording. Do not substitute an all-purpose unwrapped Actor.properties bag.
2. **Account/membership flow.** Design reduced inputs for Account.validate, Workspace.list, User.select; resolve Auth/User/Account outputs; migrate cookies, middleware, OAuth.approve, testing login/workspace together. Preserve durable validation and current membership selection semantics.
3. **Membership administration and Role migration.** Design server-side Role admission using populated UserActor, confirm the admin route matrix, and decide how User.list obtains/returns viewer Role without whole Actor. Migrate both User handlers and Permission.selectedUser, persisted owner data/constraint, initial provisioning, generated unions, UI and fixtures. Preserve caller-vs-target Role distinction and error contracts.
4. **Inference admission and accounting.** Design the least facts needed by Gateway discovery/invocation, Budget, Limiter and Exchange. Keep caller-kind attribution, shared Workspace constraints, individual ServiceAccount limits, and policy lookup ownership explicit. Migrate private aliases/closures and the Session provider decorator in the same work unit.
5. **Binding/composition review.** Separately decide which services retain member runtime identity and which receive explicit Scope. Preserve Credential/Session isolation, graph cache identity, Plugin lifetimes, event feeds, background registrations, and workspace-only Gateway composition. Do not make Binding a request Actor substitute.
6. **Contract and test completion.** The confirmed Role reduction changes observable schemas and requires regenerated clients per Protocol guide. Migrate any other approved contract changes in their owning schemas/Protocol rather than hand-editing generated output. Update fixture contracts, documentation, and a searchable boundary regression check.

### Decisions that need user confirmation

- **Actor production:** Can Core Auth/User/Account/Actor resolution return Actors, or should the edge assemble Actor from operation-specific verified results? Where does token authentication authority live if Actor.Service moves?
- **Admin route matrix and non-HTTP callers:** Server-side route Role authorization is confirmed. Which routes require admin, and how do background/plugin/direct Core callers enter the admitted operation contract? Durable identity validation and domain policy enforcement remain separate concerns; do not reintroduce a whole Actor into Core for them.
- **Legacy role rollout:** Owner is removed in the target. Confirm legacy owner → admin conversion, admin provisioning of the initial membership, deployment order, and compatibility behavior while old processes/clients may still exist. These migration mechanics must not leave authenticated owner Actors in the target system.
- **Role response:** Should User.list still return viewer Role, and which authority supplies it after narrowing the input? Is separating that response an intended API change?
- **Inference subject/policy:** Are workspace ID + purpose-specific attribution sufficient, or should admission consume another verified/policy value? Do not adopt `Usage.Principal` as a universal authorization object merely because its shape is small.
- **Freshness:** Preserve per-physical-call membership refresh for Sessions? If replacing it, define revocation and membership-replacement behavior explicitly. Should Gateway also revalidate beyond ingress? Current code does not establish a universal freshness policy.
- **Binding scope:** Is the task only whole-Actor propagation or also ambient identity in stateless Core layers? Which runtime owners remain retained? No automatic deletion/renaming of Actor.Binding is approved.
- **Unused variants and Key ID:** Retain Actor.Info, WorkspaceActor, SystemActor and Core schema reexports for edge/compatibility use, or remove them? Does any new operation actually need Key ID? No current inference consumer does.
- **Policy gaps:** Keep this migration behavior-preserving relative to implemented limits, or separately implement glossary User overrides/default-vs-mandatory constraints? Record that decision rather than treating a shape change as policy implementation.

Before implementing any changed public service, supply the root guide's approval artifact: authority, complete signatures, typed errors, dependencies/private internals, deletion-test rationale, call/dependency graphs, Layer composition, and tests. This inventory supplies evidence for that discussion.

### Completion criteria for the eventual implementation

- No Core operation accepts a schema Actor/Caller, aliased Actor, inferred Actor-shaped argument, or equivalent whole identity bag under another name.
- Only admin/member are accepted or emitted as current membership Roles; server authentication populates UserActor Role and the approved admin-only route set enforces it. Existing owner rows and initial provisioning migrate consistently, with regenerated clients and updated UI/tests.
- Every approved Actor-output/internal-construction change is reflected in ingress, OAuth, retained Session/background inference, and fixtures.
- Required IDs, roles, caller-kind accounting, membership freshness, typed failures, isolation and release/settlement semantics are preserved or explicitly approved as changed.
- Actor.Binding is assessed independently; no fabricated User/system identity is introduced to satisfy a member graph.
- Search inventory is rerun and every residual Actor reference classified as edge schema/authentication, approved output, binding-only construction, documentation, test, or removed dependency.

## 9. Search ledger and completeness review

Searches covered the repository, then followed service variables, aliases and inferred return values; a literal `Actor` search alone misses Auth callback, OAuth approval, Session provider decoration, and structural test fakes.

```sh
rg -n '\bActor\b|\b(AccountActor|UserActor|ServiceAccountActor|WorkspaceActor|SystemActor|CurrentActor|CurrentAccount)\b' .
rg -n '\bactor\b|/actor(["./])|Actor\.Binding|Actor\.binding' packages app
rg -n 'users\.select|users\.invite|users\.list|accounts\.validate|auth\.resolve|oauth\.approve|UserService|CoreAuth|CoreUser' packages app
rg -n 'principal|\.reserve\(|limiter\.(consume|charge)|sessionProviderLayer' packages/core packages/server packages/testing
rg -n 'binding\.|owner\.|\.properties|type: "user"|type: "account"|type: "service_account"' packages/core/src packages/core/test packages/server/src packages/testing
rg -n 'CurrentActor|CurrentAccount|Actor\.Binding|Actor\.binding|/actor' packages/protocol packages/server packages/testing
rg -n '["\x27]owner["\x27]|owner or admin|owners and admin|owner.*admin|admin.*owner' packages app CONTEXT.md docs
```

Reviewed explicit imports, Core reexports, inline type imports, `node as bindingNode`, `Service as UserService`, `AccessError as UserAccessError`, CoreAuth/CoreUser aliases, `CurrentActor.use`, nested `Service.use`, `(yield* Service).operation`, destructured `{ actor }` / `{ actor: current }`, `principal = input.actor`, `owner = binding`, inferred Auth results, Actor.properties spreads, and closures retained by streaming/finalizers.

Completeness check: all 79 TypeScript/TSX files returned by the direct Actor-type/context/import search are named in this spec (including the Docker false positive). Additional inferred-call and role-only files are listed separately. A filesystem check confirmed that all fully qualified `packages/...:line` anchors exist and fall within their files. This is a repository source audit, not a runtime test or a proof based only on text-search counts.

Documentation references to revisit if approved meaning changes: `CONTEXT.md:27-77`; `packages/core/src/llm-gateway/README.md:53,146,239,609`; `packages/testing/src/README.md:55`; `docs/specs/login-method.md:208`; historical `audit/server-composition.md:104-116,142,203-246`, `audit/summary.md:13`, `plans/bus-simplification.md:473,482`, `plans/bus-opencode-semantics.md:568`. Historical plans describe earlier composition and are not current implementation authority.

Excluded false positives: Docker event `{{.Actor.ID}}` in `packages/testing/test/execution.test.ts:31`, actor-model research, and substring matches such as `factory`/`refactor`. No additional production whole-Actor consumer was found in client, web, plugin SDK, application hosts, or generated protocol clients. Those clients transmit operation payloads/IDs and authentication material, not the internal Actor schema. A future wire-contract change still requires regeneration.
