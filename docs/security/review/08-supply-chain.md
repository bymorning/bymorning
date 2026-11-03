---
title: "Software Supply Chain: Build, Provenance, and SBOM"
---

# Software Supply Chain: Build, Provenance, and SBOM

ByMorning is open source under the MIT License, and every release is built
from a public tag in the ByMorning repository by one GitHub Actions workflow.
One Dockerfile builds one Gateway image for every deployment from
digest-pinned base images and a frozen lockfile. The release workflow emits
SBOMs, vulnerability, secret, and static-analysis scans, SLSA provenance, and
an OpenVEX statement, and signs them keylessly with Sigstore. The customer
verifies checksums, signatures, and provenance offline before the image enters
its account; no step contacts the ByMorning team.

## 8.1 Build

The build stage uses `oven/bun` and the runtime stage
`registry.access.redhat.com/ubi9/nodejs-22-minimal`, both pinned by digest;
`provenance.intoto.json` records them (§15). Dependencies install from a
frozen lockfile, and the application compiles to a minified bundle. The
runtime stage removes `npm` and `nodemon`, so no JavaScript package manager
ships. It activates the RHEL 9 OpenSSL FIPS Provider image-wide, carries the
AWS RDS CA bundle (the commercial and GovCloud global bundles), and runs as
uid/gid `65532:65532`.

The same image serves AWS and Azure deployments. It contains both cloud
storage and key backends (S3 with KMS; Blob Storage with Key Vault) and both
production Code Interpreter plugins. The deployment selects one of each at
startup through `STORAGE_PROVIDER` and `CIPHER_BACKEND`; the AWS installer sets
`s3` and `kms`, the Azure installer `azure-blob` and `keyvault`. The process
refuses to start if either selector is missing or names a backend whose
companion variables are absent. The image bakes no deployment environment:
`AWS_USE_FIPS_ENDPOINT`, trust-anchor overrides, and the selectors come from
the installer. The image gate asserts their absence alongside the presence of
`OPENSSL_CONF`, the release labels, and the RDS CA bundle (SEC-IMG).

The embedded development database and the Docker Code Interpreter never enter
the image, and the image boot checks assert their absence. Filesystem storage,
the local key backend, and Local Login are available only when
`BYMORNING_EVALUATION=true`, which the CUI profile refuses; production
deployments leave it unset (§6).

Builds are reproducible from a commit. The release build sets
`SOURCE_DATE_EPOCH` to the commit time and rewrites layer timestamps, both base
images are digest-pinned, and the lockfile is frozen, so a rebuild of the same
tag reproduces the image digest. The build exports a linux/amd64 OCI tarball
and records its digest in `release/manifest.json`.

## 8.2 Release workflow and evidence

A release is a manual dispatch of the `full-gate` workflow with signing
enabled on a `v*` tag; the tag must equal the version in the source. The run
builds both images, writes the evidence, and then runs these gate jobs against
the built tarballs:

| Job | What it checks |
| --- | -------------- |
| build | The image security gate on the exact Gateway tarball (SEC-IMG) |
| image-boot (aws, azure) | The tarball booted with each installer's task or pod environment against emulated cloud services, including startup refusals |
| kind | The Azure installer's manifests on a kind cluster with the signed tarballs imported by digest; sign-in, Blob Storage, Key Vault rotation, and sandboxed code execution |
| browser | The application and component browser suites in Chromium against the real UI build |
| installers | The Azure and AWS installers' offline Terraform and manifest checks (SEC-AZ, SEC-TF) |

Only after every job passes does the `publish` job push the images to
`ghcr.io` (§8.3). The evidence collectors below write
`release/<version>/gateway/`; the execution image's folder holds its SBOMs,
image scan, `tools.txt`, and signatures only. Tool versions are recorded in
`tools.txt`. The provenance `buildType` is
`https://github.com/bymorning/bymorning/release#oci-tarball`, and the OpenVEX
`@id` is `https://github.com/bymorning/bymorning/security/<version>/openvex`.

| Tool | Output | Effect |
| ---- | ------ | ------ |
| syft | Image SBOMs in CycloneDX 1.6 and SPDX 2.3; a source SBOM from the frozen lockfile, because the minified bundle hides source dependencies from the image SBOM | — |
| grype | Image and source vulnerability scans plus `vulnerabilities.md` | Triaged per §8.5 |
| gitleaks | `gitleaks.json` over source history | Any finding fails the build |
| semgrep | `semgrep.sarif` (default, TypeScript, and OWASP Top Ten rulesets) | Triaged per §8.5 |
| bun audit | `bun-audit.txt`, the npm advisory view of the lockfile | Triaged per §8.5 |
| — | `openvex.json`: OpenVEX v0.2.0 statements authored per release; the build fails if it is missing or malformed | Signed |
| — | `licenses.md`, `tools.txt`, and `provenance.intoto.json` (SLSA v1; subjects are the tarball and the image digest) | Provenance signed |
| — | `SHA256SUMS` over the tarball and every evidence file | Signed |
| cosign | Sigstore bundles (`.bundle`) for the tarball, `SHA256SUMS`, provenance, and OpenVEX; `signer.txt`; `trusted_root.json` | — |

## 8.3 Keyless signing

Release signing is keyless: no signing key exists, so there is none to store,
rotate, or lose. The workflow requests a short-lived certificate from
Sigstore with its GitHub Actions OIDC identity, signs, and the signature is
recorded in the public Rekor transparency log. A release signature names this
identity and issuer:

```text
identity: https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v<version>
issuer:   https://token.actions.githubusercontent.com
```

Each release ships `signer.txt` with that identity and issuer, and
`trusted_root.json`, the Sigstore trust root the release was verified with.
With `--trusted-root`, verification needs no network access. Before upload,
the workflow itself re-verifies `SHA256SUMS` against the shipped trust root
with the network blocked. A build whose manifest does not record a keyless
signature fails, and the Azure installer export refuses evidence whose signer
is not the workflow on a `v*` tag.

The `publish` job pushes the Gateway to `ghcr.io/bymorning/bymorning` and the
execution image to `ghcr.io/bymorning/bymorning-code-interpreter` under the
version tag. It refuses a tarball whose signature does not verify against
`signer.txt` and a pushed digest that differs from the manifest. It signs each
digest with the same identity and attaches the image SBOM (CycloneDX) as a
cosign attestation, plus the SLSA provenance for the Gateway. The OCI tarball
on the GitHub release remains the offline delivery path.

## 8.4 Verification by the customer

From a registry, verify the signature and the provenance attestation on the
digest before deploying:

```sh
id=https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v<version>
iss=https://token.actions.githubusercontent.com
cosign verify --certificate-identity "$id" --certificate-oidc-issuer "$iss" \
  ghcr.io/bymorning/bymorning@sha256:<digest>
cosign verify-attestation --type slsaprovenance1 \
  --certificate-identity "$id" --certificate-oidc-issuer "$iss" \
  ghcr.io/bymorning/bymorning@sha256:<digest>
cosign verify-attestation --type cyclonedx \
  --certificate-identity "$id" --certificate-oidc-issuer "$iss" \
  ghcr.io/bymorning/bymorning@sha256:<digest>
```

Offline, run the checksum and `cosign verify-blob` checks in §15 against the
release files, then confirm that the source commit in
`provenance.intoto.json` is the release tag's commit and that its image
subject equals the digest in `release/manifest.json`. Both installers deploy
the image by digest. The AWS installer refuses an image reference that is not
pinned by digest. The Azure installer's mirror script checks each tarball's
digest, and its signature when cosign is installed, before pushing and prints digest-pinned references for
the manifests.

## 8.5 Vulnerability triage

Every Critical and High finding in the image and source scans is dispositioned
per release in `openvex.json` and in the triage published in the ByMorning
repository at the release tag (`docs/security/evidence/vulnerability-triage.md`). A finding with an
upstream fix is patched and the release re-evidenced. A finding in a package
the bundle does not include, or in code the process never executes, is
recorded `not_affected` with the reasoning. A reachable finding with no fix is
`affected` and tracked in §12.1.

Scan totals for this release are {{VULN_SUMMARY}}. Every Critical and High in
both images and the source has an OpenVEX statement, and the Gateway findings
that remain `affected` are POA&M-39 and POA&M-40. The Code Interpreter execution image runs
untrusted code by design. Its residual High findings are Debian base packages
with no published fix; they are `affected` in `openvex.json` and accepted, with
the sandbox's isolation controls as the compensating control (§11.4).
