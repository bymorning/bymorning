# Domain Glossary

## Application

One configured running installation, whose selected capabilities are shared by its process and workspace lifetimes. An Application selects its environment-specific implementations explicitly; business operations consume those capabilities without choosing an environment.

## Storage

The capability that stores and retrieves named content through a selected Storage Provider. Storage owns provider selection and namespace isolation, including the scoped key/value storage supplied to a Plugin. The Plugin host supplies the Workspace and Plugin identities; Storage owns how those identities isolate stored content.

## Storage Provider

A storage implementation identified by the kind of storage it supplies. Storage selects a Provider explicitly or through its configured default. Changing the selected Storage Provider does not itself move content between destinations. A Storage Provider is distinct from the unqualified Provider, which owns an inference endpoint.

## Local Login

A development-only sign-in using the stable identity declared by the local installation owner. Local Login requires no external identity verification or delivery service and resolves to a persisted Account through the normal account and membership rules.

## Installation

One deployed ByMorning. It owns settings no Workspace owns: its Auth Providers, the Setup state, its Installation Admins, and its Installation Policy.

## Installation Admin

An Account granted installation-wide administrative authority: managing Auth Providers, setting the Installation Policy, and suspending and restoring Accounts. Installation Admin is not a Workspace Role and confers no Workspace membership. One grant exists per Account, granted and revoked only by an existing Installation Admin except at bootstrap: the first login after Setup becomes the Installation Admin, creating the Default Workspace as its workspace admin. Every later first login requires an invitation unless the Installation Policy opens provisioning. Revoking the last Installation Admin is refused; if no admin remains, re-presenting the Setup token re-arms bootstrap so the next login becomes the Installation Admin.

A suspended Account loses access to the whole Installation on its next request: authentication, membership selection, and OAuth use are refused, its Login Sessions and OAuth grants are revoked, and its Scheduled Tasks pause. Its memberships are untouched, and restoring the Account re-enables login. Suspension is installation-wide; member removal is Workspace-scoped.

## Installation Policy

The Installation-owned restriction document constraining every Workspace's effective Config and admission behavior. It carries Provider admission (`providers.allow`), Plugins (an allowlist or off), web search (off), public Session sharing (off), account provisioning (`open` or `invite-only`), and invitation email domains. A locked capability is a mandatory installation restriction — the same semantics a mandatory Workspace restriction has — so a Workspace may tighten further, never loosen. Provisioning defaults to invite-only: a first login without an invitation is refused, and only an open policy lets an admitted-domain first login provision a new Workspace. Invitation domains default to the union of the enabled Auth Providers' admitted domains.

## Setup

The Installation's state before an Auth Provider exists. ByMorning generates a setup token itself on first start — or accepts an operator-supplied token — and stores only its hash. While Setup is pending, the token is revealed only through the host's owner-read-only setup-token file, whose location is reported in its logs; the token value is never logged. If the file is lost before Setup completes, the stored token is rotated and the new token is revealed the same way. Presenting the token registers the first Auth Provider and ends Setup, and the file is removed. The token remains the recovery path for replacing a broken Auth Provider; an operator may also supply it explicitly to regain access. Re-presenting the token also re-arms Installation Admin bootstrap, so the next login becomes the Installation Admin when no admin remains.

## Getting Started

A checklist of first-use steps shown on the Overview to a Workspace administrator whose Workspace has not yet reached first use. A step is complete when its outcome exists in the Workspace, such as an active Provider, a Session, a Skill, a Spend Limit, a Tool source, or a Key; completion is never recorded separately. An administrator may skip any step or dismiss the checklist; that is a browser-local preference, like Picker Visibility, and changes no Workspace state. Getting Started is distinct from Setup, which is the Installation's state before an Auth Provider exists. Members without the admin Role never see it.

## LLM Gateway

The capability through which external callers discover and invoke available Models using supported request formats. LLM Gateway owns each caller format's request contract — how a request is interpreted and how outcomes and failures are rendered — together with compatible destination selection, the Provider exchange, and usage observation attributed to the caller principal. It translates between supported caller and Provider formats while preserving messages, tool calls and results, streaming, usage, and failures. A request feature that cannot be represented at the selected destination is refused explicitly rather than silently discarded. The server authenticates and authorizes the Actor before calling LLM Gateway, reserves spend through Budget for the Holders that Actor implies, then supplies the Workspace in which the operation runs, the Actor's accounting principal, and a way to settle the observed cost; LLM Gateway does not authenticate Tokens or decide Spend Limits, and the principal it receives is accounting attribution, never an authorization input. The transport that delivers a request to LLM Gateway owns only delivery concerns such as connection lifetime, cancellation, and size limits. LLM Gateway consumes the shared configuration, Credential, Limiter, and Usage authorities. It operates independently of Session and does not create a Session or attempt another destination after a failed request. Routing applies without its Session conditions. Model availability and permission to invoke that Model through LLM Gateway are separate decisions.

## Actor

An authenticated identity that a request or background operation acts as. A person acting through one Workspace membership is a User Actor and carries that membership's Role; a Service Account acting through one Key is a Service Account Actor; a person who has not yet selected a membership is an Account Actor; ByMorning itself acting within one Workspace is a System Actor. An Actor is established and consumed at the edge where a request enters ByMorning. The edge authorizes the request and passes only the explicit facts required by each Core operation; Core capabilities never derive an Actor from a request.

## Token

Authentication material a caller presents in a request header: either an access token issued by the MCP authorization capability or a Key. Authenticating a Token yields an Actor and nothing more; what that Actor may do is governed by membership, Role, and Policy.

## Scope

The explicit Workspace, or Workspace and member, within which one Core operation acts. The edge derives a Scope from the Actor and passes it to the operation. Scope replaces ambient identity: a capability that needs to know which Workspace or member it acts for receives that fact as an input rather than being constructed for one identity.

## Member

A User's binding to one Workspace. Member owns the retained per-member runtime — Sessions in execution, Plugin processes, MCP connections, and live event feeds — and member-scoped Credentials and Connections. The runtime is retained for a Member because it holds live state, not because identity is needed to authorize its operations.

A Workspace administrator may remove a Member: the membership is soft-deleted, the member's OAuth grants for that Workspace are revoked, the member's own Connections in that Workspace are deleted, the member's retained runtime ends, and the member's Scheduled Tasks pause rather than delete. The member's Sessions are retained as Workspace records, with attribution showing a former member. The Workspace's last admin cannot be removed.

## Spend Limit

The amount one Holder may spend on inference in one Period. Every inference entrypoint must satisfy the Spend Limit of every Holder the edge derives for it; a Workspace Holder's Spend Limit applies to both LLM Gateway invocations and Session inference, including background model calls and Routing judge calls. A Holder without a Spend Limit is unrestricted but still accrues Charges.

## Holder

An opaque key naming anything whose inference spend is limited. Budget stores Spend Limits and Charges by Holder and never interprets the key. The edge derives a Workspace Holder plus either a User Holder or a Service Account Holder from the Actor; a Key is not a Holder. Avoid: subject, principal, scope.

## Charge

Settled inference spend recorded against one Holder in one Period. Budget owns Charges for enforcement; Usage separately owns detailed accounting for reporting. The same invocation produces one Charge per Holder and one Usage record.

## Period

The UTC calendar month containing the current instant. Spend Limits and Charges are evaluated within one Period.

## Policy

Rules supplied by Plugins for a Workspace, User, or Service Account that determine permitted activity and applicable Spend Limits. Policy has no independently managed identity or lifecycle. Workspace policy distinguishes caller defaults from mandatory shared constraints. User and Service Account overrides may loosen or tighten those defaults; omitted overrides inherit them. Mandatory Workspace restrictions remain binding regardless of caller overrides.

A User or Service Account Holder's Spend Limit restricts that caller individually, while the Workspace Holder's Spend Limit restricts shared consumption. Setting an individual Spend Limit does not replace the shared restriction. Policy determines applicable activity rules; Budget owns and enforces Spend Limits, Limiter enforces activity limits, and Usage owns accounting.

LLM Gateway invocation applies Workspace activity policy only; it does not apply User or Service Account activity overrides. Spend Limits are the exception: the edge reserves against the Workspace Holder and the caller's User or Service Account Holder before the Gateway runs. A Service Account's creator does not supply an additional policy layer. LLM Gateway Usage is attributed to its caller principal and its Workspace, while Session Usage remains attributed to the Session's User; both contribute to shared Workspace consumption and to the Workspace Holder's Charges.

## Plugin

An extension that contributes capabilities or customizes ByMorning behavior while active. A Plugin may supply policy, routing, and content transformations; Permission, Budget, Limiter, and Usage retain authority over their respective decisions and accounting.

## Permission

A rule-based decision for an action and resource. Workspace rules apply to every member. A rule addressed to one User applies only to that member after Agent and Workspace rules. The last matching rule decides; an unmatched action remains allowed. Only Workspace administrators author permanent Permission rules. Session and gateway approvals are once-only and never create permanent authority. Retained legacy saved grants are ignored. Permission does not admit Providers or rewrite Models.

Managed Tool permissions are Workspace defaults authored only by Workspace administrators; their management surface has no member-specific scope or confirmation step. A Tool's permission action is the action asserted by its execution contract, which may differ from its registered callable name. Only currently discovered Tools appear for management, while rules already saved for an unavailable Tool remain persisted and apply again if that Tool returns.

## Service Account

A Workspace-owned automation identity that acts independently of a User. A Service Account may be a policy target for capabilities that receive its identity, and the edge derives a Service Account Holder from it so its Spend Limit is enforced before the Gateway runs. LLM Gateway itself does not apply Service Account-specific activity policy, but Usage attributes its Gateway invocations to the Service Account principal. Creating a Service Account does not make its creator's policy apply to its operations.

## Budget

The capability that enforces Spend Limits for inference and owns Spend Limits and Charges by Holder. Before inference, the edge reserves through Budget for every Holder it derives, supplying its estimate of the invocation's worst-case cost when it can; Budget holds that estimate, never more than the room the Holder has left, so concurrent invocations share a Period's room rather than the first claiming all of it. Budget refuses only when a Holder has no room left and names that Holder. After inference, the reservation is settled with the observed cost, producing one Charge per Holder. An unsettled reservation is released. Because estimates are not guarantees, concurrent invocations may settle a Period above its Spend Limit by at most the amount their estimates fell short; Budget applies a nominal hold when the edge supplies no estimate. Budget depends on no other domain's identity: it never reads Workspace configuration, Service Account policy, or Usage. Every inference entrypoint reserves through Budget; LLM Gateway and Session retain their own execution and usage observation responsibilities. A refusal is answered with the time until the Period ends.

## Limiter

The capability that enforces Workspace activity limits for inference: which Models may be invoked and how many requests and tokens may be consumed within a period. Limiter answers whether one invocation is currently permitted and counts the consumption it permits; it holds no monetary meaning. Limiter consumes effective policy. Budget and Limiter are separate decisions and either may refuse independently. Limiter admits by Model identity, not by Provider name, and does not rewrite which Catalog Model a request uses.

## Usage

The capability that owns the authoritative accounting of Model consumption, including its pricing, recording, and reporting. Recording an observation yields its priced cost, which the entrypoint settles against its Budget reservation; Usage does not know Holders. LLM Gateway consumption is attributed to the User or Service Account principal the edge authenticated, and appears in that principal's reports; records written before attribution remain unattributed. Session consumption remains attributed to the Session's User.

## Tool Gateway

The capability through which an authorized external caller discovers and invokes the Tools exposed to that caller. Tool Gateway owns the exposed catalog, external invocation policy, and member-bound invocation orchestration. It consumes shared Tool registration, permission evaluation, and execution capabilities. A Tool requiring interactive approval is not implicitly authorized for external execution. Tool Gateway exposes Tools to callers; external capabilities may supply Tools to ByMorning. Neither gateway is a persisted aggregate.

## Workspace

The installation-owned persistence container for ByMorning configuration and records. Workspace identity maintains persisted relationships but does not scope Core operations or represent a caller-selected tenant boundary.

## Key

A ByMorning-issued ingress API key that authenticates a caller to ByMorning. A Key authenticates caller -> ByMorning; a Provider API key authenticates ByMorning -> Provider. Provider authentication material belongs to a Credential associated with the Provider's Integration.

## Auth

The installation-owned capability that establishes and ends authenticated access through its configured Auth Providers. Auth owns Auth Provider selection, the decision linking a verified Subject to an Account, and the creation, authentication, expiry, and revocation of Login Sessions. Each installation authenticates its own people directly rather than depending on a separate ByMorning login issuer.

A Key authenticates caller -> ByMorning for API ingress; the MCP authorization capability authorizes workspace API access with its own client records; Auth authenticates people. Auth does not grant Workspace permissions, which remain governed by membership and Role.

## Login Session

A revocable grant of authenticated access to one installation for one Account, with a bounded lifetime. Auth owns its lifecycle. A Login Session is durable: the installation holds its record from issuance until the session is revoked or expires, so presenting it after revocation, after inactivity beyond its idle bound, or after its absolute lifetime is refused. Ending or revoking a Login Session takes effect at the installation, not merely for the caller that held it; revoking an Account's Login Sessions ends all of them at once. A Login Session is distinct from a conversation Session and does not itself grant Workspace membership or a Role.

## Auth Provider

An Installation may have multiple Auth Providers. Each is a standard OpenID Connect login target with its own durable identity, display name, kind used only for guidance (Okta, Microsoft Entra, Google Workspace, Auth0, Ping, Custom), issuer, client ID, client secret, and admitted email domains. Kind never changes protocol behaviour, including the Azure Government authority for Microsoft Entra, which is only a different issuer. A person selects an Auth Provider when signing in; that Auth Provider independently verifies the person and defines admitted email domains. Adding an Auth Provider does not replace another. Only Installation Admins may manage the Installation's Auth Providers.

An Auth Provider is distinct from a Provider, which is an inference endpoint, and from an Integration, which carries the function runtime's outbound authentication. Local Login is not an Auth Provider.

## Subject

A verified statement from one Auth Provider identifying an external person by that Auth Provider and its stable external subject, together with attributes asserted about that person, including email and whether that email is verified. An email is verified only when the Auth Provider itself asserts it, through the standard verified-email claim or Microsoft's domain-owner-verified equivalent for the email it supplies; an explicit statement that the email is unverified is never overridden. A Subject is evidence handed to Auth's account decision and carries no authority of its own. Email is an attribute of a Subject, not its identity.

## Linked Subject

A durable link between one Subject of an Auth Provider and one Account. A Linked Subject is identified by its Auth Provider and stable external subject pair and answers which Account that external identity belongs to. Sharing an email address does not merge Accounts or transfer a Linked Subject. A Subject is ephemeral evidence, an Account is the person, and a User is an Account's membership in a Workspace.

## Catalog

The installation's configured collection of Providers and their Models. The Catalog combines bundled definitions and active Plugin contributions with explicit configuration; explicit values take precedence over contributed values, bundled values, and general defaults. Providers and Models may be fully custom. The effective Catalog defines their execution configuration; a bundled definition is not required to invoke a custom Model. Inclusion in the Catalog is distinct from authentication availability, Workspace admission by Provider name, and permission to execute a Model. Deprecated Models are excluded from the bundled Catalog.

Sessions and LLM Gateway use the same effective Catalog, including active Plugin contributions and explicit Workspace configuration. The entrypoint does not select a different set of Provider or Model definitions. Caller-specific authentication availability and admission may still differ.

The bundled Catalog includes every nondeprecated Provider Model from the pinned source. Discovery does not assert transport or authentication availability. Source package names and environment variable names are descriptive hints, not installed capabilities or credentials. A Model's explicit endpoint and transport settings override its Provider's defaults.

Bedrock Model eligibility follows supported language capabilities and transport compatibility, without a manually approved list of individual Models or regions, except in AWS GovCloud (US): there the bundled Catalog offers only the cross-Region inference profiles AWS documents for GovCloud, because the pinned source lists none. AWS determines account access and regional availability. Catalog inclusion does not assert that AWS will authorize or serve an invocation.

## Model

A selectable model belonging to exactly one Provider. A Model is identified by its Provider's key and its own key within that Provider. It owns its upstream model name, model-specific execution configuration, descriptive metadata, and enabled state. Its key and display label may be custom and may differ from its upstream model name. A Model may use a ModelDefinition or be fully custom; missing descriptive metadata does not imply a known capability, limit, or price.

A custom Model needs only a display label and an upstream model name within its Provider. Additional descriptive metadata, request settings, and Variants are optional. Missing metadata remains unknown rather than becoming an asserted capability, limit, or price.

Workspace administrators configure custom Models for their Workspace on its existing Providers, optionally stating prices and a context limit. Adding a custom Model under a key its Provider already uses is refused rather than replacing that Model. If a later bundled or contributed Model takes the same key, the custom configuration takes precedence as explicit configuration. Removing a custom Model removes its Workspace enablement state.

Changing a display label preserves identity. Moving a Model to another Provider changes identity. Disabling its Provider makes a Model unavailable without changing the Model's own configuration. Its destination belongs to the Model rather than to a separately managed Route. Routing may rewrite which Catalog Model a request uses; the resulting Model still owns that destination.

## Picker Visibility

A person's browser-local preference for whether a Model appears in conversation selection and search. Picker Visibility is independent of shared Model enablement and does not alter execution permission. Explicit hide takes precedence over automatic recency; explicit show keeps a Model visible. Selecting a Model records explicit show. Hiding the current Model preserves the conversation's selection and its displayed identity.

Without an explicit preference, the newest Model in each Provider and Family released within six thirty-day months of the present is visible, including future releases within that window. Equal release dates preserve Catalog order. Models with missing or invalid release dates remain visible; other dated Models, including those without a Family, are hidden. Model management includes older and hidden Models.

## ModelDefinition

A platform-shipped description of one known Model configuration that supplies defaults and known metadata to the Catalog. Explicit Model configuration takes precedence. A definition is reference data; it is never callable itself.

## Variant

A named request-configuration overlay belonging to one Model. A Variant is identified by its name within that Model. Selecting it preserves the Model's identity and applies its request settings after the Provider's and Model's settings. A Variant does not change the Provider, upstream model name, endpoint, or authentication identity. Selecting an unknown Variant is refused rather than silently using the Model's base configuration.

## Provider

A named inference endpoint supplying zero or more Models. A Provider is identified by its key in the Catalog and owns its endpoint, request format, shared authentication configuration, display label, and activation setting. Its key and display label may be custom. Changing its configuration under the same key preserves identity. A Provider is compatible with a caller format when the request can be represented in the Provider's format, directly or through supported LLM Gateway translation.

An authenticated Provider refers to an Integration whose Connections supply authentication; persisted secret material belongs to Credential. A Provider may explicitly require no authentication. Disabling a Provider makes all of its Models unavailable while preserving their configuration.

A Workspace may restrict which Providers may be invoked. An omitted restriction admits every active Provider. A present restriction is an allowlist of Provider names, including an empty allowlist that admits none. This is Workspace admission by Provider name. It is distinct from Provider Activation, from Limiter admission by Model identity, and from Permission.

A custom Provider needs a display label, native request format, endpoint, and an explicit authentication choice. Authenticated creation additionally collects the credential input for its Integration. Supported choices include bearer authentication, native API-key authentication, and a custom authentication header; the custom-header choice additionally requires the header name. Credential input does not become Provider-owned secret material. Additional metadata and request configuration are optional.

## Provider Activation

A Provider's participation in application use, governed by the Catalog through automatic activation, explicit enablement, or explicit disablement. Automatic activation follows supported complete environment credentials, permitted saved Connections for the Provider's Integration, or an explicit choice to require no authentication. Explicit enablement permits participation independently of authentication discovery; explicit disablement prevents participation while preserving discovery and configuration. Activation does not prove credential validity, upstream permission, or Model executability.

Bundled AWS support and a default region do not activate Bedrock. Using the deployment's AWS credential chain requires explicitly enabling the Provider; its temporary credentials are resolved when needed. Supported complete environment credentials and permitted saved Connections can activate a Provider automatically. Connections belonging only to unrelated capabilities do not activate an inference Provider.

## Routing

Workspace-owned choice of which Catalog Model a request uses. Routing is an ordered list of rules. A rule's conditions may match the requested Model or an Auto name, the request purpose, text in the latest participant ask, the estimated context size, whether the request contains images, the Agent, and a Tool that has already completed in the Session. The last matching rule decides.

A rule's target is either one Catalog Model or a set of Tiers. A Tier is a described Catalog Model. With a Tier target, a judge Model chosen by the administrator picks one Tier from the descriptions, seeing only participant turns. When judging fails, times out, or picks a Tier that cannot run, the rule's default Tier is used. Routing never fails a request because classification failed.

An Auto name is a reserved Model reference that only Routing resolves. Participants may select it, Agents and Scheduled Tasks may prefer it, and LLM Gateway callers may request it. An Auto name that no rule matches cannot be invoked.

In a Session, Routing decides once per participant turn and keeps that decision through the turn's Tool calls, so a condition on a completed Tool takes effect at the next participant turn. LLM Gateway decides once per participant ask; requests that continue a tool loop reuse that decision. Session conditions do not apply to LLM Gateway.

Each decision records the rule, the Tier, the resolved Model, and its cause. The judge's inference is charged through Budget and recorded by Usage like any other inference.

The resolved Model still owns destination, including endpoint, upstream name, and authentication. Spend Limits remain Budget; Permission remains Tool allow, deny, or ask; Limiter remains request and token rates and admits the resolved Model. Routing chooses Models; it is not a general policy language.

## Team

A workspace-owned, named group of workspace members that mirrors an organization's structure. A Team is a policy target; it does not own Provider authentication material or Keys.

## Role

A workspace-assigned permission set that determines what a member may do within that Workspace. The Roles are admin and member. An admin may invite members; a member may not. The invitation specifies the invitee's Role independently of the caller's Role. Invitation access is decided before the membership operation, which receives the Workspace and invitation data rather than the caller's Actor. A Role grants permissions; a Team groups members; the two are distinct policy targets.

## Integration

A generic authentication identity used by an external capability. An Integration declares the ways that identity can be authenticated and exposes its available Connections. It does not own provider, model, tool, endpoint, or protocol semantics, and its public information never contains credential values. Different capabilities may use the same Integration.

An Integration may require a member's own Connection or permit a shared Workspace Connection. Google Gmail and authenticated MCP account Connections belong to the member who authorizes them. Registering an MCP source in a Workspace makes it available to members; it does not authorize another member's account.

Integration owns selection of deployment authentication alongside permitted persisted and environment Connections. Deployment authentication may yield temporary credentials that must be resolved afresh when needed; refresh preserves the selected authentication identity rather than falling back to another identity.

## Outbound MCP Enablement

The Workspace-owned persisted decision whether an outbound MCP server may establish live connections. Only Workspace administrators may change this decision. Disablement prevents connection and Tool discovery and cannot be bypassed by a member attempting a live connection. Re-enabling permits connection but does not itself supply or share a member's personal authentication. Tools are discoverable only while their server is currently connected; their saved Workspace Permission rules survive disconnection.

## Member Value

A named value that each member supplies for themselves to authenticate with one outbound MCP server whose request headers refer to it. A Workspace administrator defines the server, its headers, and which header values are Member Values; each member owns their own Member Values as a member-only Connection of that server's Integration, and no administrator or other member can supply, read, or substitute them. A member's requests carry only that member's values. Header values that refer to no Member Value are shared Workspace configuration, identical for every member.

A member missing any Member Value the server's headers refer to sees the server as requiring authentication and has none of its Tools; ByMorning does not contact the server for that member. Saving values is verified by connecting with them; values the server rejects remain saved but are reported as failed. Every Member Value is secret: it is never shown again once saved, and is replaced rather than revealed. Member Values are collected only through ByMorning's own connection surface, never through a conversation. A Scheduled Task uses its owner's values and never another member's or shared values.

A server authenticates either through its own authorization or through Member Values, never both. ByMorning may itself supply values describing the member, such as the member's verified email; those are filled from the member's account and are never typed. Adding a Member Value to a server requires each member to supply it before reconnecting; changing a server's address discards every member's saved values, because they were entrusted to the previous address. Removing a member discards that member's values.

## Credential

Persisted secret authentication material for one Integration, such as an API key or OAuth material. A Credential owns its secret value; public Credential information identifies the record and its Integration without exposing that value. At rest, the value is Cipher-encrypted; the same protection covers Auth Provider client secrets, and the installation setup token is stored only as a hash.

A Credential serves either application setup or an account Connection. OAuth application setup belongs to the Workspace and is shared across authorizations for that method. Connection credentials belong to the Workspace or one member within it. Application setup and account credentials are complementary and never override one another.

## Cipher

The Core-internal capability that encrypts persisted secret columns at rest with versioned envelopes, and decrypts envelopes and legacy plaintext. The host selects the key backend at composition: an AWS KMS symmetric key in deployed installations, or a local master key held beside the host's other key files in development. Writes always encrypt; reads accept legacy plaintext only until the boot-time migration re-encrypts it, and a backend that cannot serve a decryption fails closed rather than substituting plaintext. Cipher is never exposed through the SDK and never logs secret material.

## Tool

One named registered callable operation, with one authoritative definition and execution contract, available through the agent harness or Tool Gateway according to caller context and permissions. A Tool may be built in, contributed by a Plugin, or supplied by an external capability; it does not require a separate source aggregate. Using a different entrypoint does not create a different Tool.

## Toolkit

ByMorning-supplied Tools for operating its capabilities.

## Elicitation

One request made by a Tool to the participant acting in its current Session for form input or a browser URL interaction. An Elicitation reports acceptance, explicit decline, or cancellation to its requesting Tool; URL acknowledgement is not evidence that external authorization completed. Form owns presentation and validation; Integration owns authorization completion.

## Code Interpreter

The capability that executes one command or source program in an isolated environment through one selected implementation. An installation declares a default implementation, and a Workspace may select a registered implementation; each new execution uses the current selection. An in-flight execution retains its selected implementation and resources across configuration or registration changes. When the selected implementation is unavailable, Code Interpreter refuses execution without fallback.

Code Interpreter owns implementation selection and execution admission. It excludes Tool permissions, source-file access, Session lifecycle, and implementation-specific isolation policy.

## AWS Region

A region code in an AWS partition the Installation supports: commercial (`aws`) or GovCloud (`aws-us-gov`). The region alone determines its partition and the hostnames of regional AWS endpoints; a Provider with a regional endpoint declares the partitions it serves. China and ISO partitions are not supported. AWS, not the Installation, determines which services and Models a region offers.

## Connection

A secret-free projection of authentication currently available to one Integration. A Connection identifies a persisted Credential, an available environment source, or deployment authentication. It is not an independently persisted authorization aggregate and never exposes a secret value.

A member's active Connection takes precedence over a permitted shared Workspace Connection. Active selection is independent for each owner. Authentication failure does not switch identities, and another member's Connection is never a fallback. Integrations requiring personal authentication expose only the current member's Connections.

## Collection

A member-owned, named bundle of Models and Tools already enabled in the member's Workspace. A Key may be scoped to one Collection, granting access to only its contents.

## Agent

A named execution profile under which a Session runs, supplying its system instructions, Model preference, Step allowance, and Permission rules. ByMorning ships built-in Agents. A Workspace administrator may override a built-in Agent by saving a Workspace record under the same identity; that record replaces the built-in definition entirely until it is removed, and removing it restores the built-in. A Plugin contribution shadows both. Selecting which Agent is the default is a separate Workspace preference and never changes an Agent's own definition.

ByMorning ships exactly one built-in primary Agent, Default, the Agent a participant runs a Session under. Every Agent an administrator creates through the public API is a Subagent, which the selected Agent delegates to rather than a participant choosing directly; the public API also refuses to change an Agent's mode once created, so a Subagent an administrator creates never becomes a second selectable Agent that way. Improving the Default Agent is therefore how a Workspace changes the behavior its members share.

## Workspace Instruction

A Workspace-owned, named text instruction that supplies company guidance to conversations in that Workspace. Enabled Workspace Instructions apply at the next model request, including in existing Sessions. Only Workspace administrators may create, change, enable, disable, or delete them; other members may view them. Workspace Instructions persist independently of any Session.

## Project

A named container in a Workspace that groups Sessions and Scheduled Tasks and owns a set of Project Files. Every Workspace has a Default Project. A Project is active or archived. Archiving hides the Project and its Sessions from default lists without deleting anything; an archived Project remains addressable and can be restored, which returns it and its contents to how they were. While archived, a Project is read-only: no Session can be created in it, its Sessions accept no new Messages, and its Scheduled Tasks do not run. The Default Project cannot be archived. Deleting a Project is permanent and purges its Project Files.

## Project File

A file in a Project, addressed by its Project-relative path. Folders are only path prefixes shared by Project Files; a folder without files does not exist. A Project File can be written, read, moved to a path no other Project File occupies, and deleted. Renaming or deleting a folder moves or deletes every Project File under that prefix.

## Session

A durable conversation created empty, addressed by Session ID, and owning an ordered history of Messages. A Session has a title. New Sessions start titled "New session" until a title is set or generated from the first participant Message. Archiving a Session hides it from default Session lists without deleting it; the Session remains addressable and can be restored. A Session may record the Scheduled Task whose run created it, directly or as a child Session; such Sessions run unattended.

Reconnecting to a Session restores its current state, including output available from an active Run, and then follows subsequent changes. It does not replay every notification missed during disconnection. Saved Messages survive process failure; unsaved Run output does not.

## Scheduled Task

A member-owned, named prompt that ByMorning runs on that member's behalf on a recurring schedule (a cron expression in one IANA time zone) or on demand. Each run creates a new Session owned by the member in the task's Project, titled with the task name, submits the prompt as the first Message, and executes as that member with the member's Spend Limits, Permissions, and Tools. A run is unattended: a Tool that would ask for approval is denied instead, the run cannot ask the member questions, and Tools are withheld after a bounded number of model turns so the run ends with what it has. A task may prefer a Model; when that Model is unavailable the run uses the default and says so. A task is enabled or paused; a paused task keeps its definition and never runs. A run whose occurrence passes without starting — no Application process was available, or its owner could not act — is _missed_: it does not execute, the task advances to its next future occurrence, and the miss is shown to the member until the task next runs or the member dismisses it. A run that cannot start records why on the task. A schedule must leave at least one hour between occurrences, and a member may hold a bounded number of tasks. A Scheduled Task records only its latest run and latest miss; the Sessions it created are the record of what each run did. It is distinct from a Service Account (an automation identity) and a Job (process-local execution tracking).

## Share

A revocable public grant to read one Session transcript without authentication. Share is identified by an unguessable Token. At most one active Share exists per Session; creating again rotates the Token. The public view is the Session's current saved Messages, not a snapshot. Unsharing or deleting the Session ends public readability. Share does not grant prompting, Tool use, or membership.

## Client View

A caller-local view of the Sessions and supporting resources available to that caller. A Client View combines observed current state with subsequent notifications and distinguishes unacknowledged interactions from authoritative records. Losing a Client View does not erase saved records.

## Inbox

The durable, ordered work admitted to a Session but not yet delivered for execution. An Inbox item is identified by its Message ID. Session owns its admission, delivery priority, chronological position, cancellation, and atomic promotion into Message history. Inbox items are distinct from Messages already in Session history, process-local Run activity, Permissions, and Forms.

## Bus

The process-local capability that delivers Events to currently attached subscribers within its delivery scope. Bus owns live delivery and subscription lifetime. The domain that performs an operation owns its state changes and their durability; publishing an Event does not perform those changes or retain notification history.

## Event

A typed notification of an occurrence. An Event reports a change or live activity to current subscribers. Its occurrence identity is distinct from a Message's position in Session history. Missing an Event does not erase saved domain state; reconnecting consumers recover current state from its owner.

## Audit

The Installation-owned capability that durably records security-relevant occurrences with their Actor, in commit order, and exposes them for review and export. Audit records what happened; it never decides whether it may happen. Each recorded occurrence is one immutable Entry carrying its actor, action, outcome, optional Workspace and target, optional secret-free detail, optional request network context (client IP and user agent), and a tamper-evidence digest chaining it to the previous Entry. The domain performing an operation keeps authority over the operation and supplies Audit the facts; the Entry is durable in the same transaction as the operation, so an operation whose Entry cannot persist rolls back — an unaudited security-relevant mutation must not exist. Entries are retained for a host-configurable period, default one year, and then pruned; pruning is the only deletion. Every committed Entry is additionally emitted as one structured log line for the host's log pipeline. A Workspace administrator reads the Entries of their own Workspace; an Installation Admin reads every Entry; other members read none. Audit is none of its neighbors: Bus delivers live Events and retains nothing, Usage owns inference accounting, and Job tracks process-local execution.

## Right Sidebar

The auxiliary area beside a Session's conversation that displays supporting content. The Right Sidebar owns its visibility, sizing, and sidebar-level interaction; the displayed content owns its own behavior and data. On narrow screens, the open Right Sidebar occupies the conversation area.

## Run

One process-local execution that drains admitted prompts for a Session across model turns and local tool calls. A Session has at most one active Run at a time. Pending prompts and participant Messages are durable; a Run has no durable identity or persisted lifecycle. Interruption or process failure ends the Run without erasing Messages already recorded, and later execution continues from durable Session state.

## Message

One durable participant contribution in a Session. Submitting a prompt records the user's contribution before execution. Each model turn records one assistant contribution whose ordered content may include text, reasoning, and tool calls with their outcomes. Contributions recorded before a Run fails or is cancelled remain part of the Session.
