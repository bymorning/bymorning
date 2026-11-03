---
title: NIST SP 800-171 Rev 2 Control Mapping (CMMC Level 2)
---

# NIST SP 800-171 Rev 2 Control Mapping (CMMC Level 2)

All 110 NIST SP 800-171 Rev 2 requirements are mapped below by family, with
objectives per NIST SP 800-171A. Organizational requirements with no software
component are listed at the end of each family.

## 4.1 Responsibility model

The ByMorning team has no production access, so the software is a CUI asset
inside the customer's system boundary rather than an external cloud service.
Responsibility is Software (the image or the installer implements the
requirement entirely), Shared (the software supplies a mechanism that the
customer configures or operates), Customer (an organizational or environmental
control), or Inherited (satisfied by AWS or Microsoft Azure under the cloud
provider's shared responsibility model). Status is Implemented, Partially (a
named gap remains in §12), or Organizational.

The mapping assumes a production installation: the AWS installer with
`cui_profile = true`, or the Azure installer with the CUI settings in §6, and
`BYMORNING_EVALUATION` unset. Rows describe the AWS installer and note where
the Azure installer differs. Evaluation installations (local master key,
filesystem storage, Local Login) make no key-management or data-at-rest claim,
refuse the CUI profile, and are outside the scope of this mapping.

## 4.2 Access Control (3.1)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.1.1 | Limit system access to authorized users, processes, devices | Shared | Implemented | OIDC-only sign-in with PKCE, state, and nonce. Accounts, memberships, Service Accounts, and hashed Keys are Workspace-bound; every request resolves an Actor. | SEC-INVITE |
| 3.1.2 | Limit access to authorized transactions and functions | Shared | Implemented | Roles `admin` and `member` plus per-action Permission rules. Admin-only gates on security mutations are enforced on HTTP and in-session paths. | SEC-AUTHZ, SEC-TOOLAUTHZ |
| 3.1.3 | Control the flow of CUI | Shared | Implemented | Storage is Workspace-scoped. Share is the only unauthenticated read path and is not loaded in the CUI profile. | SEC-CFG |
| 3.1.4 | Separate duties | Shared | Implemented | Only admins author Permission rules, Instructions, and MCP enablement; the Installation Admin role owns installation-scope settings. | SEC-AUTHZ, SEC-INST |
| 3.1.5 | Least privilege | Shared | Implemented | Members cannot perform admin operations. The task role names the one bucket, the one key under per-use conditions, and explicit model ARNs, with no wildcard resources. The database role split is open (POA&M-36). | SEC-AUTHZ, SEC-TF |
| 3.1.7 | Prevent and audit privileged functions by non-privileged users | Shared | Implemented | Security-relevant configuration is admin-only; privileged actions are recorded in the hash-chained Audit trail. | SEC-AUTHZ, SEC-TOOLAUTHZ, SEC-AUDIT |
| 3.1.8 | Limit unsuccessful logon attempts | Shared | Implemented | Token-bucket rate limiting on public authentication and OAuth endpoints, keyed by client with trusted-proxy-aware forwarding. | SEC-RATE |
| 3.1.9 | Privacy and security notices | Shared | Implemented | Configurable login banner (`login_banner`), acknowledged before the identity provider redirect. Sample text in §6.2. | SEC-BANNER |
| 3.1.10 | Session lock with pattern-hiding display | Shared | Implemented | The server refuses idle Login Sessions after 15 minutes (configurable); the web app locks behind an opaque overlay at the same limit. | SEC-SESS |
| 3.1.11 | Terminate sessions after defined conditions | Shared | Implemented | Durable Login Session with a 12 h absolute bound, configurable idle bound, and immediate refusal on logout or revocation. | SEC-SESS |
| 3.1.12 | Monitor and control remote access | Shared | Implemented | All access is HTTPS through the load balancer; authentication and session events stream to the application log group. The installer does not enable load balancer access logs; the customer does. | — |
| 3.1.13 | Cryptographic protection of remote access | Shared | Implemented | TLS 1.3/1.2 at the load balancer, with the FIPS policy whenever FIPS endpoints are on (always in AWS GovCloud). HTTP redirects to HTTPS. The load balancer-to-task hop is TLS on the validated module (§7.3). On Azure the customer's ingress controller terminates TLS. | SEC-TF, SEC-IMG |
| 3.1.15 | Authorize remote privileged commands | Shared | Implemented | The AWS installer disables ECS Exec, so no remote command path into the task exists. On Azure, `kubectl` access to the cluster is governed by the customer's AKS and Entra ID RBAC. | SEC-TF |
| 3.1.20 | Control connections to external systems | Shared | Implemented | Providers, MCP servers, and plugins are explicit admin-only configuration on HTTP and in-session paths. Boundary status in §6.3. | SEC-AUTHZ, SEC-TOOLAUTHZ |
| 3.1.22 | Control CUI on publicly accessible systems | Shared | Implemented | Share creates unauthenticated links; the CUI profile does not load the Share plugin. On Azure the customer removes it from the installation document or disables share in the Installation Policy. | SEC-CFG, SEC-INST |

Organizational (Customer, duties in §5.1): 3.1.6 (the `member` Role exists for
daily use), 3.1.14 (the installer's `allowed_cidrs` and the internal load
balancer are the control point), 3.1.16–3.1.17 (no wireless component),
3.1.18–3.1.19 (the browser client stores no CUI beyond the encrypted session
cookie), 3.1.21.

## 4.3 Awareness and Training (3.2)

All three requirements are organizational (duties in §5.2): 3.2.1 (§6 and
§14 are the administrator training material), 3.2.2, and 3.2.3 (OIDC-only
sign-in removes the application's own password-phishing surface).

## 4.4 Audit and Accountability (3.3)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.3.1 | Create and retain audit logs | Shared | Implemented | Structured logs stream to a KMS-encrypted CloudWatch log group, with 90-day retention by default (`log_retention_days`); the PostgreSQL log is exported the same way. The Audit trail records security-relevant mutations as hash-chained, fail-closed Entries kept 365 days by default. On Azure, log collection is the customer's. | SEC-AUDIT |
| 3.3.2 | Trace actions to individual users | Shared | Implemented | Logs carry session, request, and actor annotations; Audit Entries carry a principal; LLM Gateway usage is attributed to the caller. | SEC-AUDIT, SEC-USAGE |
| 3.3.4 | Alert on audit logging failure | Customer | Organizational | The installer creates no alarms; the customer configures alerting on its log pipeline. The application rolls back a mutation whose Audit Entry cannot persist. | SEC-AUDIT |
| 3.3.7 | Authoritative time source | Inherited | Implemented | Timestamps are UTC ISO 8601 from the Fargate or AKS host, which the cloud provider synchronizes. | — |
| 3.3.8 | Protect audit information | Shared | Implemented | Log groups are encrypted with the installation key; neither ECS role can delete log groups or streams. Audit Entries are hash-chained, so tampering is detectable. | SEC-AUDIT |

Organizational (duties in §5.3): 3.3.3, 3.3.5 (the log format is
SIEM-ingestible), 3.3.6 (queries ship in §14), 3.3.9 (no in-app log management
surface; restrict CloudWatch and KMS administration in IAM).

## 4.5 Configuration Management (3.4)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.4.1 | Baseline configurations and inventories | Shared | Implemented | Everything deployed is declared in Terraform. The `image` variable's validation refuses any reference not pinned by digest. On Azure the overlay accepts a tag, so the customer supplies the digest. §6 is the settings baseline. | SEC-TF |
| 3.4.2 | Enforce security configuration settings | Shared | Implemented | Secure installer defaults: internal load balancer, FIPS TLS policy where FIPS endpoints apply, forced database TLS 1.3, blocked public bucket access, and the CUI profile through `cui_profile`. §6.1–6.2 is the enforcement checklist. | SEC-TF, SEC-CFG |
| 3.4.5 | Access restrictions for changes | Shared | Implemented | Only the customer's pipeline applies Terraform; only Workspace admins change security-relevant configuration. | SEC-AUTHZ |
| 3.4.6 | Least functionality | Shared | Implemented | One serving container on port 3210, no SSH, no ECS Exec, and no JavaScript package manager in the image. The Code Interpreter has no network access. | SEC-TF, SEC-IMG |
| 3.4.7 | Restrict nonessential ports and services | Shared | Implemented | Security groups admit only 80/443 on the load balancer from `allowed_cidrs`, 3210 from the load balancer to the task, and 5432 from the task to the database. | SEC-TF |
| 3.4.8 | Permitted and prohibited software | Shared | Implemented | The plugin set is admin-gated and clamped by the Installation Policy. The image runs as a non-root user without a JavaScript package manager, and the production image starts with plugin installs and update checks disabled. | SEC-AUTHZ, SEC-INST, SEC-IMG |

Organizational (duties in §5.4): 3.4.3 (the Terraform plan diff supports
review), 3.4.4 (release notes, SBOMs, and signed provenance ship per release),
3.4.9 (members cannot install software).

## 4.6 Identification and Authentication (3.5)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.5.1 | Identify users, processes, devices | Shared | Implemented | Unique Account, Subject, membership, and Service Account identifiers; hashed Keys identify API callers. | — |
| 3.5.2 | Authenticate identities | Software | Implemented | OIDC authorization code with PKCE, state, and nonce; ID-token signatures verified against the identity provider's JWKS. | — |
| 3.5.3 | MFA | Shared | Partially (POA&M-08) | MFA is delegated to the identity provider; the application does not verify `amr`/`acr` claims. Enforcing MFA at the customer's identity provider covers the objective. | — |
| 3.5.4 | Replay-resistant authentication | Software | Implemented | Single-use authorization codes bound by PKCE; state, nonce, signature, issuer, audience, and expiry validated. | — |
| 3.5.5 | Manage identifiers | Shared | Implemented | Account and Service Account identifiers are unique; deprovisioning at the identity provider disables the identifier. | — |
| 3.5.6 | Disable identifiers | Shared | Implemented | Identity provider disablement blocks new logins; the Installation Admin suspends Accounts with immediate session and grant revocation. | SEC-INST, SEC-SESS |
| 3.5.10 | Cryptographically protected passwords | Software | Implemented | No passwords exist. Keys and the Setup token are stored as SHA-256 hashes; cookies are AES-256-GCM encrypted; Credentials and client secrets are envelope-encrypted. | SEC-SETUP, SEC-CRYPT |
| 3.5.11 | Obscure authentication feedback | Software | Implemented | Secrets are held redacted and never rendered; failures redirect generically. | — |

Organizational (duties in §5.5): 3.5.7–3.5.9 (the application stores no
passwords; these are identity provider policies).

## 4.7 Incident Response (3.6), Maintenance (3.7), Personnel (3.9), Physical (3.10)

Incident response (3.6.1–3.6.3) is organizational (duties in §5.6). Runbooks
for evidence preservation and emergency revocation ship in §14, and the
ByMorning team notifies users of vendor-side compromise through the channel in
§13. DFARS 252.204-7012 requires reporting to DoD via DIBNet within 72 hours.

Maintenance (3.7.1–3.7.6) is organizational or inherited (duties in §5.6).
Maintenance is a Terraform apply or an image upgrade. The AWS installer offers
no remote shell or command path into the task; on Azure, `kubectl` access is
the customer's to authorize. Release images are signed and scanned, and the
customer verifies the signature before deployment (§8.3). No external
maintainers exist. Equipment sanitization (3.7.3) is inherited from the cloud
provider.

Personnel security (3.9) has one software-bearing row:

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.9.2 | Protect CUI during personnel actions | Shared | Implemented | Identity provider disablement ends new sessions; member removal and Account suspension terminate existing access immediately (runbook in §14). | SEC-INST |

Screening (3.9.1) is organizational. Physical protection (3.10.1–3.10.5) is
inherited from the cloud provider, and 3.10.6 (alternate work sites) is
organizational; all access is over TLS and the client keeps no offline store.

## 4.8 Media Protection (3.8)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.8.6 | Cryptographic protection of CUI in transport | Shared | Implemented | All transport is TLS: load balancer listener, application listener, database TLS 1.3 with `verify-full`, a TLS-only bucket policy, and AWS SDK calls. On Azure the database requires TLS 1.2 or later; the ingress-to-pod hop is TLS only when the customer sets `TLS_CERT` and `TLS_KEY`. | SEC-TF, SEC-AZ |
| 3.8.9 | Protect backup CUI | Shared | Implemented | RDS automated backups (7 days by default) and the final snapshot are encrypted with the installation key; S3 versioning keeps replaced objects 30 days. On Azure, PostgreSQL keeps 14 days of backups and Blob Storage keeps 14 days of soft-deleted data. | SEC-TF |

Organizational or inherited (duties in §5.7): 3.8.1–3.8.2 (all data at rest is
encrypted and IAM-restricted), 3.8.4, 3.8.5, and 3.8.7–3.8.8. Physical
sanitization (3.8.3) is inherited from the cloud provider; logical deletion
completes in software through bucket lifecycle rules and the Project purge
(SEC-PURGE).

## 4.9 Risk and Security Assessment (3.11, 3.12)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.11.1 | Periodically assess risk | Shared | Implemented | The threat model (§10), this mapping, and the POA&M (§12) are the software-side inputs. | — |
| 3.11.2 | Scan for vulnerabilities | Shared | Implemented | CI runs secret scanning, SAST, and dependency scanning; each release ships SBOMs, grype scans, OpenVEX dispositions, signatures, and provenance (§8, §11.4). | — |
| 3.11.3 | Remediate within risk-based timeframes | Shared | Partially (POA&M-13) | Remediation targets are Critical 7 days, High 30, Medium 90 (§13.4), on a best-effort basis with no support agreement. Two pre-release dependencies are tracked to GA. | — |
| 3.12.2 | Plans of action | Shared | Implemented | The software-side POA&M is §12, with owners and target dates. | — |

Organizational (duties in §5.8): 3.12.1, 3.12.3, 3.12.4.

## 4.10 System and Communications Protection (3.13)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.13.1 | Protect communications at boundaries | Shared | Implemented | The load balancer is the sole ingress; tasks accept only its traffic. Hardening headers, origin-limited CORS, and the WebFetch egress guard are shipped. | SEC-HDR, SEC-CORS, SEC-SSRF |
| 3.13.2 | Security-promoting architecture | Shared | Implemented | Type-safe stack with schema-validated boundaries and sandboxed execution; CI runs SAST, secret, and dependency scanning. | — |
| 3.13.3 | Isolate security functionality | Software | Partially (POA&M-14) | Authentication and authorization run in edge middleware; execution is sandboxed. Plugins run in-process; the gap is tracked. | — |
| 3.13.4 | Prevent transfer via shared resources | Software | Implemented | Storage is Workspace-scoped; execution sessions are per-invocation; no cross-tenant caches exist. | — |
| 3.13.5 | Separate subnetworks | Shared | Implemented | The AWS installer places the load balancer, task, and database in subnet lists the customer supplies, each tier behind its own security group; the customer's VPC design provides the separation. The Azure installer creates separate node, database, and private-endpoint subnets. | — |
| 3.13.6 | Deny by default | Shared | Partially (POA&M-15) | Database and Code Interpreter security groups are deny-by-default. The task security group allows HTTPS to any address; the customer constrains it with NAT egress filtering, a firewall, or VPC endpoints (§6.1). | — |
| 3.13.8 | Cryptographic protection in transmission | Shared | Implemented | TLS everywhere on the validated module; the task verifies the database with `verify-full` against the RDS CA bundle in the image. The load balancer does not validate the task certificate, so that hop is encrypted, not authenticated. | SEC-TF, SEC-IMG |
| 3.13.9 | Terminate connections | Shared | Implemented | Load balancer idle timeout 120 s; Login Sessions end at the idle bound, the 12 h bound, or revocation. | SEC-SESS |
| 3.13.10 | Manage cryptographic keys | Shared | Implemented | One customer-managed KMS key with annual rotation, split by IAM conditions per use. The cookie key, database password, listener key, and Setup token are generated into Secrets Manager and Terraform state (POA&M-21). Key administrator roles are the customer's. On Azure, a Key Vault key wraps Credentials. | SEC-TF |
| 3.13.11 | FIPS-validated cryptography | Shared | Implemented | UBI 9 Node.js 22 with the RHEL 9 OpenSSL FIPS Provider (CMVP #4857), failing closed. FIPS endpoints are always used in AWS GovCloud and by default in US commercial Regions; Mantle has none (POA&M-35). | SEC-IMG, SEC-FIPSEP |
| 3.13.13 | Control mobile code | Shared | Implemented | Generated code runs only in the Code Interpreter; plugin installation and configuration are admin-only. | SEC-AUTHZ, SEC-INST |
| 3.13.15 | Authenticity of communications sessions | Software | Implemented | TLS plus `__Host`-prefixed, encrypted session cookies; state changes require an exact Origin header. | — |
| 3.13.16 | Protect CUI at rest | Shared | Implemented | RDS, S3, Secrets Manager, and CloudWatch Logs use the installation KMS key. Credentials, OAuth tokens, and client secrets are also envelope-encrypted by the application. On Azure, storage uses platform encryption and a Key Vault key wraps Credentials. | SEC-CRYPT, SEC-TF |

Organizational (duties in §5.9): 3.13.7, 3.13.12 (no collaborative computing
hardware features), 3.13.14 (no VoIP).

## 4.11 System and Information Integrity (3.14)

| ID | Requirement | Resp. | Status | How the software meets it | Tests |
| -- | ----------- | ----- | ------ | ------------------------- | ----- |
| 3.14.1 | Identify, report, correct flaws | Shared | Partially (POA&M-13) | Best-effort remediation targets (§13.4); CI and release scanning in place; pre-release dependencies tracked to GA. | — |
| 3.14.2 | Malicious code protection | Shared | Partially (POA&M-16) | No in-application malware scanning. The installer configures none; the customer enables GuardDuty Malware Protection for S3 or an equivalent scanner. | — |
| 3.14.3 | Monitor security alerts | Shared | Implemented | The ByMorning team publishes a private disclosure channel and per-release vulnerability dispositions (§13). | — |
| 3.14.5 | Scan files from external sources | Shared | Partially (POA&M-16) | WebFetch responses are size-capped and text-converted, and destinations are screened before connection and per redirect. File-type inspection does not exist. | SEC-SSRF |
| 3.14.6 | Detect attacks | Shared | Implemented | Structured authentication, permission, and usage logs stream to the log group; the Audit trail is tamper-evident and mirrored to the log stream. WAF, GuardDuty, CloudTrail, and alarms are the customer's to add. | SEC-AUDIT |
| 3.14.7 | Identify unauthorized use | Shared | Implemented | Authentication failures and permission denials are logged and recorded in the Audit trail with the anonymous principal and reason. | SEC-AUDIT |

Organizational (duties in §5.10): 3.14.4 (signed, digest-pinned image updates
are the update path).

## 4.12 Rollup

Across the 110 requirements, responsibility is 51 Shared, 44 Customer, 7
Software, and 8 Inherited from the cloud provider. The Software rows are
3.5.2, 3.5.4, 3.5.10, 3.5.11, 3.13.3, 3.13.4, and 3.13.15; the Inherited rows
are 3.3.7, 3.7.3, 3.8.3, and 3.10.1–3.10.5. Status is 52 Implemented
(including the inherited 3.3.7), 7 Partially (3.5.3, 3.11.3, 3.13.3, 3.13.6,
3.14.1, 3.14.2, 3.14.5, each tracked in §12), and 51 Organizational or
inherited.
