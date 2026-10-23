# ByMorning

With Bun and Node 22+, run from the repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3000; local sign-in continues straight to the workspace. The development host persists
Postgres-compatible data with PGlite under `.bymorning/local/pglite`; Docker is not required for the database. `dev`
runs the API watcher on port 3210 and Vite concurrently; the API runs migrations at startup. Build the execution image
with `bun run --cwd app/host setup` when you need Code Interpreter. Local development requires no SST or AWS
credentials; SST remains the supported AWS deployment tool, and [the Azure installer](installers/azure/README.md)
deploys to AKS with Terraform.

To configure both application ports:

```bash
PORT=4001 WEB_PORT=4000 bun run dev
```

`PORT` controls the API; `WEB_PORT` controls Vite and the default login callback origin. `bun run local` is instead the
bundled, one-origin development host. See [the host guide](app/host/README.md) for the deployment contract, the
development defaults, Vite arguments, and database ownership.

## Application bundles

One host program, `app/host`, serves every deployment. Its production build is what the root `Dockerfile` ships:

```bash
bun run --cwd app/host build
node app/host/dist/bymorning.mjs
```

It requires the deployment's storage and key selectors (`STORAGE_PROVIDER`, `CIPHER_BACKEND`), their companions, and
the database, cookie, and origin settings documented in [app/host/README.md](app/host/README.md). The development
build adds PGlite, filesystem storage, the local cipher, and the Docker Code Interpreter and needs nothing set:

```bash
bun run --cwd app/host build:dev
node app/host/dist/bymorning.mjs
```

Distribute the complete `dist/` directory, including the installation documents and the loadable plugin packages. The
Docker image runs the production bundle with Node; no compiled application executable is built.

## Database

Run all database operations from `packages/core` so Drizzle uses the Core configuration. `sst shell` supplies the
selected stage's linked `Database` resource:

```bash
cd packages/core

bunx sst shell --stage <stage> -- bun db generate --name <migration_name>
bunx sst shell --stage <stage> -- bun db migrate
bunx sst shell --stage <stage> -- bun db studio
bunx sst shell --stage <stage> -- bun db:check
```

Generate a migration after changing the Core schema, then inspect the generated SQL and snapshot before applying it.
Never edit, replace, or delete a migration that has been applied to any stage. Make follow-up changes with a new
forward migration instead.

Apply migrations before deploying code that depends on them. SST deployments run the migration Lambda before
updating the Server and stop the deployment when migration fails.

PostgreSQL migrations are forward-only and live in `packages/core/src/database/migration/`. The current development
baseline is a destructive clean break; databases created from the previous migration history must be reset.

## Terraform (Azure)

Azure installations deploy with Terraform and Kubernetes manifests. Follow [the Azure installer](installers/azure/README.md):
AKS, Key Vault, Blob storage, PostgreSQL, and a digest-pinned image mirrored into your registry.

## Releases

A release is one Gateway image, delivered as a linux/amd64 OCI tarball pinned by digest, plus signed evidence (SBOMs,
vulnerability and license reports, scans, SLSA provenance, `SHA256SUMS`). It is installer-neutral: every installer
delivers the same tarball and verifies the same digest. Releases are cut on a maintainer machine.

Prerequisites: Docker with buildx; `syft grype cosign gitleaks semgrep` (`brew install ...`); and a cosign signing key.
The maintainers keep the release key in AWS KMS (`script/release-key.sh` creates one and exports its public key to
`release/cosign.pub`); any cosign key reference works for your own builds. Point cosign at it before building, for
example:

```bash
export BYMORNING_COSIGN_KEY=awskms:///alias/<your-key-alias> AWS_REGION=<region>
```

1. Set the version in the root `package.json` and date its section in `CHANGELOG.md`, then commit. The build refuses
   a dirty tree.
2. Build both images and their evidence:

   ```bash
   bun script/release.ts
   ```

   This writes `release/bymorning-<commit>.tar` (the Gateway) and `release/bymorning-code-interpreter-<commit>.tar`
   (the code execution image; both gitignored), records them in `release/manifest.json`, and writes the signed
   evidence to `release/<version>/gateway/` and `release/<version>/execution/`. The build is reproducible: rebuilding
   the same commit yields the same digests. `--skip-evidence` is for throwaway builds only; `--only gateway|execution`
   rebuilds one image. Each artifact's `signing` in the manifest records which key signed its evidence: `release`
   (the maintainers' release key), `ephemeral` (any other key), or `unsigned`, with the SHA-256 fingerprint of the
   key's DER bytes.

3. Commit `release/manifest.json` and `release/<version>/`, tag, and publish the GitHub Release:

   ```bash
   git add release && git commit -m "release: <version>"
   git tag v<version> && git push origin v<version>
   gh release create v<version> --notes-file <changelog excerpt> \
     release/bymorning-*<commit>.tar release/manifest.json release/<version>/*/*   # the evidence includes cosign.pub
   ```

4. Package the Azure installer from the manifest:
   `bun installers/azure/export.ts --out <directory>` (`bymorning-azure-<version>.zip`). It runs from the release
   build or a descendant that changes only `release/`, `CHANGELOG.md`, `docs/security/evidence/`, and package
   versions (`--force` overrides), refuses evidence that is not signed with the release key (`--allow-unsigned`
   exports a marked "UNSIGNED REHEARSAL"), and refuses to replace a target's `release/cosign.pub` with another key
   without `--rotate-key`.

`release/cosign.pub` pins the release signing public key; each signed evidence folder's `cosign.pub` must equal it.
The `full-gate` workflow in GitHub Actions (`.github/workflows/full-gate.yml`) runs the same build and evidence
pipeline on every merge to `dev` and nightly with an ephemeral signing key, then boots the tarball with the AWS and
Azure environments, runs the Azure kind end-to-end, the browser suites, and the installer checks. Dispatching it with
`sign=true` (and the `BYMORNING_COSIGN_KEY_ENABLED` repository variable set) signs with the real key and keeps the
`release` artifact for 30 days as a release candidate. Only that path may set a `version`; every other run builds
`<version>-ci.<run>` and records its evidence as `ephemeral`.

## SST authentication configuration

Each deployed stage requires these values in SST; the repository does not provide secret defaults:

```bash
bunx sst secret set WEB_COOKIE_KEY --stage <stage>
```

Deployment-time OIDC settings (`AUTH_ISSUER`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_PROVIDER`, `AUTH_EMAIL_DOMAINS`) are retired. Configure SSO at runtime instead: deploy, open Setup with the installation setup token — never logged; it is written owner-read-only to the server's setup-token file at startup (`<data directory>/setup-token` for the development host, `/tmp/bymorning/setup-token` in the image), or supplied by the operator as the `SETUP_TOKEN` secret — register the callback URL it shows with your IdP, then enter the issuer, client ID, client secret, and admitted email domains. Replace the connection later through Settings → Security (Auth Provider).

`WEB_COOKIE_KEY` must be a 32-byte base64url value. In commercial SST stages, the shared Router URL is the trusted
application origin and serves the static frontend while forwarding `/auth`, `/api`, and `/system` to the Server.
Terraform installations serve the embedded UI from the Gateway, which is the HTTPS origin. Local development uses its configured `APP_ORIGIN`;
Vite forwards those same route families to the local API. Its local login provider and persisted cookie key are
configured automatically by `bun dev`.

Any OIDC-compliant IdP with the authorization-code grant works. Each Auth Provider has its own redirect URI, `${APP_ORIGIN}/auth/callback/<providerID>`, which Setup shows before you save. Enter the provider connection once in Setup; later changes go through Settings → Security (Auth Provider).

Integration OAuth callbacks use a process-local, one-use rendezvous. `max: 1` prevents steady-state routing across
multiple tasks, but it does not preserve pending flows across a restart or rolling replacement: every deployment or
restart invalidates pending Integration OAuth attempts, and affected users must retry. Operations should drain active
requests and avoid old/new task overlap; increasing the replica count requires shared callback storage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

ByMorning is released under the [MIT License](LICENSE). Third-party material is credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The license covers the code; it does not grant rights to the ByMorning
name or logo.
