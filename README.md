# ByMorning

[![ci](https://github.com/bymorning/bymorning/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/bymorning/bymorning/actions/workflows/ci.yml)
[![full-gate](https://github.com/bymorning/bymorning/actions/workflows/full-gate.yml/badge.svg?branch=dev)](https://github.com/bymorning/bymorning/actions/workflows/full-gate.yml)
[![Release](https://img.shields.io/github/v/release/bymorning/bymorning)](https://github.com/bymorning/bymorning/releases/latest)
[![License: MIT](https://img.shields.io/github/license/bymorning/bymorning)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/bymorning/bymorning/dev)](https://github.com/bymorning/bymorning/commits/dev)

[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/bymorning)](https://artifacthub.io/packages/search?repo=bymorning)
[![Terraform Registry](https://img.shields.io/badge/Terraform_Registry-bymorning%2Fbymorning%2Faws-844FBA?logo=terraform&logoColor=white)](https://registry.terraform.io/modules/bymorning/bymorning/aws/latest)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.bymorning%2Fbymorning-1F6FEB?logo=modelcontextprotocol&logoColor=white)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.bymorning/bymorning)
[![Container images](https://img.shields.io/badge/ghcr.io-bymorning%2Fbymorning-2088FF?logo=github&logoColor=white)](https://github.com/orgs/bymorning/packages/container/package/bymorning)
[![Signed with Sigstore](https://img.shields.io/badge/signed_with-Sigstore-2E8B57)](https://bymorning.ai/download#verify)

> ByMorning is open source under the [MIT License](LICENSE) and community maintained: fork it, open pull requests,
> and run your own builds. Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

ByMorning is an open source, self-hosted MCP and model gateway. It gives your team's agents access to company systems,
each person under their own permissions, and caps what they spend: a spend limit per Workspace, member, or Service
Account. Model routing across the providers you enable is built in, and it all runs in your own cloud account.
Documentation: <https://bymorning.ai/docs>.

## Install

Every release image is signed keylessly by this repository's release workflow and published to
`ghcr.io/bymorning/bymorning`, with signed evidence (SBOMs, scans, provenance) on the
[GitHub release](https://github.com/bymorning/bymorning/releases/latest). Choose where to run it:

| Where                    | Use                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| One machine, to try it   | [Docker Compose evaluation](installers/docker/README.md). Not for production.                                  |
| AWS or AWS GovCloud (US) | [Terraform module](installers/aws/README.md), also on the Terraform Registry as `bymorning/bymorning/aws`.     |
| Azure (AKS)              | [Azure installer](installers/azure/README.md): Terraform and Kubernetes manifests, with a digest-pinned image. |
| Any Kubernetes cluster   | [Helm chart](charts/bymorning/README.md), with your own database, object storage, and key.                     |

## Connect coding agents

- **Models.** Point Claude Code, Codex, Cursor, VS Code Copilot, OpenCode, or Gemini CLI at your installation's
  OpenAI-, Anthropic-, and Google-compatible endpoints with a Service Account key. Spend limits, routing, and usage
  apply to every call. See [Connect coding agents](https://bymorning.ai/docs/use/clients).
- **Tools.** Add `https://<your host>/mcp` to the agent as a remote MCP server. The agent signs in with OAuth as a
  Workspace member and gets the Tools that member may use, under the Workspace's permissions. See
  [Use ByMorning's Tools from an agent](https://bymorning.ai/docs/use/clients#tools). [`server.json`](server.json)
  describes it for the MCP Registry as `io.github.bymorning/bymorning`.

## Develop

You need Bun 1.3 and Node 22+. From the repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

Open <http://localhost:3000>; local sign-in goes straight to the workspace. Local development needs no cloud
credentials, SST, or external login provider. Docker is not required for the database; it is only needed for the Code
Interpreter and the application tests.

- The development host keeps Postgres-compatible data with PGlite under `.bymorning/local/pglite`.
- `bun run dev` runs the API watcher (port 3210) and Vite (port 3000) together, and the API runs migrations at startup.
  Choose ports with `PORT=4001 WEB_PORT=4000 bun run dev`: `PORT` is the API, and `WEB_PORT` is Vite and the default
  login callback origin.
- `bun run local` is the bundled, one-origin development host instead.
- Build the execution image with `bun run --cwd app/host setup` when you need the Code Interpreter.

### Build the host bundle

One host program, `app/host`, serves every deployment. Its production build is what the root `Dockerfile` ships:

```bash
bun run --cwd app/host build
node app/host/dist/bymorning.mjs
```

It requires the deployment's storage and key selectors (`STORAGE_PROVIDER`, `CIPHER_BACKEND`), their companions, and the
database, cookie, and origin settings documented in [app/host/README.md](app/host/README.md). The development build
adds PGlite, filesystem storage, the local cipher, and the Docker Code Interpreter, and needs nothing set:

```bash
bun run --cwd app/host build:dev
node app/host/dist/bymorning.mjs
```

Distribute the complete `dist/` directory, including the installation documents and the loadable plugin packages. The
Docker image runs the production bundle with Node; no compiled application executable is built.

The [host guide](app/host/README.md) has the deployment contract, the development defaults, Vite arguments, and database
ownership. [CONTRIBUTING.md](CONTRIBUTING.md) covers tests and pull requests.

## Releases

A release is one Gateway image, delivered as a linux/amd64 OCI tarball pinned by digest, plus signed evidence (SBOMs,
vulnerability and license reports, scans, SLSA provenance, `SHA256SUMS`). It is installer-neutral: every installer
delivers the same tarball and verifies the same digest.

**Release signatures are keyless.** There is no signing key to store or rotate. The `full-gate` workflow signs the
evidence with [Sigstore](https://www.sigstore.dev) using its own GitHub Actions identity: the signing certificate names
the workflow run, and the signature is recorded in the public transparency log.

- A signature is a release signature only when that identity is `full-gate.yml` of this repository running on a `v*`
  tag. The installer export refuses anything else, and it verifies every signature with `cosign` before it packages a
  release.
- Anyone can check a release with the identity and issuer in `release/signer.txt`, as the
  [download page](https://bymorning.ai/download#verify) shows, and rebuild a release from its tag to compare digests:
  the build is reproducible.

Maintainers: [docs/releasing.md](docs/releasing.md) is the procedure for cutting a release.

## More documentation

- [Host guide](app/host/README.md): the deployer's contract, environment rules, and evaluation installations.
- [Identity provider setup](docs/guides/identity-provider-setup.md).
- [Deploying with SST](docs/sst.md): the SST app's database migrations and authentication settings.
- [Security review package](docs/security/review/README.md): architecture, control mapping, supply chain, and test
  results, rendered to a PDF with each release.
- [Domain glossary](CONTEXT.md) and the [Changelog](CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

ByMorning is released under the [MIT License](LICENSE). Third-party material is credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The license covers the code; it does not grant rights to the ByMorning
name or logo.
