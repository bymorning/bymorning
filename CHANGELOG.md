# Changelog

All notable changes to ByMorning are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the shipped
application carries the version from the root `package.json`
(`BYMORNING_VERSION` in the image, `org.opencontainers.image.version` label).

## [Unreleased]

### Fixed

- The `server.json` description was 121 characters, and the MCP Registry refuses more than 100 (`mcp-publisher validate`
  does not check it), so publishing 1.3.3 failed until it was shortened. `script/release/versions.sh` now checks the
  limit in CI.

## [1.3.3] — 2026-11-06

Adds the Helm chart and publishes it, with the images, to ghcr.io; hardens the OAuth consent page for MCP clients;
refreshes both base images and `@azure/identity`; and discloses every pre-release dependency in the security review.
No database migrations. The Gateway image differs from 1.3.2 in the Bedrock quota fix, the `@azure/identity` update,
the OAuth consent field, and the re-pinned base.

### Added

- `server.json` lists the Tool Gateway in the MCP Registry as `io.github.bymorning/bymorning`: a remote Streamable
  HTTP server at `https://{bymorning_host}/mcp`, where `bymorning_host` is your installation. (The registry requires
  each remote URL template to be unique, so the placeholder is named for ByMorning.) `script/release/versions.sh` checks that
  `package.json`, `app/host/package.json`, `server.json`, and the Helm chart state one version, in the full gate's
  installers job.

- A Helm chart (`charts/bymorning`): one Gateway pod with its migrations in an init container, pinned by image digest,
  with the same pod hardening as the Azure manifests. It takes your database, object storage, and key, supports IRSA and
  workload identity, listener TLS, an ingress, and an evaluation mode. Its offline checks run in the full gate's
  installers job, and `charts/bymorning/test/kind.sh` installs the signed release image into a kind cluster. From
  1.3.3, the `publish` job pushes the chart to `oci://ghcr.io/bymorning/charts/bymorning` and signs it keylessly.
- `script/release/terraform-module.sh` exports the AWS module in the Terraform Registry layout (module at the root,
  README, LICENSE, `examples/basic`) for the `bymorning/terraform-aws-bymorning` mirror.

- `script/security/prerelease.ts` derives the pre-release packages that ship from `bun.lock` and fails the static CI job
  when the security review's POA&M-13 does not name each family and version, so the document cannot drift from the
  lockfile again.
- The image boot suite (`packages/server/test/image-boot.sh`) runs on a Docker network with no route out, and each leg
  ends with an egress check (SMK-41 on AWS, SMK-59 on Azure): the serving Gateway's log must show no failed lookup or
  connection to an outside host. This turns the "no call-home" statement in the security review (§9.1) into a test.

### Changed

- The UBI `nodejs-22-minimal` base is re-pinned to the 2026-11-02 build (one fewer Medium advisory, CVE-2026-8932 in
  `curl-minimal`) and the execution image's `python:3.12-slim` to the 2026-11-05 build (one fewer High advisory,
  CVE-2026-109518 in `apt`). Node and Python versions are unchanged. The vulnerability triage compares the 1.3.2 and
  1.3.3 images like for like.
- `@azure/identity` 4.14.1, which moves `@azure/msal-node` from 6.0.1 to 7.2.0 and clears the High GHSA-xcx6-jx8p-x3h5
  that 1.3.2 triaged as not affected. It also moves `open` to 11 and adds two small transitive packages (`is-in-ssh`,
  `powershell-utils`) used only by the interactive credential path.
- The security review's POA&M-13 now names every pre-release dependency that ships: six Effect RC packages, Drizzle
  ORM, and the `@opencode-ai/ai`, `codemode`, and `schema` betas, whose upstream line is no longer published. It had
  listed only "Effect RC, Drizzle RC". The remaining "provided as-is" phrases in the POA&M and control mapping now say
  "community maintained".

### Fixed

- The Models, Gateway, server runtime, and Plugins documentation no longer list a Bymorning Provider (`BYMORNING_API_KEY`)
  or a `core.provider.bymorning` built-in. Neither exists. The bundled Providers are OpenAI, Anthropic, Google,
  OpenCode Zen, Fireworks, and Amazon Bedrock. The unused `Provider.Bymorning` name is removed from
  `@bymorning/schema`; Provider names are plain strings, so persisted references still decode.
- The AWS example environment passes `task`, `fips_endpoints`, and `log_retention_days` through to the module, so an
  operator who starts from it can set them. `installers/aws/test.sh` now fails if the example stops exposing any
  module variable or its `log_retention_days` default drifts from the module's (#36).
- An exhausted Amazon Bedrock token quota ("Too many tokens per day, please wait before trying again") is reported as
  a rate limit, with Bedrock's message, instead of "Provider context window exceeded". The overflow phrase list
  matched its wording, so the Session also compacted the conversation and retried against the exhausted quota. The
  `@opencode-ai/ai` patch now treats an HTTP 429, a `throttlingException`, or the text "ThrottlingException" as a
  throttle before it looks for overflow wording; an explicit overflow code, and real overflows such as "Input is too
  long for requested model", are classified as before (#35).

### Security

- The OAuth consent page for MCP clients shows where an approval will be sent. A dynamically registered client names
  itself, so a client called "Claude Code" looked identical to the real one whatever redirect it had registered.
  `GET /api/oauth/request` now also returns `redirectOrigins` (scheme and host of the client's registered redirect URIs,
  with credentials, path, and query removed), and the page lists them and says the name is chosen by the app. The
  field is additive, and no core interface changes. Tested as `SEC-OAUTH-01`.

## [1.3.2] — 2026-11-04

Adds evaluation installations, the Docker Compose evaluation, an AWS installer, the security review package, and
ghcr.io image publishing. No database migrations and no dependency changes. The Gateway image differs from 1.3.1 only
in the host's evaluation mode.

**Project status.** ByMorning is community maintained. `SECURITY.md` and the security review package describe the
support model, and GitHub private vulnerability reporting is the security contact.

### Added

- Evaluation installations. `BYMORNING_EVALUATION=true` lets the release image run with filesystem storage
  (`STORAGE_PROVIDER=filesystem`, under `BYMORNING_DATA_DIR`), the local key (`CIPHER_BACKEND=local`, keyed by a
  required, operator-supplied `CIPHER_KEY` that is never generated), and Local Login as `evaluator@local.test` on a
  loopback `APP_ORIGIN`. Every start warns that the installation is not production, the `Host resolved` line adds
  `mode=evaluation`, and the CUI profile is refused. Without the flag the image refuses those values exactly as
  before. An evaluation installation keeps secrets under an exportable key, stores files unencrypted, signs in anyone
  who can reach its port, and cannot be converted to production; see `app/host/README.md`.
- `installers/docker`: a Docker Compose evaluation (PostgreSQL, migrate, the Gateway on `127.0.0.1:3210`).
- `installers/aws`: a Terraform installer for commercial AWS and AWS GovCloud (US) that deploys into an existing VPC:
  one ECS Fargate task (`migrate`, then the Gateway) behind an Application Load Balancer, RDS PostgreSQL 17, an S3
  bucket, and one KMS key, with the image pinned by digest from `ghcr.io` or an ECR mirror. GovCloud always uses FIPS
  endpoints and the FIPS TLS policy. `cui_profile` selects the image's CUI installation document. The module
  generates the Setup token and outputs it as a sensitive value. ECS Exec is disabled. WAF, access logs, alarms, and
  GuardDuty are left to the customer. Offline checks run in the full gate; `installers/aws/test/sandbox.md` is the
  real-account checklist.
- The security review package (`docs/security/review/`): sixteen chapters covering architecture, data flows, a NIST
  SP 800-171 / CMMC Level 2 control mapping, customer responsibilities, the secure configuration guide, cryptography,
  supply chain, external services, threat model, test report, POA&M, support, runbooks, and the release manifest,
  for both installers. `bun run security:render` renders it to a PDF for each release from the release's manifest and
  evidence; `bun run security:lint` runs in CI.
- Release images are published to `ghcr.io/bymorning/bymorning` and `ghcr.io/bymorning/bymorning-code-interpreter`
  under the version tag. The release workflow pushes them only after every gate job passes, checks each pushed
  digest against the manifest, signs them keylessly with the same identity as the evidence, and attaches the image
  SBOM and (for the Gateway) the SLSA provenance as cosign attestations (`script/release/publish.sh`).

### Changed

- The Azure export's `RELEASE-NOTES.md` no longer describes a 30-day trial and license activation, which 1.3.1 removed.
  The installer checks fail if that text returns.
- The example AWS environment passes `assign_public_ip` through, so a default VPC with no NAT gateway works. The first
  real-account test of the AWS installer (`installers/aws/test/sandbox.md`) also showed that the Code Interpreter opens
  no network connections but still resolves DNS names and answers on the microVM metadata service; the security review
  package now says so.
- `docs/security/review/release.json` may change in a release commit, so the package's scan summaries can follow the
  signed evidence.

### Security

- The execution image's Python base is re-pinned to 3.12.16, which fixes the Critical CVE-2026-115557 (the `ssl`
  compromised-certificate denylist). Re-scanning found six new High advisories with no vendor fix: three SQLite and one
  glibc in the execution image, and SQLite in Node plus `json-glib` in the Gateway base. Each has an OpenVEX statement
  (66 in total) and a disposition in `docs/security/evidence/vulnerability-triage.md`. The Gateway image has 0 Critical
  and 50 High findings by the 2026-11-04 database.

## [1.3.1] — 2026-10-29

The first release of the open-source repository, under the MIT License. It differs from 1.3.0 by the removals and
renames below, a new release-signing model, and fixes for advisories found when the build was re-scanned. The Gateway
image is rebuilt from the public tree, so its digest differs from 1.3.0.

### Security

- Re-scanning the release candidate found Critical and High advisories that the 1.3.0 triage did not cover. Fixed:
  `dompurify` 3.4.17 everywhere (GHSA-cg2g-xh64-v4q7 Critical and GHSA-mrv2-3pqr-j5jr High, on copies nested under
  `mermaid`, which the web UI ships); `body-parser` 2.4.0 (GHSA-27r3-jxmh-p828); `zod` 4.6.6 (GHSA-mrhx-c7xc-m3w5);
  and the base image re-pinned to the UBI9 Node 22 build of 2026-10-27, which fixes the Critical `ca-certificates`
  advisory CVE-2026-114406 and the High `libbrotli` advisory CVE-2026-111497. The Gateway image has 0 Critical and 41
  High advisories (1.3.0: 50 High). Three advisories remain with a recorded disposition: `@azure/msal-node` and a Node
  DNS advisory are not affected, and a Node TLS hostname-check advisory (CVE-2026-106069, no vendor fix) is on the
  POA&M. See `docs/security/evidence/vulnerability-triage.md` and `openvex.json`.

### Changed

- Release evidence is signed keylessly (Sigstore) by the `full-gate` workflow's own GitHub identity instead of a
  long-lived key in AWS KMS. A release is `full-gate.yml` dispatched with `sign=true` on a `v*` tag; the signing
  certificate names the run, and the signature is in the public transparency log. The manifest records
  `signing: { kind: "keyless", identity, issuer }`, the package pins `release/signer.txt` (with
  `release/trusted_root.json` for offline checks) in place of `release/cosign.pub`, and `mirror.sh` and the kind
  end-to-end check verify against that identity. The Azure export now refuses a signer other than `full-gate.yml` on a
  `v*` tag, verifies every signature with `cosign` before packaging, and `--rotate-key` became `--rotate-signer`
  (a new release tag is not a signer change). Gate runs still sign with a throwaway key (`ephemeral`).
- ByMorning is released under the MIT License, and the source moved to
  <https://github.com/bymorning/bymorning>.
- The theme IDs are now `bymorning`, `ink`, and `paper`. A stored preference for a retired ID falls back to the
  default theme.

### Removed

- The Installation License. Every Installation is fully functional with no trial period, no read-only mode, and no
  signed artifact: the `License` domain, its endpoints and Console page, the write gate, the trusted-signer
  configuration, and the signing scripts are gone. A migration drops the `installation_license` table. Existing
  `license.activate` audit entries still decode.
- The Terraform installer for AWS GovCloud and its customer-specific documentation. `installers/azure` remains the
  shipped Terraform installer.
- The ABC Monument Grotesk and ABC Monument Grotesk Mono fonts. The Paper theme now uses Inter and JetBrains Mono.
- The managed release key: `script/release-key.sh`, the `BYMORNING_COSIGN_KEY` and `COSIGN_PASSWORD` secrets, the
  `BYMORNING_COSIGN_KEY_ENABLED` variable, the `release` signing kind, and `BYMORNING_RELEASE_KEY` /
  `BYMORNING_SIGNING_KIND`. The `version` input of `full-gate` is gone; a release version comes from its tag.

## [1.3.0] — 2026-10-22

Adds custom Models and per-member credentials for MCP servers that authenticate
with headers, and makes Setup and sign-in failures say what to fix. No database
migrations. The image adds the AWS `sa-west-1` root certificates to its RDS CA
bundle (124 certificates). A Gateway that cannot reach its identity provider now
says so in Setup (see Changed).

**Rolling back.** Image 1.2.2 and earlier cannot read the Connections that
member values create: listing a member's credentials fails while one exists.
Before re-applying an earlier image, remove each MCP server that uses member
values (Console → Integrations → Remove); removing a server deletes every
member's saved values for it. Otherwise 1.3.0 is a drop-in replacement for
1.2.2 and a rollback needs no snapshot restore.

### Added

- Custom Models. Workspace administrators can add a Model to an active
  Provider from **AI Gateway → Models → Add model** with a display label and
  the upstream model name, for example a GovCloud Bedrock inference profile
  that IAM allows or a Model newer than the pinned catalog. Prices and a
  context limit are optional and otherwise stay unknown. Custom Models can be
  edited or deleted; bundled Models can only be disabled. A key the Provider
  already uses is refused. Changes are audited as `model.create`,
  `model.update`, and `model.delete`; the API is `POST`/`PUT`/`DELETE
/api/models`, and the definitions are stored as server-owned `models` in
  Workspace configuration.

- Member values for outbound MCP servers. An MCP server's headers can ask
  each member for their own value with `${NAME}` (for example
  `JiraToken: ${JIRA_PERSONAL_TOKEN}`) and fill the member's verified email
  with `${member.email}`; other header values stay shared. Each member saves
  their values through **Authenticate**; they are stored encrypted as that
  member's Connection, sent only to that server on that member's requests, and
  never shown again. A member without values sees **Authentication required**
  and gets none of the server's Tools; values the server refuses show
  **Server rejected your values**. Member values require `oauth: false`.
  Changing a server's URL or removing it discards every member's values. The
  **Add MCP server** dialog now accepts headers and the authentication choice.
  The API is `POST /api/integration/:integrationID/connect/values`, audited as
  `credential.connect` with the value names only. Any member saves their values
  from the command palette (**Connect integration**, under **MCP servers**);
  administrators also see, on the server's page, which members have saved
  values and when (`GET /api/mcp/server/:server/member`), never the values.

### Changed

- `GET /api/config` (and the update and refresh responses) now redact shared
  MCP header values for everyone except Workspace administrators. A redacted
  document returned unchanged is not treated as an edit.
- **Connect integration** lists MCP servers first, under their own heading,
  with a plain description instead of their internal identifier.
- `PUT /api/mcp/server/:server` now saves `headers` instead of silently
  dropping them, and refuses invalid settings with `400` instead of `500`.
- Removing a Workspace member now deletes that member's own Connections
  (OAuth tokens and member values) in the Workspace.
- Setup and Settings now say why an identity provider was refused instead of
  "Authentication is unavailable": unreachable (check the Gateway's outbound
  HTTPS access to the issuer), issuer mismatch, no valid discovery document,
  missing endpoints, no authorization-code flow, no PKCE S256, or no client
  secret method. A Gateway with no route to the issuer answers Setup with `503`;
  the others answer `400`.
- A failed sign-in returns to `/login?auth=failed&reason=<code>` with one of
  `exchange`, `claims`, `domain`, `provider`, `expired`, `account` or `unknown`,
  and the login page shows a hint for each. No tokens, emails or provider
  response bodies are shown. New documentation page **Deploy → Microsoft Entra**.

### Fixed

- Workspace configuration change notifications are published after the
  surrounding transaction commits, and a configuration refresh waits for an
  in-flight write, so an audited configuration change can no longer be
  briefly reverted in memory by a concurrent refresh.

### Security

- `@modelcontextprotocol/client`, `core` and `server` 2.2.0 → 2.3.1, for
  GHSA-jm63-cq47-j5jp, GHSA-46jr-4wx8-v453 and GHSA-rvq5-wwqv-78pq (published
  2026-10-20). The Gateway builds a new MCP server for each request and does not
  use the SDK's bearer-auth helper, and its handler is not the high-level path
  the memory advisory describes, so none was exploitable here; the upgrade
  removes them from the release evidence.
- `undici` 7.30.1 and 8.12.2 in the lockfile, clearing CVE-2026-109383,
  CVE-2026-109829, CVE-2026-109869 and CVE-2026-87018 for the copies the
  repository resolves. Neither copy ships in the Gateway bundle, which uses the
  undici vendored in Node; CVE-2026-109869 and CVE-2026-87018 stay open in the
  image until Red Hat ships a Node 22 update (see the triage POA&M).
- The release pipeline records which key signed each artifact. Exports now
  refuse evidence that is not signed with the release key, and `mirror.sh`
  verifies the tarball's cosign bundle and OCI structure before pushing.

## [1.2.2] — 2026-10-16

### Fixed

- In AWS GovCloud (US) Regions the model catalog now offers the `us-gov.`
  cross-Region inference profiles AWS documents for GovCloud (Claude Sonnet
  4.5, Sonnet 5, Opus 5, Opus 4.8, Fable 5.1, and Haiku 4.5), defaults to
  `us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0`, and marks commercial
  profiles (`us.`, `global.`, `eu.`, ...) and model IDs that are served only
  through a geography profile as unavailable in the Region, so they are no
  longer listed, invoked, or chosen as the default model. 1.2.1 offered only
  commercial IDs there, which AWS denied. Commercial Regions no longer list
  `us-gov.` profiles.

## [1.2.1] — 2026-10-08

### Fixed

- The image's RDS CA bundle now includes the AWS GovCloud roots, so
  `sslmode=verify-full` connections to Aurora in `us-gov-west-1` and
  `us-gov-east-1` verify; 1.1.0 and 1.2.0 failed with
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.
- OAuth connections no longer lose their saved token fingerprints on every
  Gateway restart, which stopped refreshed tokens from being saved and could
  force members to reconnect; affected connections are repaired the next time
  their token is refreshed.

## [1.2.0] — 2026-10-06

One Gateway image for every cloud, bound at startup by the installer. The
release is cut from `dev` with `bun script/release.ts`.

**Breaking for deployers.** The image refuses to start unless the deployment
sets `STORAGE_PROVIDER` (`s3` | `azure-blob`) and `CIPHER_BACKEND` (`kms` |
`keyvault`) with their companion variables; the refusal names the variable.
Apply the installer and the image together from the same release: the AWS ECS
task definition adds `STORAGE_PROVIDER=s3`, `CIPHER_BACKEND=kms`, and
`AWS_USE_FIPS_ENDPOINT=true` to the gateway container; the Azure base
ConfigMap adds `STORAGE_PROVIDER=azure-blob` and `CIPHER_BACKEND=keyvault`,
and `overlay.sh` adds `AWS_USE_FIPS_ENDPOINT=true` for Bedrock in a `us-gov-*`
Region. The full contract is in `app/host/README.md`.

### Added

- `app/host` (`@bymorning/host`): the one host program. `Host.resolve` reads
  the environment, selects the storage and key backends, and enforces the
  startup rules (selector and companion presence, `AZURE_CLOUD` with no
  default, `CREDENTIAL_KMS_KEY` in `AWS_REGION`, `us-gov-*` requires
  `AWS_USE_FIPS_ENDPOINT=true`, digest-pinned Kubernetes execution image,
  `https:` `APP_ORIGIN` unless loopback). `migrate` reads only `DATABASE_URL`
  and `DATABASE_CA` and loads no cloud backend; its peak RSS halves.
- One release command and manifest: `script/release.ts` builds the Gateway
  and execution images and writes `release/manifest.json`; evidence lands in
  `release/<version>/gateway/` and `release/<version>/execution/`.
  `installers/azure/export.ts` assembles the Azure package and `installers/azure/release/mirror.sh` pushes both
  images to ACR. Provenance `buildType` and the OpenVEX `@id` are
  installer-neutral.
- A full gate (`.github/workflows/full-gate.yml`) on every push to `dev`,
  nightly, and on dispatch for releases: both images built and signed, the
  image security gate, AWS and Azure boot legs, the Azure kind end-to-end
  suite, browser suites, and installer checks.
- Project archiving: archive a Project from its settings and restore it from
  "Restore an archived project" in Create project. An archived Project is
  read-only (no new Sessions or Messages; its Scheduled Tasks skip their
  occurrences). The Default Project cannot be archived.
- Project file management in the Right Sidebar: upload, download, rename or
  move, and delete files and folders. Moves are recorded in the audit log as
  `file.move`.
- Archived Sessions view on the project page (Active/Archived switch) with
  Restore. Archiving a Session asks for confirmation and the toast offers Undo.
- Integrations Console page (replaces MCP, same `/mcp` path): one Connected
  list of services, web search providers, and MCP servers with a kind tag and
  status, one "Add integration" picker (administrators add custom MCP
  servers), and the request log. Model Provider integrations stay on the
  Models page. The unlinked `/integrations` route is removed; members connect
  their own account from the "Connect integration" command.
- Assistant introspection: the `toolkit.plugin.list` and
  `toolkit.integration.list` Tools let the assistant see Plugin activation
  status and errors and Integration configuration; the assistant now knows the
  member's Role and the real Console page names instead of inventing a
  "Settings" page.

### Changed

- `AWS_USE_FIPS_ENDPOINT` is no longer baked into the image. The deployment
  sets it (AWS ECS task definition, SST stack, Azure GovCloud overlay); the host
  refuses a `us-gov-*` Region without it. The image gate asserts no deployment
  environment is baked in and that both the OpenSSL configuration and the RDS
  CA bundle are present.
- The image contains both cloud backends (S3 with KMS, Blob Storage with Key
  Vault) and both production Code Interpreter plugins (AgentCore, Kubernetes).
  Only `packages/core` stays banned from cloud SDKs.
- Web sign-in decides local versus SSO at runtime from `/auth/method`; the
  compile-time `VITE_LOCAL_LOGIN` flag is gone, so one web build serves every
  deployment.
- Dependency security bumps: `dompurify` 3.4.16, OpenTelemetry 2.11 / 0.222,
  `valibot` 1.5 by override, `blume` 1.7 for the docs theme (clears the Astro
  AVIF advisory), `vitest` 4.1.11, `@mermaid-js/mermaid-cli` 12, and
  `lodash-es` 4.18.1 and `@scalar/json-magic` 0.15.5 by override (docs and
  diagram tooling), `@modelcontextprotocol/client`/`core`/`server` 2.2.0
  (MCP OAuth credential advisory), and by override `seroval` 1.6.8,
  `proxy-addr` 2.0.8, `source-map-js` 1.2.2, `shell-quote` 1.12.0 and
  `@modelcontextprotocol/sdk` 1.32.1 (advisories published 2026-10-06);
  `bun audit` drops from 97 advisories (1 Critical, 25 High) to 5 (0 Critical,
  2 High, 2 Moderate, 1 Low); both Highs are in docs-only tooling with no
  applicable fix.
- The Code Interpreter execution image base is re-pinned (`python:3.12-slim`
  2026-10-01: Python 3.12.15, Debian OpenSSL 3.5.7-1~deb13u3).
- Tests: one PostgreSQL server per vitest run with one template-cloned
  database per test, one storage and one cipher contract suite run against
  every implementation, a host startup contract, and a parallel PR gate
  (static, unit matrix, two application shards, core integration) that
  finishes in about six minutes and covers suites that never ran in CI.
- Project plugins now load in the production image. Previously a Project
  plugin could not resolve `@bymorning/plugin` or `effect` and never activated;
  the plugin inventory now shows the loader error (paths redacted). Installation
  Policy applies on load: a plugin blocked by an allowlist or `plugins: "off"`
  is not loaded and reports `Blocked by Installation Policy`.
- Streaming Sessions write far fewer database updates (about 6 instead of
  2,000+ for a 2,000-delta reply), so other chats no longer slow down while one
  streams. Unsaved output is lost on a crash for at most 250 ms of text.
- Sessions open faster (one fewer round trip) and the browser does less work
  on Session and permission events and on long streams.
- The per-message token estimate is gone from assistant messages; Session
  usage stays in the header.
- Startup refusals never echo configured values; a fatal startup error logs one
  `Startup failed` line, `migrate` failures name the SQLSTATE or Node error
  code, and `Host resolved` logs the live backends. `AWS_USE_FIPS_ENDPOINT`
  must be exactly `true` or `false`, and the `us-gov-*` rule applies to every
  selection. `CREDENTIAL_KMS_KEY` must be a full key ARN whose Region equals
  `AWS_REGION`.
- Console: consistent page widths, tables usable at phone and tablet widths,
  switch contrast in every theme, and unsaved-changes guards on Routing and
  Installation Policy.
- Budgets show an over-limit state, and a refusal caused by the Workspace
  budget says so.
- Tool failures are shown in plain language; generated Session titles are
  cleaned, with a fallback for code-only prompts. Archiving or restoring a
  Session keeps its position.
- Contextual browser tab titles and proper not-found pages.
- Chat: line breaks render, composer focus is kept after send, Stop, attach,
  and model pick; code blocks get a label, Copy, and a height cap; Mermaid
  sizing and Code Interpreter and question output are readable.

### Fixed

- Last-admin protection: inviting your own email as a Member no longer demotes
  the Workspace's only admin, and concurrent demotions or removals are
  serialized so the last admin cannot be removed.
- Errors in SSO, Grant admin, and invite dialogs are now shown.
- Switching Sessions after a reload could blank the view ("Cannot read
  properties of undefined").
- The file tree, open preview, and `@file` list update when the assistant
  writes or edits Project files, with no refresh.
- The timeline no longer throws "Stale read from <Match>".
- The Agents list and sidebar order and age update live.
- Fixes on the Models, Routing, Service accounts, Members, Audit,
  Installation, Scheduled tasks, and Agents/Skills pages, including a
  stale-save race in policy forms.
- Closing a dialog opened from an action menu returns keyboard focus to the
  menu's button instead of the page.
- Routing names rules on built-in Tools (such as `read`) instead of showing
  them as unavailable.
- A session no longer crashes to an error page when the connection drops
  while its transcript is still loading.
- Startup on Azure stops after 60 seconds with an error naming Key Vault or
  Blob Storage when either stalls, instead of waiting for the pod probe.
- A Project plugin with a malformed integration method no longer blocks its
  Workspace; the plugin is reported as failed with the reason (for example, an
  OAuth method without an `authorize` function) while other plugins keep
  working. A plugin generation that fails to apply is no longer retried until
  its sources change, so Workspace requests stop hanging behind a reload loop.

### Security

- Invite-domain refusals give guidance only and no longer list the domains the
  Workspace admits.
- Cipher key identity: `Cipher.Backend.unwrap` receives the envelope's key
  identity. KMS refuses any identity other than the configured ARN and never
  passes a database value to `Decrypt`; Key Vault reads the key version from
  the identity and stops writing its private in-band frame while still reading
  legacy framed and bare data keys; the local backend requires `local`. Data
  written under earlier Key Vault versions stays readable after rotation while
  those versions are enabled. A stored Credential whose key the backend cannot
  serve answers `503 ServiceUnavailableError` (`Credential key is
unavailable`) instead of a bare 500. (`SEC-CRYPT-11`…`SEC-CRYPT-14`)

### Removed

- `app/aws`, `app/azure`, `app/local`, the build profiles and `--profile`,
  the self-contained image stage and its documentation page, and
  `SEC-IMG-13` (the other cloud's SDK is present by design).
- `installers/aws` and `docs/terraform-production`; the commercial SST stack is
  the AWS deployment.
- The three `release/image*.txt` files are no longer written by the release;
  the manifest replaces them and the installer export materializes what its
  package expects.
- The duplicate `local-postgres` compose service on port 5433.

### Upgrade notes

- Database: one additive migration adds `archived_at` to projects; it runs with
  `migrate` and needs no action.
- API: `DELETE /api/project/:id/directory/file` and
  `POST /api/project/:id/directory/move` (409 `ProjectFile.ConflictError` on a
  name clash); `archived` on Project list and update; archived or Default
  Project operations answer 409 (`Project.ArchivedError`,
  `Project.DefaultError`). The `project.file.changed` event is now delivered to
  clients. The generated SDK is updated.
- Audit: new `file.move` action.

## [1.1.0] — 2026-09-30

First stable release for both deployments, from one version and one commit of
`dev`. It is 1.1.0-rc.1 (`0e5150d53830`), which passed manual testing in AWS
production and Azure, with no application change. It supersedes 1.0.2-rc.5
(AWS) and 1.1.0-azure.rc.1 (Azure). Three artifacts are released: the AWS
Gateway image (`release/image.txt`), the Azure Gateway image (`--profile azure`,
`release/image-azure.txt`) and the Code Interpreter execution image
(`release/image-execution.txt`). Evidence is under `release/1.1.0/` (Azure in
`release/1.1.0-azure/`).

**Security note for existing 1.0.2-rc.1 installations.** 1.0.2-rc.1 had a
cross-Workspace credential and configuration isolation defect: Workspace
activations shared state, so one Workspace's credentials or configuration could
be visible to another. It is fixed in 1.0.2-rc.2 and later and in this release.
Do not run 1.0.2-rc.1 in a deployment with more than one Workspace.

### Added

- Azure deployment (`app/azure`, `installers/azure`): Blob Storage, Key Vault
  Cipher, Azure Government endpoints via `AZURE_CLOUD`, Amazon Bedrock through
  the AWS credential chain, and a Terraform and Kustomize installer with smoke
  and kind end-to-end tests.
- Kubernetes Code Interpreter: per-call pods, RBAC, NetworkPolicy and an
  isolation guide; enabled with a digest-pinned execution image.
- Microsoft Entra sign-in accepts `xms_edov` as a verified email and supports
  Azure Government as an Entra cloud.
- Self-contained deployments: `DATABASE_CA` for PostgreSQL TLS, secret-held
  cipher key, and a `migrate` command.
- Optional digest-pinned `BYMORNING_IMAGE` for the AWS Gateway so a tested
  release deploys unchanged.

### Changed

- The AWS Terraform installer moved from `installers/terraform` to
  `installers/aws`.
- Cipher and storage backends live in `@bymorning/backend-*` packages; Bedrock
  is present in every image profile.
- The root, `app/aws` and `app/azure` packages share one version.

### Fixed

- Workspace isolation: each Workspace activation is built with its own memo map,
  so state no longer leaks between Workspaces.
- Request limits: body limits no longer reset real clients; plugin cache and
  installs work on container hosts.
- Message composer: drafts up to 500,000 characters can be sent (carried from
  1.0.2-rc.5).
- Audit log uses the full page width; leaderboard share bars fill to the
  percentage shown.

## [1.1.0-rc.1] — 2026-09-29

Release candidate promoted unchanged to 1.1.0.

### Added

- Azure deployment (`app/azure`, `installers/azure`): Blob Storage, Key Vault
  Cipher, Azure Government endpoints via `AZURE_CLOUD`, Amazon Bedrock through
  the AWS credential chain, and a Terraform and Kustomize installer with smoke
  and kind end-to-end tests.
- Kubernetes Code Interpreter: per-call pods, RBAC, NetworkPolicy and an
  isolation guide; enabled with a digest-pinned execution image.
- Microsoft Entra sign-in accepts `xms_edov` as a verified email and supports
  Azure Government as an Entra cloud.
- Self-contained deployments: `DATABASE_CA` for PostgreSQL TLS, secret-held
  cipher key, and a `migrate` command.
- Optional digest-pinned `BYMORNING_IMAGE` for the AWS Gateway so a tested
  release deploys unchanged.

### Changed

- The AWS Terraform installer moved from `installers/terraform` to
  `installers/aws`.
- Cipher and storage backends live in `@bymorning/backend-*` packages; Bedrock
  is present in every image profile.
- The root, `app/aws` and `app/azure` packages share one version.

### Fixed

- Workspace isolation: each Workspace activation is built with its own memo map,
  so state no longer leaks between Workspaces.
- Request limits: body limits no longer reset real clients; plugin cache and
  installs work on container hosts.
- Message composer: drafts up to 500,000 characters can be sent (carried from
  1.0.2-rc.5).
- Audit log uses the full page width; leaderboard share bars fill to the
  percentage shown.

## [1.1.0-azure.rc.1] — 2026-09-29

Azure Government release candidate (`--profile azure`; the AWS release is
unchanged). Built from `327570ffc61a`; digests in `release/image-azure.txt` and
`release/image-execution.txt`.

### Added

- Azure host (`app/azure`): Blob Storage, Key Vault Cipher with versioned data
  keys, `AZURE_CLOUD` (`AzureCloud` | `AzureUSGovernment`) endpoint selection
  with fail-closed host validation, Amazon Bedrock through the AWS default
  credential chain (web identity supported).
- Kubernetes Code Interpreter plugin bundled; enabled per deployment with a
  digest-pinned execution image (`app/azure/bymorning.kubernetes.example.jsonc`).
- `installers/azure`: Terraform module, Kustomize kit, `smoke.sh`.
- Microsoft Entra sign-in accepts `xms_edov`; Entra cloud selector (Commercial
  or Azure Government).
- `script/release.ts --profile <name> --version <semver>`; execution image
  release (`script/release-execution.ts`) with SBOM, scan and signatures.

## [1.0.2-rc.5] — 2026-09-29

Release candidate superseding 1.0.2-rc.4 (`2be292d586c2`, `sha256:106c9e5077fc…`),
in which a long draft could be pasted but not sent. It adds the change below to
1.0.2-rc.4; the image stays linux/amd64 on the same UBI 9 FIPS base.

### Fixed

- Message composer: Send and Enter ignored drafts longer than 8,000 characters.
  Submission now uses the same 500,000 character limit as the editor.

## [1.0.2-rc.4] — 2026-09-29

Release candidate superseding 1.0.2-rc.3 (`ae12992d15d5`, `sha256:e376c7dfcdba…`).
It adds the change below to 1.0.2-rc.3; the image stays linux/amd64 on the same
UBI 9 FIPS base.

### Fixed

- Message composer: drafts were truncated at 8,000 characters (about 1,200 words),
  silently cutting pasted documents. The limit is now 500,000 characters (about
  75,000 words), and the editor's undo history keeps at most 100 entries.

## [1.0.2-rc.3] — 2026-09-29

Release candidate superseding 1.0.2-rc.2 (`3f06fdae57d6`, `sha256:c8d60d720368…`).
It adds the changes below to 1.0.2-rc.2; the image stays linux/amd64 on the same
UBI 9 FIPS base.

### Fixed

- Request size: the 40 KiB default request limit applied to every route, including
  `/inference`, whose 10 MiB override never took effect. Coding agents such as
  OpenCode, Claude Code, and Codex (whose requests carry the system prompt and Tool
  definitions), pasted documents in a prompt, long Skill and Agent instructions, and
  large MCP Tool arguments failed. Limits are now 32 MiB for `/inference`, 10 MiB for
  `/api` and `/mcp`, and 40 KiB for the remaining public routes; Project file
  uploads keep their 20 MiB limit.
- A request declaring a body larger than its route's limit receives `413` (in the
  caller's native envelope on `/inference`) instead of a reset connection, which
  proxies reported as `502`.
- Project Plugins: the Gateway could not create its Plugin cache (`EACCES` on
  `.bymorning` under the read-only image root), so Project Plugins never loaded. The
  cache now lives under the temporary directory, and runtime package installation
  and update checks (which need `bun`, absent from the image) are disabled.

## [1.0.2-rc.2] — 2026-09-29

Release candidate superseding 1.0.2-rc.1 (`9564a2ed0a14`, `sha256:00d4d638ca67…`),
which must not be used in an installation with more than one Workspace. It adds
the change below to 1.0.2-rc.1; the image stays linux/amd64 on the same UBI 9
FIPS base.

### Security

- Workspace isolation: each Workspace's Catalog (Provider directory, Model
  list and default, Provider Activation) is now built from that Workspace's own
  Credentials and Config. Previously the first Workspace activated in a process
  supplied these to every other Workspace, so a Workspace could see another
  Workspace's Connections and invoke Providers with them, did not see its own
  new Connections, and could write Provider Activation and default Model
  changes into the other Workspace's Config.

### Changed

- SST: `BYMORNING_IMAGE` optionally pins the Gateway to an already pushed,
  digest-addressed release image instead of rebuilding it.

## [1.0.2-rc.1] — 2026-09-29

Release candidate for the next delivered release. It has not been delivered.
It adds the changes below to 1.0.1; the image stays linux/amd64 on the same
UBI 9 FIPS base.

### Fixed

- A released plugin's configuration watcher no longer publishes changes late,
  and each watcher is owned by the scope of its source layer.

### Testing

- `packages/server/test/image-boot.sh` boots the release image against a local
  PostgreSQL and verifies a release tarball (digest, blobs, labels, image
  command against the task definition) before it is loaded.

## [1.0.1] — 2026-09-28

The first delivered release. 1.0.0 was built as a release candidate
(`567205d7c6b3`, `sha256:12281e17a2fb…`) and not delivered; 1.0.1 supersedes it
and includes every change listed under 1.0.0.

### Security

- Release signatures are made with a key held in AWS KMS (ECDSA P-256); the
  private key never leaves KMS. `release/cosign.pub` carries the new public
  key, which replaces the 1.0.0 release-candidate key.

### Fixed

- Terraform: the `setup_token` root variable is wired through the `dev` and
  `prod` roots so `prod` (ECS Exec off) can supply the Setup token up front.
- "Your sessions" is renamed "Login sessions", and its menu no longer races
  when opened.
- Session usage toggles correctly from its hidden default and no longer shows
  a loading state after a failed provider load.
- Context usage is measured from the latest observed execution.

## [1.0.0] — 2026-09-26 (release candidate, not delivered)

The first customer release (AWS GovCloud, CMMC L2).
Covers everything since the previous exported release commit
`0c338296ceb3` (2026-09-16).

### Security

- Durable Login Sessions: the browser cookie now carries a server-side session
  record with a 12-hour absolute bound and a configurable idle bound
  (`SESSION_IDLE_TIMEOUT`, default 15 minutes); logout, self-service revocation
  under "Login sessions", and administrative revocation take effect immediately,
  and v1 cookies are refused. The web app locks its display behind a
  pattern-hiding gate at the idle bound. (`SEC-SESS-01`…`SEC-SESS-12`)
- The MCP authorization server's OAuth grants carry a 30-day absolute refresh
  expiry with rotation and superseded-hash reuse detection (family revocation
  per the OAuth 2.0 Security BCP); accounts list and revoke their own grants,
  and suspension revokes account-wide. (`SEC-SESS-06`…`SEC-SESS-10`)
- Installation governance: a new Installation Admin role — bootstrapped from
  the first login after Setup, granted per Account with last-admin protection —
  owns Auth Provider management, License activation, the Installation Policy
  lock, and Account suspension/restoration; provisioning is invite-only by
  default. (`SEC-INST-01`…`SEC-INST-07`)
- Audit trail: security-relevant mutations append tamper-evident, hash-chained
  Audit Entries in the same transaction (fail-closed), retained for
  `AUDIT_RETENTION_DAYS` (default 365), mirrored to stderr as structured JSON
  lines for SIEM ingestion, and reviewable in the Console Audit log —
  Workspace-scoped for administrators, installation-wide for the Installation
  Admin. (`SEC-AUDIT-01`…`SEC-AUDIT-17`)
- Credential-at-rest envelope encryption: Credential values, OAuth tokens, and
  Auth Provider client secrets are AES-256-GCM encrypted under data keys wrapped
  by the installation's KMS key (`CREDENTIAL_KMS_KEY`, wired to the module's
  secrets CMK) or a local key file; a boot migrator rewrites legacy plaintext
  and fails closed on undecryptable rows; the Setup token is stored hashed.
  (`SEC-CRYPT-01`…`SEC-CRYPT-10`)
- Deleting a Project now durably purges its storage prefix through an
  outbox drained at boot and on an interval, recording a `file.delete` Audit
  Entry per drained intent. (`SEC-PURGE-01`…`SEC-PURGE-03`)
- LLM Gateway usage is attributed to the authenticated caller principal
  (Service Account Key or member), not only the Workspace.
  (`SEC-USAGE-01`…`SEC-USAGE-02`)
- Admin authority is enforced at the Core domain seam — Config and Catalog
  mutations take the explicit Actor — so the in-session toolkit Tools cannot
  bypass the Workspace admin gates. (`SEC-TOOLAUTHZ-01`…`SEC-TOOLAUTHZ-05`)
- The Gateway runtime image is now Red Hat UBI 9 Node.js 22 (minimal), running
  all Node.js cryptography on the FIPS 140-3 validated RHEL 9 OpenSSL FIPS
  Provider (CMVP certificate #4857) via an image-baked OpenSSL configuration;
  `crypto.getFips()` reports 1 and the process fails closed if the module
  cannot load. Both build and runtime base images are pinned by digest.
  `AWS_USE_FIPS_ENDPOINT=true` is set for AWS service calls.
- Every release now produces a signed evidence folder beside
  `release/image.txt`: CycloneDX and SPDX SBOMs of the image, a source
  dependency SBOM from `bun.lock`, grype vulnerability scan and summary, a
  license report, gitleaks and semgrep scan results, a SLSA v1 provenance
  statement, SHA256SUMS, and cosign signatures over the tarball, sums, and
  provenance. See `release/<version>/` after running
  `script/release.ts`.
- The Gateway serves the ALB hop over HTTPS with TLS 1.2+ and FIPS-approved
  AES-GCM suites only.
- Added repository CI: pinned GitHub Actions for install, lint, typecheck,
  unit tests, gitleaks, semgrep, and OSV dependency scanning, plus a manual
  release-evidence workflow.
- License artifacts are now signed with ECDSA P-256 (SHA-256, IEEE P1363
  encoding), FIPS 186-5 approved: verification works in the FIPS image
  (`SEC-IMG-09`/`SEC-IMG-12`). The artifact prefix is `bml2_`; Ed25519 `bml_`
  artifacts are no longer issued or accepted (no deployed Installation
  predates the migration). New production and development signers; the
  production private key lives outside the repository.
- The AWS image ships a second bundled installation profile, the CUI profile
  (`/app/bymorning.cui.jsonc`: AgentCore Code Interpreter only, no Share or
  Google plugin). `BYMORNING_CONFIG` selects an installation document by path
  and fails closed when it is unreadable or invalid; the installer's
  `config_file` variable passes it to the task (`SEC-CFG-01`…`SEC-CFG-04`).
- Under the image's `AWS_USE_FIPS_ENDPOINT=true`, in-process-signed Bedrock
  Converse model traffic now uses the FIPS-designated
  `bedrock-runtime-fips.<region>.amazonaws.com` hostname (SigV4 service scope
  unchanged). Bedrock Mantle has no FIPS-designated endpoint and keeps the
  standard hostname, announced once at startup (`SEC-FIPSEP-01`…`SEC-FIPSEP-05`).
- Model routing (config section `routing`, `model.route`) is restricted to
  Workspace administrators together with the other security-relevant Config
  sections (plugins, providers.allow, gateway, websearch, code_interpreter,
  tool_output, default_agent); Policy, Budget, Service Account, Credential,
  Integration, Skill, and shared Model mutations likewise require the admin
  Role. See `packages/testing/test/security/authz-matrix.test.ts`.
- Web hardening: security headers (CSP, HSTS, frame and referrer policy),
  explicit CORS, an SSRF egress guard on the web-fetch Tool, rate limiting on
  the public authentication endpoints with trusted-proxy configuration, a
  setup-token file flow, invitation domain enforcement, an optional
  `LOGIN_BANNER` system use notification, and `Cache-Control: no-store` on
  authenticated responses.
- The Aurora connection now requires `sslmode=verify-full` against the AWS
  global RDS CA bundle, which the image carries pinned by sha256 at
  `/app/certs/rds-global-bundle.pem`; the AWS installer adds optional
  CloudTrail data events, GuardDuty malware scanning, WAF, alarms, S3 Object
  Lock, VPC endpoints, and KMS key administrators, and production keeps ECS
  Exec off.

### Added

- Model routing: judged Tiers and Auto names route Session and Gateway
  requests through routing rules with text and tool conditions, a routing
  preview for administrators, and a route fallback header; License expiry is
  enforced as typed API middleware.
- License domain: signed artifacts, activation, expiry enforcement at the API,
  gateway, and scheduler edges, Console page with countdown and read-only
  banner, and signing/keygen tooling.
- Scheduled Tasks: unattended agent runs on a schedule, dashboard management,
  missed-run notice, and toolkit tools.
- Skill library: installable engineering Skills replacing the bundled
  engineering plugin; Skills list, descriptions, and one dialog to read, edit,
  and delete.
- Agents: the Build Agent is retired (every created Agent is a subagent),
  administrators can replace and restore a built-in Agent, and the Default
  agent is managed separately from Subagents.
- First-run experience: guided Setup steps with per-provider callback URLs,
  empty-workspace guidance, and a redesigned login.
- Console administration: selectable usage metric and formatted scale on the
  Overview chart, per-row spend share on the leaderboard, Workspace default
  Model selection, one-step API key creation for Service accounts.
- Console: new Audit log page (filters, cursor pagination, CSV export) and
  Installation pages (Admin grants, Policy lock); the account menu gains a
  "Login sessions" manager and a grants listing.
- Customer delivery: the release travels as an OCI tarball with a pinned digest.

### Fixed

- Provider failures behind compaction errors are surfaced; replayed reasoning
  is retried with visible history; aggregator models authenticate with their
  format's native header; no-argument Tools advertise empty object schemas;
  estimated spend is reserved so concurrent inference shares a Spend Limit.
- License expiry is surfaced on refused writes; the License page refreshes
  after activation; the Setup token copy is clearer; dialogs behave correctly
  under stacking and outside clicks.

[Unreleased]: https://github.com/bymorning/bymorning/compare/v1.3.3...dev
