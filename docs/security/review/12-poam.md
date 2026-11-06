---
title: Plan of Action and Milestones (POA&M)
---

# Plan of Action and Milestones (POA&M)

This is the software-side POA&M. The customer maintains its own
organizational POA&M for the controls assigned to it in §4 and §5. Fourteen
items are open, proposed, or accepted, and twenty-six are closed. Item IDs are
stable across releases and are never reused. A Proposed item awaits a maintainer decision,
and its weakness should be treated as open. No target is a commitment: the
project is community maintained (§13). Under 32 CFR
170.21, POA&M items carried into a conditional CMMC status must close within
180 days, so the customer schedules its assessment accordingly or accepts the
open items as operational risks with the compensating controls stated.

Capabilities the installers deliberately leave to the customer, such as a web
application firewall, load balancer access logs, and alarms, are customer responsibilities
assigned in §5, not POA&M items.

## 12.1 Open, proposed, and accepted items

| ID | Weakness and current mitigation | NIST 800-171 | Risk | Owner | Target | Status |
| -- | ------------------------------- | ------------ | ---- | ----- | ------ | ------ |
| POA&M-08 | MFA is not asserted by the application (`amr`/`acr` claims unchecked); it is enforced at the customer's identity provider, for example through Conditional Access | 3.5.3 | M | Maintainers | No commitment | Proposed: optional per-Auth-Provider `amr`/`acr` enforcement |
| POA&M-13 | Fixes carry no SLA-backed timeline, and ByMorning is community maintained (§13.4). The Gateway ships pre-release dependencies: the Effect release candidate (`effect` and five `@effect/*` packages, 4.0.0-rc.112), Drizzle ORM (1.0.0-rc.5), and the `@opencode-ai/ai`, `codemode`, and `schema` betas (0.0.0-beta-19192), whose upstream line is no longer published | 3.11.3, 3.14.1 | M | Maintainers | No commitment | Open: move to GA releases. Effect 4.0.x with `@opencode/ai` 2.x would retire the Effect and `@opencode-ai` entries (#43); Drizzle has no GA release yet |
| POA&M-14 | Plugins execute in-process with full application privilege; the CUI profile loads bundled plugins only | 3.13.3 | M | Maintainers | No commitment | Open: out-of-process isolation planned |
| POA&M-15 | The AWS installer's task security group allows HTTPS egress to any address; the database and Code Interpreter groups are deny-by-default | 3.13.6 | L | Shared | Customer configures | Open: constrain task egress with NAT egress controls or VPC endpoints (§6) |
| POA&M-16 | Neither the software nor the installers scan stored objects for malware; the customer enables GuardDuty Malware Protection for S3 or Microsoft Defender for Storage (§5) | 3.14.2, 3.14.5 | M | Shared | No commitment | Open: an optional installer setting that enables the cloud scanner |
| POA&M-19 | A single Gateway task (AWS) or replica (Azure) is an availability single point; durable state lets a replacement resume after a short outage | Availability | M | Maintainers, customer | No commitment | Open: accepted for this release; backup and restore in §14.4 |
| POA&M-21 | Terraform state contains the generated secrets: the database password, `WEB_COOKIE_KEY`, and on AWS `TLS_KEY` and the Setup token | 3.13.10 | L | Customer | Immediate (procedural) | Open: use a private, encrypted state backend with locking and restricted access |
| POA&M-22 | Indirect prompt injection via WebFetch, MCP, or files cannot be fully prevented at the platform level; ask and deny Permissions and admin-only MCP enablement mitigate | LLM01 | M | Maintainers | No commitment | Open: continued hardening and admin guidance (§6) |
| POA&M-28 | No SAML support (OIDC only); OIDC covers Microsoft Entra ID, Okta, Google Workspace, and other OIDC providers | 3.5.2 context | L | Maintainers | n/a | Accepted: revisit if a customer requires SAML |
| POA&M-34 | Managed Policies are stored but not consulted; enforcement today is Role plus Permission rules | 3.1.2 | M | Maintainers | No commitment | Open: wire into enforcement or remove the surface |
| POA&M-35 | No FIPS-designated Bedrock Mantle endpoint exists; client-side cryptography runs on the validated module regardless | 3.13.11 | L | Shared (AWS) | No commitment | Partially closed: Converse uses the FIPS endpoint (SEC-FIPSEP) |
| POA&M-36 | The application connects to PostgreSQL as the database administrator user, over `verify-full` TLS on AWS, from the only admitted network path | 3.1.5 | M | Maintainers | No commitment | Open: least-privilege role split deferred |
| POA&M-39 | CVE-2026-106069 (High): Node 22's TLS hostname check can accept a certificate for a non-canonical numeric hostname. Outbound destinations are parsed as URLs, which canonicalizes such hostnames before TLS; exploitation needs an attacker on the network path | 3.13.8, 3.14.1 | L | Maintainers (Red Hat fix) | No commitment | Open: `affected` in `openvex.json`; no vendor fix |
| POA&M-40 | CVE-2026-109869 and CVE-2026-87018 (High): the undici vendored in Node 22 can crash the Gateway process when an endpoint it reaches with `fetch` answers maliciously. Reachable endpoints are those an administrator configured; the orchestrator restarts the process, and no data is exposed | 3.14.1 | M | Maintainers (Red Hat fix) | No commitment | Open: `affected` in `openvex.json`; no vendor fix |

## 12.2 Closed items

| ID | Weakness resolved | Evidence |
| -- | ----------------- | -------- |
| POA&M-01 | Application runtime cryptography was not FIPS 140-3 validated; the RHEL 9 OpenSSL FIPS Provider (CMVP #4857) is now active image-wide and fails closed | SEC-IMG |
| POA&M-02 | Admin-only gating of security-relevant configuration was not uniformly enforced | SEC-AUTHZ |
| POA&M-03 | No application-layer rate limiting on authentication and OAuth endpoints | SEC-RATE |
| POA&M-04 | No persisted, queryable application audit trail; now hash-chained, fail-closed, with SIEM mirror lines | SEC-AUDIT |
| POA&M-05 | The Share plugin was enabled by default; the CUI profile excludes it, and the AWS installer's `cui_profile` selects that profile | SEC-CFG, SEC-TF |
| POA&M-06 | No configurable login privacy and security notice | SEC-BANNER |
| POA&M-07 | No server-side session revocation or idle timeout | SEC-SESS |
| POA&M-09 | Plugin installation relied on configuration discipline; the Installation Policy now clamps the plugin set installation-wide | SEC-INST |
| POA&M-10 | No member removal or Account suspension capability | SEC-INST |
| POA&M-11 | Provider and MCP Credentials were plaintext at the application layer; now AES-256-GCM envelope encryption under the installation's KMS key or Key Vault key | SEC-CRYPT |
| POA&M-12 | Release supply-chain evidence was incomplete; SBOMs, scans, signatures, and SLSA provenance now ship per release (§8) | Release evidence |
| POA&M-17 | The Permission default for unmatched actions was allow; a configurable deny-unmatched posture is delivered and set in the CUI profile | SEC-TOOLAUTHZ |
| POA&M-18 | Hardening response headers were not emitted | SEC-HDR |
| POA&M-20 | Terraform hardening gaps: database TLS verification, ECS Exec, and wildcard Bedrock ARNs | SEC-TF |
| POA&M-23 | OAuth refresh tokens had no expiry and grants could not be revoked; now 30-day rotation with reuse detection and self-service revocation | SEC-SESS |
| POA&M-24 | The setup token was written to logs while Setup was pending | SEC-SETUP |
| POA&M-25 | The CORS allowlist included localhost origins alongside the application origin | SEC-CORS |
| POA&M-26 | The invitation flow did not consistently enforce the Auth Provider's admitted email domains | SEC-INVITE |
| POA&M-27 | WebFetch lacked a private and link-local address block (SSRF) | SEC-SSRF |
| POA&M-29 | LLM Gateway usage was attributed to the Workspace, not the individual caller | SEC-USAGE |
| POA&M-30 | No distinct Installation Admin role existed | SEC-INST |
| POA&M-31 | Project storage purge (complete logical deletion) was not implemented | SEC-PURGE |
| POA&M-32 | Closed in 1.3.1: the Installation License and its signed artifacts were removed from the product, so no license signature algorithm remains | Changelog, 1.3.1 |
| POA&M-33 | In-session toolkit Tools bypassed the HTTP admin gates; admin authority is now enforced at the domain seam | SEC-TOOLAUTHZ |
| POA&M-37 | Closed in 1.3.1: release signing is keyless with Sigstore, so no release-signing key exists to protect (§8.3) | §8.3 |
| POA&M-38 | No host-level switch disabled the plugin update check and runtime install paths; the production image now always starts with both disabled, and only the development entry enables them | SEC-CFG |
| POA&M-35 (part) | Converse model traffic did not use the FIPS-designated Bedrock Runtime endpoint | SEC-FIPSEP |
