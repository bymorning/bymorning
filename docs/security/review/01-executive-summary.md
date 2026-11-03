---
title: Executive Summary
---

# Executive Summary

ByMorning is a self-hosted AI gateway that connects the customer's internal
systems to Claude Code, agents, and the models the customer approves. It is
made for aerospace, defense, and other teams that work with controlled data.
People and agents get the same access and the same record; every request is
logged with who asked, what was read, and what came back. ByMorning is open
source, and its releases are reproducible builds. Terms are defined in §2.1.

## Deployment model

ByMorning is delivered as one OCI image, pinned by digest, containing a single
Node 22 process with the embedded web UI, database migrations, and bundled
plugins. The same image serves both reference installers, which the customer
runs in its own cloud account.

The AWS installer is a Terraform module for AWS GovCloud (US) or a commercial
AWS Region. It deploys into an existing customer VPC and creates one ECS
Fargate task behind an Application Load Balancer (internal by default), one
RDS PostgreSQL 17 instance, one S3 bucket, and one customer-managed KMS key. It
also creates one Secrets Manager secret, two CloudWatch log groups, the IAM
roles, and optionally an AgentCore Code Interpreter.

The Azure installer uses Terraform and Kubernetes manifests for Azure
Government or Azure. It runs one Gateway pod on Azure Kubernetes Service with
Azure Database for PostgreSQL Flexible Server, Blob Storage behind a private
endpoint, a Key Vault key for stored Credentials, workload identity, and an
optional Kubernetes Code Interpreter sandbox. §2.4 compares the two.

The ByMorning team has no access to the deployed environment, and the image
makes no telemetry or call-home connection (§9). For the assessment this
means:

- If the customer processes CUI with it, the deployed software and its data
  are CUI assets inside the customer's CMMC assessment boundary, and the
  installer and image are inputs to the customer's own SSP.
- The ByMorning team is not an External Service Provider or Cloud Service
  Provider for this deployment. No CUI leaves the customer's account to any
  system the ByMorning team operates, because none exists in the data path.
- The cloud services the application calls (the database, object storage,
  key service, secrets, logs, and on AWS Bedrock and AgentCore) are the
  customer's own in-account services.
- Optional, admin-enabled integrations (third-party model providers, Google,
  Slack, Atlassian, MCP servers, web-search providers) reach services outside
  the boundary. §9 lists every such endpoint and §6 defines the CUI profile
  that keeps them off.

Evaluation installations, which use filesystem storage, an operator-held local
key, and Local Login on a loopback origin, are out of scope for any CUI or
production deployment. The image refuses them with the CUI profile.

## Security posture

On AWS, browser traffic reaches the load balancer over TLS 1.2 or 1.3 under
`ELBSecurityPolicy-TLS13-1-2-FIPS-2023-04` whenever FIPS endpoints are on,
which is always in AWS GovCloud and by default in US commercial Regions. The
load balancer forwards to the task over TLS 1.2+ with FIPS-approved AES-GCM
suites. The task connects to PostgreSQL over TLS 1.3 with
`sslmode=verify-full` against the RDS CA bundle in the image. The database,
bucket, secret, and log groups are encrypted with the installation KMS key,
which rotates annually. On Azure, TLS terminates at the customer's ingress,
the database requires TLS verified against customer-supplied root CAs, and a
Key Vault RSA key wraps stored Credentials.

All Node.js cryptography runs on the FIPS 140-3 validated RHEL 9 OpenSSL FIPS
Provider (CMVP certificate #4857), and the process refuses to start if the
provider cannot load. The image runs as a non-root user and contains no
package manager.

Browser sign-in is OIDC authorization code with PKCE against the customer's
identity provider, with per-provider admitted email domains. Login Sessions
are durable server-side records, so sign-out and revocation take effect on the
next request, and idle sessions are refused after 15 minutes. Programmatic
access uses ByMorning-issued Keys, stored as hashes, or OAuth tokens from the
application's own MCP authorization server.

Every request resolves to an Actor, a Workspace membership, and a Role (admin
or member). Permission rules (allow, deny, ask) govern Tool execution, and
Workspaces restrict invocable Providers through `providers.allow`.
Security-relevant configuration is restricted to Workspace administrators,
enforced inside the mutation operations themselves so that the in-session
toolkit path is covered too. Installation-scope governance belongs to the
separate Installation Admin role, and the Installation Policy clamps every
Workspace.

Security-relevant mutations append hash-chained, tamper-evident Audit Entries
in the same transaction, fail-closed; Entries persist in PostgreSQL and mirror
to the container log as structured JSON for SIEM ingestion. The web edge emits
strict response headers, limits CORS to the application origin, rate-limits
the public authentication endpoints, and screens WebFetch destinations against
non-public addresses. Code execution runs in a sandbox with no network access:
an AgentCore Code Interpreter whose security group has no rules on AWS, or
per-call pods under a deny-all NetworkPolicy on Azure. The only outbound
connections the image requires are cloud service endpoints and the identity
provider.

## Control summary

The control mapping (§4) covers all 110 NIST SP 800-171 Rev 2 requirements.
Responsibility splits as 51 Shared, 44 Customer, 7 Software, and 8 Inherited
from the cloud provider.

| Software status | Count (of 110) |
| --------------- | -------------- |
| Implemented | 52 |
| Partially, with a named gap in §12 | 7 |
| Organizational or inherited | 51 |

## Key risks and limitations

1. Single-task availability. One task or pod runs by design because OAuth
   callback state and the scheduler are process-local. Upgrades and crashes
   cause a short interruption until the replacement starts. This is an
   availability trade-off, not a data-integrity risk.
2. Database access pattern. Both installers connect the application as the
   database administrator user; a least-privilege database role is not
   automated (§12). The connection is TLS with server verification. On AWS
   the database admits only the task security group; on Azure it has no
   public network access.
3. Self-signed target certificate. On AWS the load-balancer-to-task hop uses
   a self-signed certificate that the load balancer does not validate. The hop
   is encrypted but not authenticated, and the task security group admits
   port 3210 only from the load balancer.
4. Bedrock Mantle IAM scope. The AWS installer grants
   `bedrock-mantle:CreateInference` on the account's `project/default` Mantle
   project, the only project Mantle supports. Bedrock model invocation is
   limited to the explicit `bedrock_model_arns` list, wildcards are refused,
   and neither grant exists when the list is empty.
5. FIPS endpoint designation. With FIPS endpoints on, S3, KMS, Bedrock
   Runtime, and AgentCore traffic routes to FIPS-designated hostnames. No
   FIPS-designated Mantle endpoint exists, so Mantle keeps the standard
   hostname (§12). Client-side cryptography stays on the validated module
   regardless.
6. Administrator-configured outbound endpoints. Outbound MCP servers and
   custom Providers are arbitrary endpoints and the main way data could leave
   the boundary if enabled without authorization. §6 and §9 treat them as
   must-not-enable for CUI unless authorized.
7. Customer-supplied monitoring. The AWS installer configures no WAF, load
   balancer access logs, alarms, GuardDuty, CloudTrail data events, or VPC
   endpoints; the customer adds them to its account standards (§5).
8. Evaluation installations. Evaluation mode gives up managed key custody,
   storage encryption, and identity-provider sign-in, and is out of scope for
   any CUI or production deployment.

Open items and their interim mitigations are tracked in the POA&M (§12).
