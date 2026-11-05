---
title: System Architecture and Trust Boundaries
---

# System Architecture and Trust Boundaries

One Node 22 process serves the UI and API behind the customer's load balancer
or ingress, with no agents or vendor-operated components. CUI persists only in
stores in the customer's own cloud account and transits only to the customer's
cloud services and to the customer's identity provider, which receives
authentication exchanges rather than CUI. The same image runs under both
reference installers: AWS (ECS Fargate) and Azure (Azure Kubernetes Service).

## 2.1 Key concepts

| Term | Meaning |
| ---- | ------- |
| Installation | One deployed ByMorning; owns the Auth Providers, Setup state, Installation Admins, and Installation Policy. |
| Installation Admin | An Account with installation-wide authority over Auth Providers, the Installation Policy, and Account suspension. Not a Workspace Role. |
| Installation Policy | An installation-owned clamp on every Workspace's configuration. A Workspace may tighten it, never loosen it. |
| Workspace | The installation-owned container for configuration and records. |
| Member, Role | A Member is a User's binding to one Workspace; the Role (admin or member) is its permission set. |
| Session, Login Session | A Session is a durable conversation with its Message history. A Login Session is a durable, revocable grant of browser access for one Account, bounded at 15 minutes idle and 12 hours absolute by default. |
| Auth Provider | An OIDC login target: issuer, client credentials, admitted email domains. |
| Tool, Permission rules | A Tool is one registered callable operation (built-in, Plugin-contributed, or MCP-supplied). Permission rules allow, deny, or ask before a Tool executes. |
| Plugin | An in-process extension with full process privileges. The image ships seven bundled plugins; runtime installs fail closed. |
| Code Interpreter | Isolated execution of commands and programs in a sandbox with no network connections (public DNS names still resolve on AWS, §2.9): an AWS Bedrock AgentCore Code Interpreter on AWS, or per-call Kubernetes pods on Azure. |
| MCP, Tool Gateway, LLM Gateway | Outbound MCP connects admin-enabled external servers as Tool sources. The Tool Gateway exposes ByMorning Tools to authorized external MCP callers; the LLM Gateway offers OpenAI-, Anthropic-, and Google-compatible inference endpoints. |
| Provider, Model routing | A Provider is a named inference endpoint such as `amazon-bedrock`, admitted per Workspace through `providers.allow`. Routing rules choose which Model serves a request; Auto models resolve only through routing, and a routing judge is an administrator-chosen Model that classifies a request to pick a Tier. |
| Share | A revocable public read grant on one Session transcript, identified by an unguessable token. Not loaded in the CUI profile. |
| Credential, Cipher | Persisted secret material for one Integration, encrypted at rest by the Cipher: AES-256-GCM data keys wrapped by the installation key (an AWS KMS key or an Azure Key Vault key). |
| Service Account, Key | A Workspace-owned automation identity acting through Keys (ByMorning-issued API keys, of which only hashes persist). |
| Spend Limit | The monthly inference spend cap for one Workspace, User, or Service Account. |
| Audit Entry | One immutable, hash-chained record of a security-relevant mutation, persisted in the same transaction and mirrored to logs. |
| Setup | The state before an Auth Provider exists; the setup token registers the first one and remains the recovery path. |

## 2.2 System context

Users reach the Installation from the customer's network through the load
balancer or ingress (Figure 2-1). Browser sign-in is delegated to the
customer's identity provider over OIDC: Microsoft Entra ID, Okta, Google
Workspace, or any OIDC provider. Inference runs against Amazon Bedrock under
the CUI profile, and code execution runs in the Code Interpreter sandbox in the
same account. All other external capabilities exist in the software but stay
disabled until an administrator enables them: third-party model providers,
Google, Slack, Atlassian, generic MCP servers, and web-search providers. They
remain outside the CUI boundary unless the customer explicitly authorizes them
(§9).

![[figure:2-1]]

_Figure 2-1 — System context. Dashed links are disabled by default and must not
be enabled for CUI workloads without the customer's authorization._

## 2.3 Process view

The image runs one Node 22 process listening on port 3210, with plugins in the
same process. The listener serves HTTPS when the installer supplies a
certificate and key, which the AWS installer always does; the Azure manifests
serve plain HTTP inside the cluster behind the TLS-terminating ingress unless
the customer adds them. Durable state lives only in PostgreSQL and object
storage. Every response carries hardening headers, and the application UI
carries a strict CSP with `frame-ancestors 'none'` (SEC-HDR). Audit Entries
persist in PostgreSQL, mirror to stderr as structured JSON, and are pruned
after `AUDIT_RETENTION_DAYS` (default 365) (SEC-AUDIT).

The `migrate` command runs the embedded migrations under a PostgreSQL advisory
lock, reads only the database settings, and must exit 0 before the serving
process starts; the serving process never migrates. One Gateway runs at a time
by design, because OAuth callback state and the scheduler are process-local,
so an upgrade stops the old process before the new one starts.

## 2.4 Reference deployments

The AWS installer is a Terraform module that deploys into a VPC the customer
already owns, in AWS GovCloud (US) or a commercial AWS Region; the Region
selects the partition. One ECS Fargate task runs two containers from the image:
`migrate`, then `gateway`, which starts only after `migrate` succeeds. An
Application Load Balancer, internal by default, terminates TLS with the
customer's ACM certificate. The module creates one RDS PostgreSQL 17 instance,
one S3 bucket, one customer-managed KMS key, one Secrets Manager secret, two
CloudWatch log groups, the IAM roles, and optionally an AgentCore Code
Interpreter. ECS Exec is disabled, so no shell access to the task exists.

The Azure installer uses Terraform for the network, an AKS cluster, Azure
Database for PostgreSQL Flexible Server, Blob Storage, Key Vault, and an
optional container registry, and Kustomize manifests for the workload. One
Gateway pod runs with the `Recreate` strategy, and `migrate` runs as its init
container. Blob Storage and Key Vault are reached through private endpoints
with workload identity, and the optional Kubernetes Code Interpreter runs
per-call sandbox pods.

| Aspect | AWS installer | Azure installer |
| ------ | ------------- | --------------- |
| Compute | ECS Fargate, one task; `migrate` then `gateway` in the same task; deployment circuit breaker with rollback | AKS, one replica, `Recreate`; `migrate` init container; non-root, read-only root filesystem |
| Ingress | ALB, internal by default; ingress only from `allowed_cidrs` on 80 and 443; port 80 redirects to 443; invalid headers dropped | Customer ingress controller (NGINX by default) with the customer's TLS certificate |
| TLS policy | `ELBSecurityPolicy-TLS13-1-2-FIPS-2023-04` when FIPS endpoints are on, else `ELBSecurityPolicy-TLS13-1-2-2021-06` | Set by the customer's ingress |
| Ingress-to-Gateway hop | HTTPS to a module-issued self-signed ECDSA P-256 certificate the ALB does not validate; renewed yearly | Plain HTTP inside the cluster unless the customer supplies listener TLS |
| Database | RDS PostgreSQL 17, one instance (Multi-AZ optional), not publicly accessible, TLS 1.3 required, `verify-full` against the RDS CA bundle in the image, deletion protection, 7-day backups by default | Flexible Server 17 in a delegated subnet with private DNS, no public access, TLS 1.2+ required, verified against customer-supplied root CAs, 14-day backups by default |
| Object storage | S3, SSE-KMS, public access blocked, TLS-only bucket policy, versioned | Blob Storage, private endpoint, Entra ID only (shared keys disabled), versioned |
| Encryption at rest | One KMS key for the database, bucket, secret, and log groups; annual rotation | Azure service-managed keys; Blob adds infrastructure encryption |
| Stored Credentials | Wrapped by the KMS key, usable only with encryption context `bymorning=cipher` | Wrapped by a Key Vault RSA key (software or HSM-backed); rotation at 18 months, expiry at 2 years |
| Runtime secrets | One Secrets Manager secret, injected as ECS container secrets | Kubernetes Secret, or Key Vault through the CSI driver with a customer-supplied provider class |
| Cloud identity | IAM task role with named resources only | Workload identity (managed identity) with Blob and Key Vault data roles |
| Code Interpreter | Optional AgentCore Code Interpreter in VPC mode; its security group has no rules | Optional per-call pods under a deny-all NetworkPolicy; optional Kata VM isolation |
| Amazon Bedrock | Task role limited to the listed model ARNs | Optional, through web identity federation or a Bedrock API key |
| FIPS endpoints | Always in AWS GovCloud, default in US commercial Regions | Set for Bedrock in a GovCloud Region; FIPS node pools optional |
| Setup token | Generated by the module; read with `terraform output -raw setup_token` | Generated by the Gateway and read from its setup-token file, or supplied |
| Logs | CloudWatch, KMS-encrypted, 90-day retention by default; Container Insights | Optional Log Analytics workspace with Container Insights |

On AWS, Terraform generates `DATABASE_URL`, `WEB_COOKIE_KEY`, the listener key
`TLS_KEY`, and `SETUP_TOKEN`, stores them in the KMS-encrypted runtime secret,
and injects them only as ECS container secrets. They also exist in Terraform
state, so the state backend must be private and encrypted; the same applies to
the database password and cookie key in the Azure installer's state.

The ECS execution role pulls the image, writes logs, and reads the one runtime
secret, decrypting only through Secrets Manager. The task role grants S3
object operations on the storage bucket and use of the KMS key only through
S3. It may use the key for Credential envelopes only with encryption context
`bymorning=cipher`, and holds the four AgentCore session actions on the one
Code Interpreter when it is enabled. For inference it grants `bedrock:InvokeModel`
and `InvokeModelWithResponseStream` on the explicit `bedrock_model_arns` list,
refusing wildcards, and `bedrock-mantle:CreateInference` on the account's
`project/default`; neither exists when the list is empty. Both role trust
policies are pinned with `aws:SourceAccount` and `aws:SourceArn`, and the Code
Interpreter execution role has no permission policies.

The `cui_profile` setting selects the CUI installation document (AgentCore
only; the Share and Google plugins are not loaded) and requires the Code
Interpreter. §6 lists the remaining CUI settings.

## 2.5 Network flows

On AWS, all application flows are TLS on TCP/443 except the ALB-to-task hop
(TCP/3210, TLS) and the task-to-database hop (TCP/5432, TLS 1.3). The only
plaintext listener is the ALB port-80 redirect.

| # | Source | Destination | Port | TLS | Purpose |
| - | ------ | ----------- | ---- | --- | ------- |
| 1 | Browser, automation | ALB | 443 | TLS 1.2–1.3 under the FIPS policy when FIPS endpoints are on | UI, API, OIDC redirects, `/inference`, `/mcp` |
| 2 | Browser, automation | ALB | 80 | none | 301 redirect to 443 only |
| 3 | ALB | Task | 3210 | TLS 1.2+, FIPS-approved AES-GCM suites; self-signed target certificate, not ALB-validated | Forwarded traffic; health check `/system/health` |
| 4 | Task | RDS PostgreSQL | 5432 | TLS 1.3 required by the parameter group; `sslmode=verify-full` against the RDS CA bundle in the image | All persistence |
| 5 | Task | S3, KMS, Bedrock Runtime and Mantle, AgentCore | 443 | AWS-managed, SigV4; FIPS hostnames when enabled, except Mantle | Object storage, data keys, inference, Code Interpreter sessions |
| 6 | ECS agent | ECR or `ghcr.io`, Secrets Manager, CloudWatch Logs | 443 | AWS-managed or registry TLS | Image pull by digest, secret injection, logs |
| 7 | Task | Identity provider | 443 | TLS | OIDC discovery, JWKS, token, userinfo |
| 8 | Task | Optional integrations | 443 | TLS | Admin-enabled only (§9) |

The load balancer security group admits only `allowed_cidrs` on 80 and 443 and
sends only to the task on 3210. The task security group admits only the load
balancer on 3210 and sends 5432 to the database and 443 to any address. The
customer constrains that 443 egress with NAT and egress controls or VPC
endpoints. The database security group admits only the task.

On Azure, the ingress controller forwards to the pod on 3210 inside the
cluster, the pod reaches PostgreSQL on 5432 over TLS 1.2 or later, and Blob
Storage and Key Vault over 443 through private endpoints with Entra ID
tokens. The pod also needs 443 to the identity provider and, when enabled, to
AWS STS and Bedrock and to the Kubernetes API for sandbox pods. The cluster's
outbound type (load balancer, NAT gateway, or the customer's firewall) governs
the rest.

## 2.6 Trust boundaries

Figures 2-5a and 2-5b are the data flow diagram with the nine trust boundaries
the threat model (§10) analyzes: 2-5a shows the external and user-facing
boundaries, 2-5b the internal data, inference, and execution boundaries. B6 is
in-process plugin execution, B7 the application's own OAuth authorization
server, B8 the anonymous Share plane (not loaded in the CUI profile), and B9
the admin-versus-member privilege boundary inside the application; these are
the same on both installers. B5 covers optional external integrations, which
stay off until an administrator configures them (§6). The infrastructure
boundaries are enforced as follows.

| Boundary | AWS installer | Azure installer |
| -------- | ------------- | --------------- |
| B1 user plane | ALB admits only `allowed_cidrs`; task admits 3210 only from the ALB security group | Customer ingress and its network exposure; the Gateway Service is cluster-internal (ClusterIP) |
| B2 data plane | Database admits 5432 only from the task security group; S3 and the KMS key only through the task role; TLS-only bucket policy | Database in a delegated subnet without public access; Blob and Key Vault only through private endpoints and workload identity |
| B3 inference | Bedrock in the deployment's partition, SigV4 with the task role, listed models only | Bedrock in the customer's AWS account, through web identity federation or an API key, when enabled |
| B4 execution | AgentCore in VPC mode; security group with no ingress or egress rules | Sandbox pods under a deny-all NetworkPolicy, which the plugin requires before it executes code |

![[figure:2-5a]]

_Figure 2-5a — Data flow diagram, external boundaries (B1, B5–B9). Dashed nodes
and links are external or admin-enabled and sit outside the CUI boundary unless
the customer authorizes them; the identity provider receives authentication
exchanges, not CUI._

![[figure:2-5b]]

_Figure 2-5b — Data flow diagram, internal boundaries (B2–B4). CUI crosses B2
and B4 only to services in the customer's account, and B3 only to Amazon
Bedrock in the customer's AWS account. The Gateway node repeats from Figure
2-5a._

## 2.7 Authentication and Login Sessions

Browser authentication is OIDC authorization code with PKCE (S256), run by the
server against the registered Auth Provider. The identity provider verifies
the person, including MFA and offboarding. ByMorning verifies the protocol
(state, nonce, ID-token signature against the provider's JWKS, issuer,
audience, expiry), resolves the Account, and creates the Login Session;
identity-provider tokens are discarded after the exchange, and only the
verified subject and email persist.

Every Login Session is a durable server-side record. The `__Host-bm_auth`
cookie carries only its identity and absolute expiry and is `Secure`,
`HttpOnly`, `SameSite=Lax`, host-locked, and AES-256-GCM encrypted with
`WEB_COOKIE_KEY`. Each authenticated request re-checks the record and that the
Account is active, so sign-out, revocation, identity-provider offboarding, and
suspension take effect on the next request. A session is refused after
`SESSION_IDLE_TIMEOUT` (default 15 minutes) without activity and at
`SESSION_ABSOLUTE_TIMEOUT` (default 12 hours), and the web app locks its
display at the same point (SEC-SESS). State-changing requests additionally
require an `Origin` header equal to `APP_ORIGIN`.

The setup token registers the first Auth Provider and is the recovery path if
the identity-provider configuration breaks. It is never logged, and only its
hash persists (SEC-SETUP). The AWS installer supplies it as `SETUP_TOKEN` from
a sensitive Terraform output. When the Gateway generates it instead, it is
revealed only in an owner-read-only file, which is removed once an Auth
Provider exists.

## 2.8 API request authorization

Every non-public API request resolves an Actor, a Workspace membership, and a
Role before any capability runs; public endpoints are limited to
`/system/health`, the login, setup, and callback flow, OAuth metadata and
consent, and Share transcript views. A Key belongs to a Service Account in one
Workspace, and only its hash and metadata persist. MCP clients obtain access
tokens from the application's own OAuth authorization server. It offers
dynamic client registration, authorization code with PKCE, one-hour access
tokens, and rotating refresh tokens, all stored as hashes, with consent
binding each grant to one Account, Workspace, and Role. A Tool that requires
interactive approval is not implicitly authorized for external Tool Gateway
execution. LLM Gateway requests reserve spend against the Workspace and caller
and pass the Limiter before any Provider exchange.

Security-relevant control-plane mutations require the admin Role at the HTTP
handler (SEC-AUTHZ); §6.2 lists the covered configuration sections. The same
rule is enforced again inside the mutation operations themselves, so
in-session toolkit Tools, Code Mode, Scheduled Tasks, and the Tool Gateway are
refused identically when the acting member is not an admin (SEC-TOOLAUTHZ).

## 2.9 Code execution isolation

On AWS, the Code Interpreter runs commands and programs in the AWS Bedrock
AgentCore Code Interpreter: a per-session sandbox in VPC mode whose security
group has no rules at all, with sessions bounded at 900 seconds. The sandbox
boundary is enforced by AWS rather than by the application.

A test against a deployed AWS installer (its sandbox checklist) shows what
"no network" means in practice. Outbound connections of any kind time out, and
code in the sandbox cannot reach the customer's VPC addresses. Two things still
work. The sandbox resolves public DNS names through the VPC resolver, which a
security group does not govern, so DNS can carry data out one query at a time.
And the microVM's own metadata service answers on `169.254.169.254` and issues
temporary credentials for the Code Interpreter's execution role. The AWS
installer attaches no permissions to that role, so those credentials grant
nothing. A customer who attaches permissions to it exposes them to any code the
sandbox runs. Customers who must close the DNS channel need DNS firewalling on
the subnets the interpreter uses (§6.1.1).

On Azure, each call runs in a short-lived pod in a dedicated namespace, from a
digest-pinned execution image; the Gateway refuses to start with a tag-only
image. The plugin refuses to execute unless a deny-all NetworkPolicy selects
the sandbox pods, so the cluster's network policy engine enforces the
boundary. Kata VM isolation on a dedicated node pool adds a hardware
virtualization boundary when the customer enables it.

## 2.10 Model routing and provider selection

Workspace-owned Routing rules choose which Model serves a request, and reserved
Auto model names resolve only through Routing. The CUI configuration sets
`providers.allow` to `amazon-bedrock` only, in the Installation Policy and in
each Workspace (§6.2). Every resolution, including Auto names and
routing-judge calls, then lands on Amazon Bedrock. A routing judge sees only
participant-written turns, never Tool results or file content, and an
unresolved Auto name or inadmissible Tier refuses the request rather than
falling back silently. The model catalog is pinned into the image at build
time; nothing is fetched from a model registry at runtime.

## 2.11 Plugins, Tools, and secrets at rest

Plugins run in-process with the process's full privileges. The image contains
the seven bundled plugins; runtime installation of additional plugins needs a
package manager the image does not contain, so external installs fail closed,
and no Workspace can loosen the Installation Policy `plugins` allowlist
(SEC-INST). All Tools, whether built-in, Plugin-contributed, or MCP-supplied,
execute through the same Permission evaluation.

Persisted secrets (Credentials, including Integration OAuth tokens, and Auth
Provider client secrets) are encrypted with a fresh AES-256-GCM data key
wrapped by the installation key (SEC-CRYPT). On AWS that is the KMS key, used
only with encryption context `bymorning=cipher`; on Azure it is the Key Vault
RSA key. Each envelope names the key that wrapped it, and a different key
refuses it rather than returning wrong data. Tokens issued by the
application's own OAuth server and the setup token are stored as SHA-256
digests. §7 covers the envelope format and rotation.
