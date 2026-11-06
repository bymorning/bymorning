---
title: Security Test Report
---

# Security Test Report

The security suites below carry stable `SEC-*` identifiers, 121 numbered
checks in the application and image, plus the AWS and Azure installer tests.
Each row's result is recorded at the release commit. The image, installer,
and browser suites run in the release workflow, the image suites against the
exact release tarball, and the images are published only after they pass
(§8.2). The remaining suites run on every pull request and push.

## 11.1 How the suites run

The authorization, installation, session, toolkit, audit, credential,
invitation, purge, and usage suites run through the application test harness
against a real server and PostgreSQL database. Route, header, CORS,
rate-limiting, and setup-token suites run at the server route and middleware
layer. The SSRF guard, cipher, and FIPS-endpoint checks are unit suites, with
the cipher migration also exercised against a real PostgreSQL. The
configuration-profile suite runs against the host's startup path with the
bundled installation documents. The login banner, browser security headers,
and session lock run in Chromium against the real UI build.

The image gate runs against the release tarball on linux/amd64, the delivered
architecture, after verifying it against the release manifest. The image boot
suite then starts the tarball in the AWS and the Azure task environment
against emulated cloud services and checks the startup refusals. The installer
suites run offline with mocked cloud providers; the Azure installer also runs
end to end on a kind cluster. Tool versions are in `tools.txt` in the evidence
folder.

## 11.2 Security checks by suite

| Suite | IDs | What is verified | Result |
| ----- | --- | ---------------- | ------ |
| Authorization matrix | SEC-AUTHZ-01…09 | Service Account and Key minting, Spend Limits, Managed Policies, Skills, shared Model enablement, Connections, OAuth client setup, and shared Credentials all require the admin Role. The security-relevant Config sections refuse member writes. Members of one Workspace cannot read or mutate another. A Service Account Key cannot drive the browser control plane. | {{RESULT}} |
| Toolkit and domain-seam authorization | SEC-TOOLAUTHZ-01…05 | A member's session model cannot mutate admin state through toolkit Tools while an administrator's can; a member-owned Scheduled Task run is refused admin mutations; the Tool Gateway refuses a Service Account Key before any Tool execution and a member's Gateway connection cannot drive admin mutations. | {{RESULT}} |
| Installation governance | SEC-INST-01…07 | The first login after Setup becomes the Installation Admin. A Workspace administrator without a grant cannot manage Auth Providers or the Installation Policy. Invite-only provisioning refuses uninvited first logins. The Policy clamps `providers.allow` and disables share and web search installation-wide. Last-admin protection holds for member removal and admin revocation. A removed member loses access immediately. A suspended Account is refused on its next request and its Scheduled Tasks pause. | {{RESULT}} |
| Login Sessions and OAuth grants | SEC-SESS-01…12 | Logout revokes the session server-side and a replayed cookie is refused. The idle timeout and the absolute lifetime bound are enforced from the durable record. Revoking all sessions ends every session of an Account, and version 1 cookies are refused. An Account manages only its own sessions and grants. Refresh tokens expire at 30 days, and replaying a rotated token revokes the grant family. In the browser, the display locks after the idle timeout, and a server-side revocation replaces the app with the session-expired screen. | {{RESULT}} |
| OAuth consent | SEC-OAUTH-01 | The consent request for a dynamically registered MCP client also reports where an approval will send the result, as scheme and host only (no credentials, path, or query), so a member can tell a local app from another host. The client's self-declared name is passed through unchanged and is not treated as an identity. | {{RESULT}} |
| Audit trail | SEC-AUDIT-01…17 | Login, failed login, invitation, Service Account and Key lifecycle, Config, Permission, Spend Limit, and Session deletion each produce an attributed Entry with no secrets. So do Share, logout, suspension and restore, Installation Admin grants, Policy updates, member removal, and OAuth revocation. Members cannot read the Audit; an admin reads only their own Workspace, while the Installation Admin reads across Workspaces. A mutation rolls back when its Entry cannot persist. Retention pruning deletes only expired Entries. Every Entry is emitted as one JSON stderr line, and chain verification detects tampering. | {{RESULT}} |
| Credential envelope encryption | SEC-CRYPT-01…14 (03 and 04 retired) | Values encrypt to a versioned envelope and decrypt back, and the wrong key fails closed. The boot migrator re-encrypts legacy plaintext rows in place under a lock and fails closed when the key does not unwrap them. Connection credentials and Auth Provider client secrets are ciphertext at rest, and the setup token is stored as a hash. Every backend refuses a data key under a key identity it does not own, an envelope from another backend instance, and an envelope whose key identity was replaced. A stored Credential whose key is unavailable answers 503 with a clear error, not a bare 500. | {{RESULT}} |
| Response headers and CORS | SEC-HDR-01…05, SEC-CORS-01…02 | Baseline security headers are present on auth and API responses, and HSTS is omitted on plain-HTTP origins. The SPA document carries the strict CSP, which admits the full markdown, code, and mermaid rendering path in the browser. Cross-origin requests admit only the application origin. | {{RESULT}} |
| SSRF egress guard | SEC-SSRF-01…08 | Loopback, private, link-local, CGNAT, and metadata destinations are refused before any request. Hostnames resolving to non-public or mixed answers are refused, and every redirect hop is re-screened. Every non-public IPv4 range and the IPv6 loopback, ULA, link-local, mapped, and unspecified forms are classified. Connections are pinned to the screened answers against rebinding. | {{RESULT}} |
| Authentication rate limiting | SEC-RATE-01…09 | Public authentication and OAuth endpoints are throttled per client and route. X-Forwarded-For is ignored without trusted proxies and honored with them. IPv4 and IPv6 literals, exact and CIDR proxies, and IPv4-mapped IPv6 peers are handled. Token buckets refill over time, and the read-only sign-in method probe is never throttled. | {{RESULT}} |
| Login banner | SEC-BANNER-01…02 | The sign-in page shows the configured system-use notification and gates the identity provider redirect on acknowledgment; no sign-in shortcut bypasses a configured notification. | {{RESULT}} |
| Setup token | SEC-SETUP-01…03 | A generated token is revealed only through an owner-read-only file and never logged; an operator-supplied token is accepted without writing or logging it; the file is removed once an Auth Provider exists. | {{RESULT}} |
| Invitation domain enforcement | SEC-INVITE-01…05 | A member can be invited only when an enabled Auth Provider admits the domain; admission uses the inviter's authenticated membership and is decided outside the core operation; failures map without a conflict response. | {{RESULT}} |
| Image security | SEC-IMG-01…12 (09 retired) | FIPS mode is active from the image's own environment, and the process runs as uid/gid 65532. No bun, npm, or npx exists in the runtime, and only rpm and microdnf remain as system package managers. Node 22 is linked against the system OpenSSL. The OCI labels, `OPENSSL_CONF`, and `BYMORNING_VERSION` are present, while no deployment environment is baked in. The active module is the RHEL 9 OpenSSL FIPS Provider (CMVP #4857). Approved algorithms work, and the TLS listener refuses TLS 1.1, ChaCha20, and Ed25519. The RDS CA bundle is readable and carries the commercial and GovCloud roots. | {{RESULT}} |
| No outside hosts at boot | SMK-41, SMK-59 (image boot) | The release image boots and serves on a Docker network with no route out. Its log shows no failed lookup or connection to a host outside the test, so nothing outside the deployment is required or attempted at startup. The whole boot suite runs on that network. | {{RESULT}} |
| Installation configuration profiles | SEC-CFG-01…04 | `BYMORNING_CONFIG` loads the selected document instead of the bundled default and fails closed when the file is unreadable or invalid; the bundled CUI profile loads neither the Share nor the Google plugin, so their Tools do not exist. | {{RESULT}} |
| FIPS endpoints for Bedrock | SEC-FIPSEP-01…05 | Converse uses the standard endpoint when `AWS_USE_FIPS_ENDPOINT` is unset and `bedrock-runtime-fips.<region>.amazonaws.com` when it is `true`; Mantle keeps its standard endpoint; only the literal `true` selects FIPS; SigV4 signs the FIPS hostname with the unchanged `bedrock` service scope. | {{RESULT}} |
| Project storage purge | SEC-PURGE-01…03 | Deleting a Project removes its storage objects through the purge outbox; an intent written before a crash is drained on boot; a failed purge keeps the intent and the objects for the next pass. | {{RESULT}} |
| Gateway usage attribution | SEC-USAGE-01…02 | A Service Account Key invocation is attributed to its Service Account, and a user token invocation to that User. | {{RESULT}} |
| AWS installer | SEC-TF | Terraform format and validation of the module and example root, and mocked-provider `terraform test` runs. They assert FIPS endpoints and the FIPS TLS policy in GovCloud and by default in US commercial Regions, and secrets reaching the task only as container secrets. They also assert ECS Exec disabled, an encrypted private PostgreSQL verified over TLS, a private TLS-only bucket, and an internal load balancer limited to `allowed_cidrs`. IAM names every resource and binds the Credential key to its encryption context, and tag-only images and wildcard model ARNs are refused. | {{RESULT}} |
| Azure installer | SEC-AZ | Offline: Terraform validation and mocked-provider tests of the module (Entra-only private storage, Key Vault purge protection and wrap-only key, scoped role assignments, private PostgreSQL with TLS), rendered manifests checked against the Kubernetes schema and the pod-security policy, and the secret-creation script. End to end on kind: the signed release tarballs verified and imported by digest, sign-in, Blob Storage, Key Vault rotation, and sandboxed code execution with deny-all egress. | {{RESULT}} |

The AWS installer's offline tests prove what the module requests, not that AWS
accepts it. Before each release that changes the AWS installer, the ByMorning
team runs the AWS installer's sandbox checklist (`test/sandbox.md`) in a real
AWS account: apply, health, sign-in, encrypted storage, Credentials across a
restart, Bedrock, an isolated Code Interpreter, upgrade, and destroy.

## 11.3 Non-security test results at the release commit

The non-security unit, integration, and style gates at the release commit:
{{RESULT}}.

## 11.4 Scan results

| Artifact | Tool | Summary |
| -------- | ---- | ------- |
| `vulnerabilities-image-grype.json`, `vulnerabilities-source-grype.json` | grype | {{VULN_SUMMARY}} |
| `gitleaks.json` | gitleaks | {{GITLEAK_SUMMARY}} |
| `semgrep.sarif` | semgrep | {{SEMGREP_SUMMARY}} |
| `bun-audit.txt` | bun audit | {{BUN_AUDIT_SUMMARY}} |
| `openvex.json` | OpenVEX v0.2.0 | Statements covering every Critical and High in both images and the source: `not_affected`, `fixed`, or `affected` (POA&M or accepted) for the Gateway, and `affected` (accepted) for the execution image's residual Debian packages; signed (`openvex.json.bundle`) |

The per-finding disposition table is the vulnerability triage published in
the ByMorning repository at the release tag (§8.5).
