---
title: Customer Responsibility Matrix
---

# Customer Responsibility Matrix

The ByMorning team has no production access; everything below is operated by
the customer. Each family lists what the customer must do and which software
settings complete the objective. The AWS installer is deliberately minimal:
it leaves WAF, load balancer access logs, GuardDuty, CloudTrail, alarms, S3
Object Lock, VPC endpoints, egress filtering, and key administrator roles to
the customer's account standards. Administrators may make risky choices, such
as enabling a Provider outside the authorized boundary; doing so moves data
outside the assessed CUI boundary and is the customer's authorization
decision. Members can never change security settings, on either the HTTP or
the in-session toolkit path (SEC-AUTHZ, SEC-TOOLAUTHZ).

Every production installation keeps `BYMORNING_EVALUATION` unset. An
evaluation installation offers Local Login to anyone who reaches its port,
holds its master key in the process environment, and stores files
unencrypted; it is never a CUI or production configuration.

## 5.1 Access Control (3.1)

| The customer must do | Software settings the customer must set |
| -------------------- | --------------------------------------- |
| Operate the OIDC identity provider (Microsoft Entra ID, Okta, Google Workspace, or another OIDC provider): enforce MFA for all users, account lockout thresholds, and token and session lifetime policy. The application does not verify `amr`; the identity provider is the MFA enforcement point. | Register the Auth Provider with the exact redirect URI shown in Setup (`https://<hostname>/auth/callback/<providerID>`) and set the admitted email domains. |
| Own the account lifecycle: provisioning, role assignment, deprovisioning within policy timelines, quarterly access reviews. | Assign the `member` Role for daily use and grant `admin` sparingly. Remove Workspace membership on transfer and suspend Accounts on termination (§14.7, SEC-INST). |
| Authorize every external system connection (LLM providers, MCP servers, plugins). | `providers.allow` admits only authorized Providers (Amazon Bedrock for CUI); Outbound MCP Enablement off except approved internal servers; no third-party plugins (SEC-AUTHZ). |
| Operate the Installation Admin role: grant it to named Accounts only and review grants quarterly. | Set the Installation Policy: invite-only provisioning, authorized providers only, share off, web search off, plugin allowlist. No Workspace can loosen it (SEC-INST). |
| Restrict network ingress to managed access points. | AWS: keep `internal = true` and set `allowed_cidrs` to VPN or proxy ranges only. Azure: restrict the ingress controller and set `TRUSTED_PROXIES` to its addresses. |
| Enforce endpoint session lock on workstations and VDI. | `SESSION_IDLE_TIMEOUT` (default 15 min) refuses inactive sessions and the web app locks with a pattern-hiding overlay (SEC-SESS). |
| Authorize remote maintenance. | The AWS installer disables ECS Exec and offers no other command path. On Azure, restrict `kubectl` with `admin_group_object_ids` (Azure RBAC, local accounts disabled) and keep the private API server. |

## 5.2 Awareness and Training (3.2)

Provide role-based training (administrators: §6 and §14; members:
public-posting policy and prompt-injection awareness per §10) and run
insider-threat and phishing programs. The software contributes the login banner
text approved by the security office (`login_banner`, SEC-BANNER); OIDC removes
application passwords, so phishing resistance rides on identity provider MFA.

## 5.3 Audit and Accountability (3.3)

| The customer must do | Software settings the customer must set |
| -------------------- | --------------------------------------- |
| Set the log retention policy and review the application and PostgreSQL log groups and the identity provider's sign-in logs. | `log_retention_days` (default 90) to the retention the policy requires, or export to longer-term storage. On Azure, enable `log_analytics` or ship container logs to the SIEM. |
| Review the Audit trail: Workspace administrators for their own Workspace in the Console, the Installation Admin installation-wide. Ingest the Audit lines into the SIEM. | `AUDIT_RETENTION_DAYS` (default 365); keep `AUDIT_STDOUT` on so every Entry mirrors to the log stream as one JSON line (`type=audit.entry`). |
| Enable account-level audit and detection, none of which the installer configures: CloudTrail (including S3 data events), load balancer access logs, GuardDuty, AWS Config, Security Hub, and VPC flow logs. | None; use the queries in §14.6. |
| Alert on logging pipeline failure and on service health; the installer creates no alarms or notification topics. | None; the Audit trail fails closed, so a mutation whose Entry cannot persist is rolled back (SEC-AUDIT). |
| Restrict audit-log and KMS administration to named individuals in IAM. | In-app Audit reads are limited to Workspace administrators and the Installation Admin. |

## 5.4 Configuration Management (3.4)

Run change control on the Terraform configuration so that only the pipeline
applies, and protect its state backend: it holds every generated secret
(POA&M-21). Use a private, encrypted, access-restricted backend with state
locking. Verify each release image's keyless signature before use (§8.3) and
set `image` to its digest; the AWS installer refuses a tag, while the Azure
overlay accepts one, so pin the digest there too. Maintain the configuration
baseline (image digest, installer version, `terraform.tfvars`, and the
application settings in §6), with `cui_profile = true` on AWS. Review release
notes, SBOMs, and provenance per release (§13). Disable unused integrations
and plugins.

## 5.5 Identification and Authentication (3.5)

Run the identifier lifecycle in the identity provider: unique identities,
disablement on departure, and password policy (the application holds no
passwords). Enforce MFA at the identity provider for all network access to
the application and verify that the policy covers the ByMorning application
registration. Take custody of the Setup token: on AWS, read it once with
`terraform output -raw setup_token`, or supply a token from a secret store
through the `setup_token` variable. The token stays valid as the
recovery path for a broken Auth Provider, so restrict who can read Terraform
outputs, state, and the runtime secret. On Azure, read it from the pod or
supply it as `SETUP_TOKEN`. Rotate and expire ingress Keys and Service
Accounts; their management is admin-only (SEC-AUTHZ).

## 5.6 Incident Response, Maintenance, Personnel, and Physical Protection (3.6, 3.7, 3.9, 3.10)

Own the incident response plan, including the DFARS 252.204-7012 obligation to
report cyber incidents to DoD via DIBNet within 72 hours and to preserve
forensic images for 90 days. Evidence preservation, emergency session
revocation, and integration shutdown are documented in §14.8, and the advisory
channel in §13. Schedule and control maintenance
through the upgrade runbook (§14.3): snapshot the database, verify the new
image, set its digest, and apply. Migrations only move forward, so returning
to an earlier release means restoring that snapshot. Require MFA for console,
CLI, and cluster access. Screen personnel before access and run the
offboarding runbook (§14.7) on termination or transfer. Physical controls
(3.10.1–3.10.5) are inherited from the cloud provider; protect administrator
workstations and alternate work sites.

## 5.7 Media Protection (3.8)

Media handling, marking, sanitization, and removable-media policy are
organizational. Application data at rest is encrypted in RDS and S3 with
public access blocked. Set `database.backup_retention_days` (default 7) to the
backup policy, add AWS Backup or cross-account copies if required, and enable
S3 Object Lock or replication if immutability is required; the installer
configures neither. Restrict snapshot export, copy, and sharing through IAM
and the key policy. On Azure, set `postgres_backup_days` (default 14) to the
policy.

## 5.8 Risk and Security Assessment (3.11, 3.12)

Run periodic risk assessments using §10 and §12 as inputs, scan the deployed
environment, and consume the SBOMs, scan reports, and OpenVEX statements
produced per release (§8). Author and maintain the SSP and the organizational
POA&M within the CMMC 180-day closeout for eligible items.

## 5.9 System and Communications Protection (3.13)

| The customer must do | Software settings the customer must set |
| -------------------- | --------------------------------------- |
| Boundary protection: WAF if required, VPC flow logs, and egress filtering. The task security group allows HTTPS to any address, so constrain it with NAT egress rules, a firewall, or VPC endpoints plus an approved route to the identity provider. | Keep `internal = true` unless an internet-facing load balancer is expressly authorized. On Azure, use `outbound_type = "userDefinedRouting"` through the customer's firewall. |
| Key administration and cryptographic inventory. The key policy delegates to account IAM, so define key administrator and key user roles and never schedule the key for deletion while data or snapshots exist. | The installation KMS key rotates annually (rotation runbook in §14.5). On Azure, choose `key_vault_sku` (`premium` for HSM-backed keys). |
| Deploy the FIPS configuration. | The image is the FIPS image: UBI 9 Node.js 22 with the RHEL 9 OpenSSL FIPS Provider, CMVP #4857 (§7, SEC-IMG). Keep `fips_endpoints` at its default in US Regions; AWS GovCloud forces it on. On Azure, set `fips_node_pools = true`. |
| Approve mobile code. | Only admin-approved plugins; on AWS, `code_interpreter = true` with `cui_profile = true` loads only the AgentCore Code Interpreter (§6). |

## 5.10 System and Information Integrity (3.14)

Enable GuardDuty, including Malware Protection for S3, Security Hub, and WAF
as account standards require; the installer configures none of them. Apply
releases within the targets in §13 and monitor for attacks and unauthorized use
with SIEM analytics over the application, load balancer, and CloudTrail logs
(§14.6). On Azure, enable Microsoft Defender for Cloud or an equivalent.
