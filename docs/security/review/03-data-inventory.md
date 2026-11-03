---
title: Data Inventory and CUI Data Flows
---

# Data Inventory and CUI Data Flows

CUI enters only through authenticated channels (browser Sessions, Project file
uploads, Tool results, and API callers) and persists only in the customer's
cloud account or subscription. Model inference processes it transiently in
the Model Providers the customer admits, and code execution processes it in a
sandbox with no network access.

## 3.1 CUI data flow

Figure 3-1 traces where CUI enters, is processed, persists, and can leave.

![[figure:3-1]]

_Figure 3-1 — CUI data flow. CUI enters only through authenticated channels,
is processed in the Gateway and the no-network sandbox, and persists only to
encrypted stores in the customer's account or subscription._

## 3.2 Database content

PostgreSQL 17 is the primary store on both installers: Amazon RDS for the AWS
installer and Azure Database for PostgreSQL Flexible Server for the Azure
installer. Only the Gateway can reach it, and connections require TLS (§7.1).
Sessions and their dependents are hard-deleted; Account, User, and Workspace
records are soft-deleted.

| Tables | Content | CUI | Retention and deletion |
| ------ | ------- | --- | ---------------------- |
| `session*` | Session titles; participant and assistant Messages including reasoning and Tool calls; queued prompts | Yes, the primary CUI store | Until a member deletes the Session (recursive hard delete) |
| `instruction_*`, `project`, `scheduled_task` | Admin-authored guidance text; Project names; task prompts and schedules | Yes | Until deleted by the owner or an administrator |
| `workspace*`, `agent`, `skill`, `kv` | Provider allowlist, Routing rules, Agent definitions, Skills, general key/value | Possibly, as free text | Until deleted; Workspace deletion cascades |
| `usage`, `budget_*`, `tool_usage` | Model usage and cost by Workspace, User, or Service Account; Tool invocations | No (metadata) | Tied to the Workspace lifetime |
| `account`, `auth`, `user`, `login_session` | Email, Auth Provider subject links, membership and Role, Account status; Login Session records without token material | No (PII) | Soft delete; suspension is immediate and revokes Login Sessions and grants |
| `auth_provider`, `installation*`, `credential` | OIDC issuer, client ID, client secret (Cipher envelope), admitted domains; setup-token hash; Installation Policy and admin grants; Integration secrets (Cipher envelope) | No (secrets) | For the Installation's life; protect database and backup access accordingly |
| `service_account`, `api_key`, `oauth_*` | Service Accounts; API key hashes and metadata; OAuth clients, authorizations, and token hashes | No | Until revoked; access tokens expire in 1 hour, refresh tokens 30 days after the grant |
| `permission_saved` | Workspace and User Permission rules | No | Until an administrator deletes the rule |
| `audit_entry` | Principal, action, target, secret-free detail, request network context, hash chain | No (metadata) | `AUDIT_RETENTION_DAYS` (default 365); only the retention pruner deletes |
| `project_purge` | Storage prefix of a deleted Project | No | Until the purge worker drains the prefix |

Login Sessions end after 15 minutes of inactivity and 12 hours in total by
default (§6.2).

## 3.3 Data stores by installer

The object store holds member-uploaded Project files (CUI, until deleted),
large Tool outputs under `tool-output/` (CUI, expiring after 7 days), and
plugin-scoped key/value state. The two installers place each class of data as
follows.

| Store | AWS installer | Azure installer |
| ----- | ------------- | --------------- |
| Database | RDS PostgreSQL 17, one instance, not publicly accessible; storage and automated backups encrypted with the installation KMS key | Flexible Server 17 in a delegated subnet with private DNS and no public access; encrypted at rest with Microsoft-managed keys |
| Database backups | Automated backups for 7 days by default; a final snapshot is kept on destroy | Point-in-time restore backups for 14 days by default |
| Object store | S3 bucket, SSE-KMS with the installation key, all public access blocked, TLS-only bucket policy, versioned | Blob container behind a private endpoint, Entra ID access only (shared keys disabled), Microsoft-managed keys with infrastructure encryption, versioned |
| Object retention | `tool-output/` expires after 7 days; replaced versions after 30 days | `tool-output/` expires after 7 days; deleted blobs and containers are recoverable for 14 days; previous versions are kept until the customer adds a lifecycle rule |
| Runtime secrets | One Secrets Manager secret (database URL, cookie key, listener key, Setup token), encrypted with the installation key, 7-day recovery window | Kubernetes Secret `bymorning` (database URL, cookie key, PostgreSQL CA, optional Setup token and identity-provider seed) and, with a Bedrock API key, Secret `bymorning-bedrock`; the database password and cookie key are also Key Vault secrets |
| Credential envelope key | The installation KMS key; 30-day deletion window | Key Vault RSA key; the vault has 90-day soft delete and purge protection |
| Logs | CloudWatch log groups for the application and the PostgreSQL log, encrypted with the installation key, 90-day retention by default | Container logs on the nodes; with `log_analytics`, a Log Analytics workspace with 90-day retention by default |
| Terraform state | Holds every generated secret | Holds the database password and cookie key |

The application log carries structured INFO lines and the Audit Entry mirror
lines, never prompts or secret values; operational errors can carry request
context. The PostgreSQL log can contain whatever a statement error exposes.
Neither installer enables S3 or Blob access logging, Object Lock, or
immutable storage; §6.1 lists what the customer adds.

The browser holds only encrypted Login Session and OIDC-attempt cookies.
Rendered CUI exists in page content while in use, and browser cache posture is
the customer's endpoint policy.

## 3.4 Data leaving the boundary

| Path | Destination | Content | Control |
| ---- | ----------- | ------- | ------- |
| OIDC | The customer's identity provider | Client ID, redirect URIs, code exchange, ID token | Required for authentication; carries no application data |
| Inference | Amazon Bedrock and Bedrock Mantle in the configured Region | Prompts, context, Tool content, routing-judge inputs | Task role limited to the listed model ARNs; the Installation Policy admits only `amazon-bedrock` in the CUI profile (§6.2) |
| Code execution | AgentCore Code Interpreter in the same account, or Kubernetes sandbox pods in the same cluster | Code and its output | Sandbox has no network access (§2.9) |
| Share | Any holder of the link who can reach the load balancer | Live Session transcript | Not loaded in the CUI profile; where enabled, an unguessable revocable token |
| Downloads | Member's workstation | Whatever the member exports | Customer endpoint controls |
| Optional integrations | Third-party Model Providers, web search, MCP servers, and SaaS plugins (§9.3) | Whatever the configured Tool or Provider sends | Off in the CUI profile; must not be enabled for CUI unless authorized |
| OTLP telemetry | A collector the customer chooses | Traces and logs (metadata) | Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; point it inside the boundary |

A cross-Region inference profile can serve a request in any Region it routes
to, and the AWS installer's IAM policy must name the foundation model in each
of those Regions. The customer chooses profiles whose Regions meet its data
residency requirements. AgentCore code execution sessions end after at most
900 seconds.

## 3.5 ITAR and EAR notes

With the CUI profile (§6), processing and storage stay in the customer's
account or subscription and the AWS Regions it selects. The image makes no
call to ByMorning: no telemetry, no update check, and a model catalog fixed at
build time.

The residual export-control risk is configuration. Enabling a non-Bedrock
Model Provider, an external MCP server, or a SaaS integration sends whatever
the member is working on to that service. §9 lists every such endpoint, and
the Installation Policy plus Outbound MCP Enablement let administrators keep
them off. Access control for export-controlled data rests on the customer's
identity provider: ByMorning admits a person only if the provider verifies
them and their email domain is admitted. Person-level restrictions, such as
U.S.-person status, are enforced by the customer in the identity provider.
