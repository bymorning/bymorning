---
title: Threat Model
---

# Threat Model

The threat model applies STRIDE to the nine trust boundaries (B1–B9) drawn in
Figures 2-5a and 2-5b (§2.6), then to the delivery and administration paths
outside the runtime data flow, and then the OWASP Top 10 for LLM Applications
(2025). The CUI profile (§6) removes the anonymous Share plane and third-party
providers from the installation entirely. Model-generated output and MCP
server content are treated as untrusted input throughout.

## 10.1 STRIDE analysis by trust boundary

B1, browser to load balancer to Gateway (user plane):

| Threat | Existing controls | Residual risk | POA&M |
| ------ | ----------------- | ------------- | ----- |
| Spoofing: stolen session cookie, forged Origin | `__Host-` `Secure` AES-256-GCM cookie; OIDC PKCE, state, nonce; Origin-header check on state changes; durable Login Session with immediate revocation and idle timeout | Stolen cookie valid only until revocation or idle or absolute expiry | — |
| Tampering: request manipulation | TLS 1.3/1.2 at the load balancer; invalid headers dropped; schema-validated inputs | The load balancer does not authenticate the task's self-signed certificate; the hop is encrypted inside the customer's VPC | — |
| Repudiation: user denies actions | Structured request and auth logs; hash-chained Audit trail with per-mutation principals (SEC-AUDIT) | — | — |
| Information disclosure: caching, referrers, framing | No-store and security headers; clickjacking defenses (SEC-HDR) | — | — |
| Denial of service: request floods | Internal load balancer admitting only `allowed_cidrs`; token-bucket rate limiting on auth and OAuth endpoints (SEC-RATE) | No WAF unless the customer adds one; single task | POA&M-19 |
| Elevation: member reaching admin functions | Admin authority enforced at the domain seam on HTTP and in-session paths (SEC-AUTHZ, SEC-TOOLAUTHZ); Installation Admin role for installation scope (SEC-INST) | Default-allow Permission posture for unmatched actions unless the deny-unmatched baseline is set (§6) | — |

B2, Gateway to PostgreSQL, object storage, keys, and secrets (data plane):

| Threat | Existing controls | Residual risk | POA&M |
| ------ | ----------------- | ------------- | ----- |
| Spoofing: rogue client to PostgreSQL | Security group admits 5432 only from the task; SCRAM; TLS 1.3 with `verify-full` against the RDS CA bundle in the image. On Azure, a delegated subnet without public access and TLS verified against the customer-supplied CA. | — | — |
| Tampering: data at rest | Encryption under the installation KMS key; S3 versioning with 30-day noncurrent expiry; TLS-only bucket policy | No S3 Object Lock unless the customer adds it | — |
| Information disclosure: secrets in environment, logs, task definition | Secrets delivered as ECS container secrets, never environment (SEC-TF); redacted handling; Credentials and client secrets envelope-encrypted (SEC-CRYPT) | The application connects as the database administrator user | POA&M-36 |
| Denial of service: connection or storage exhaustion | Bounded connection pools; RDS storage autoscaling to a configured ceiling | Single task is a single point of availability | POA&M-19 |

B3, Gateway to Amazon Bedrock (inference plane): region configuration admits
only `aws` and `aws-us-gov` and requests are SigV4-signed, so traffic cannot
reach a wrong endpoint or partition. CUI reaches only authorized models because
the task role is scoped to explicit `bedrock_model_arns` with wildcards refused
(SEC-TF), the Workspace `providers.allow` admits only Bedrock, and the Limiter
admits by Model identity. The Mantle action is limited to the default project,
the only scope Mantle offers. Runaway spend is bounded by Spend Limits
reserved before invocation and Limiter request and token rates, with
estimate-versus-settle overshoot as the residual.

B4, Gateway to the Code Interpreter (execution plane): on AWS, malicious
generated code is contained by AgentCore VPC mode with a no-rule security
group and a task role scoped to the one interpreter ARN. On Azure, each call
runs in a short-lived sandbox pod under a deny-all NetworkPolicy, optionally
with Kata VM isolation. Sessions share no filesystem, and all output is treated
as untrusted.

B5, Gateway to optional external integrations (model providers, MCP, plugin
APIs): nothing external is active by default except the identity provider,
every integration is explicit admin configuration, and the Installation Policy
can lock providers and plugins installation-wide. CUI or ITAR data leaving the
authorized boundary is therefore the customer's documented decision (§5,
§6.3). A rogue MCP server is limited to Workspace-registered, admin-enabled
servers with per-member OAuth Connections, and its content is treated as
untrusted model input (LLM01, POA&M-22). Over-privileged external grants are
bounded by the consent flow, scoped clients, 30-day refresh expiry with reuse
detection, and self-service and suspension revocation.

B6, in-process plugin execution: the plugin set is installation configuration,
not user-installable at runtime, and the CUI profile permits bundled plugins
only. A malicious or compromised plugin would share the process's memory,
network, and credential access (POA&M-14).

B7, ByMorning as OAuth authorization server for MCP clients: dynamic client
registration validates redirect URIs, PKCE S256 is the only challenge method,
and a consent screen binds each grant. Access and refresh tokens are
SHA-256-hashed at rest, refresh tokens expire at 30 days with rotation reuse
detection revoking the grant family, and the endpoints are rate-limited
(SEC-RATE). Public clients rely on PKCE plus consent.

B8, anonymous Share plane: absent in the CUI profile, which does not load the
Share plugin. Where enabled, a Share is a 256-bit-class unguessable token, one
active Share per Session, read-only, revoked by unshare or Session deletion;
live views expose later Messages, and viewers are not logged beyond load
balancer access logs, which the customer enables.

B9, admin versus member inside the application: only admins author Permission
rules, Instructions, MCP enablement, Service Accounts, Keys, Spend Limits, and
Managed Policies, enforced at the domain seam (SEC-AUTHZ, SEC-TOOLAUTHZ).
Installation-scope changes require the Installation Admin (SEC-INST), and the
Audit trail records each admin mutation with its principal (SEC-AUDIT).

## 10.2 OWASP Top 10 for LLM Applications (2025)

| # | Category | Threat in ByMorning | Existing controls | Residual risk | POA&M |
| - | -------- | ------------------- | ----------------- | ------------- | ----- |
| LLM01 | Prompt injection | Indirect injection via WebFetch results, MCP outputs, or files steering the model to exfiltrate or act | Permission rules gate side-effecting Tools; unattended Scheduled Tasks deny `ask`; Instructions are admin-only | Model-level injection cannot be eliminated by the platform; deny-unmatched baseline recommended (§6) | POA&M-22 |
| LLM02 | Sensitive information disclosure | CUI in prompts and responses; Share links; provider egress | `providers.allow` at Workspace and Installation Policy levels; Share not loaded; logs avoid secrets | Provider egress is an admin-authorized decision (§6.3) | — |
| LLM03 | Supply chain | Model, provider, plugin, or dependency compromise | Pinned model catalog; digest-pinned image; keyless signatures with a pinned signer identity, SLSA provenance, SBOMs, and CI scans (§8, §10.3) | Pre-release dependencies (Effect RC, Drizzle RC) | POA&M-13 |
| LLM04 | Data and model poisoning | Poisoned training or retrieval content | No training or fine-tuning; no persistent embedding store; Instructions admin-only | — | n/a |
| LLM05 | Improper output handling | Stored XSS via rendered model output | UI sanitizes rendered content (DOMPurify); strict CSP (SEC-HDR) | Review sanitizer coverage per release | — |
| LLM06 | Excessive agency | Model invokes high-impact Tools | Permission rules per Tool; `ask` requires human approval; unattended runs deny asks; the Tool Gateway does not implicitly authorize approval-requiring Tools; toolkit mutations enforce the admin Role (SEC-TOOLAUTHZ) | Default-allow for unmatched actions unless the baseline is set (§6) | — |
| LLM07 | System prompt leakage | Agent or Workspace Instructions disclosed | Instructions are Workspace-visible by design; Credential values never enter model context | Instructions are not a confidentiality boundary | — |
| LLM08 | Vector and embedding weaknesses | — | Not applicable: no vector store or embedding index | — | n/a |
| LLM09 | Misinformation | Model output relied upon uncritically | Tool-grounded answers; Session records persist for review; no automated action without Tool permission | Human-factors residual; training (3.2) | — |
| LLM10 | Unbounded consumption | Cost or denial of service via inference or Tools | Spend Limits reserved before invocation; Limiter rates; WebFetch size and time caps; Code Interpreter output caps; auth endpoints rate-limited | Limits are configuration; the CUI profile mandates them (§6) | — |

## 10.3 Delivery and administration paths

These threats sit outside the runtime data flow in Figures 2-5a and 2-5b:
how the image reaches the customer, where deployment secrets live, and how
operators reach the running system.

| Threat | Existing controls | Residual risk | POA&M |
| ------ | ----------------- | ------------- | ----- |
| Tampering: image or evidence altered at a registry, mirror, or in transit | Keyless Sigstore signatures over the image tarball, `SHA256SUMS`, OpenVEX, and SLSA provenance; the `ghcr.io` images carry signatures and attestations from the same identity. Installers deploy by digest, and the AWS installer refuses a tag-only reference (SEC-TF). | The Azure overlay accepts a tag; the customer pins the digest (§5.4) | — |
| Spoofing: a signature from a compromised or unofficial workflow run | Verification pins the identity to `full-gate.yml` on a `v*` tag with the GitHub Actions issuer (`signer.txt`). Signatures from branch runs or other workflows fail verification. Every signature is recorded in the public Rekor transparency log. | A party able to push a `v*` tag and dispatch the release workflow could produce a validly signed release | — |
| Tampering: malicious change in the source or build pipeline | Builds are reproducible: the customer can rebuild from the tag and compare image digests. Provenance names the source commit and build. | Code-execution image evidence carries no provenance statement | — |
| Spoofing: substituted Sigstore trust root during offline verification | Each release ships `trusted_root.json`, and `cosign verify-blob --trusted-root` verifies against it with no network access | Trust in the Sigstore public-good roots | — |
| Information disclosure: Terraform state read by an unauthorized party | State holds the database password, cookie key, listener key, and Setup token. The database admits only the task's security group, so the password alone gives no network path. | Whoever reads state can re-present the Setup token, which remains the recovery path for replacing an Auth Provider; the customer restricts the state backend | POA&M-21 |
| Elevation: interactive access to the running Gateway | The AWS installer disables ECS Exec and offers no shell, so secrets reach the task only as container secrets (SEC-TF). On Azure, `kubectl` access follows the customer's AKS RBAC. | Principals with IAM rights to change the task definition or service remain the customer's to control | — |
| Elevation: an evaluation installation exposed as production | Evaluation requires the explicit `BYMORNING_EVALUATION=true`. It refuses the CUI profile, warns at every start, and limits Local Login to a loopback origin. The AWS installer never sets the flag (SEC-TF). | Out of scope: anyone reaching an evaluation port signs in as the evaluator; the customer keeps the flag unset (§5) | — |

## 10.4 Residual-risk statement

With the CUI profile applied, the highest residual risks are:

1. In-process plugins (POA&M-14), mitigated by the Installation Policy
   allowlist restricting the installation to bundled plugins.
2. Indirect prompt injection (POA&M-22), mitigated by ask and deny permissions
   on content-ingesting and side-effecting Tools.
3. Admin-authorized external integrations moving data outside the boundary, an
   accepted, documented customer decision (§5, §6.3).
4. The absence of a FIPS-designated Bedrock Mantle endpoint (POA&M-35), with
   all client-side cryptography on the validated module regardless.
5. Deployment secrets in Terraform state (POA&M-21), mitigated by the
   customer's private, encrypted, access-restricted state backend.
