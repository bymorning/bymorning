---
title: Release Manifest
---

# Release Manifest

## 15.1 Identity

| Item | Value |
| ---- | ----- |
| Product | ByMorning {{VERSION}}, released {{RELEASE_DATE}} |
| Source | Tag `v{{VERSION}}` of the ByMorning repository, commit `{{SOURCE_COMMIT_FULL}}` |
| Gateway image | `ghcr.io/bymorning/bymorning:{{VERSION}}`, digest `{{IMAGE_DIGEST}}` |
| Gateway image tarball | `{{TARBALL_NAME}}` (sha256 `{{TARBALL_SHA256}}`), an asset of the GitHub release |
| Code Interpreter execution image | `ghcr.io/bymorning/bymorning-code-interpreter:{{VERSION}}`; tarball and digest in `release/manifest.json` |
| Release signer | `https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v{{VERSION}}`, issuer `https://token.actions.githubusercontent.com` (Sigstore keyless) |
| Base images | `oven/bun` (build) and `registry.access.redhat.com/ubi9/nodejs-22-minimal` (runtime), pinned by digest; both digests are recorded in `provenance.intoto.json` |
| FIPS module | RHEL 9 OpenSSL FIPS Provider, FIPS 140-3 CMVP certificate #4857 |
| RDS CA bundle | `/app/certs/rds-global-bundle.pem`: the AWS commercial global bundle (`truststore.pki.rds.amazonaws.com`, sha256 `90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b`) followed by the AWS GovCloud global bundle for `us-gov-west-1` and `us-gov-east-1` (`truststore.pki.us-gov-west-1.rds.amazonaws.com`, sha256 `bae59f78f2e2ba789e734cdcac78c13a0f0e99aa3f7bd49f1f37477c815b9b33`) |

## 15.2 Delivered files and checksums

The GitHub release `v{{VERSION}}` carries both image tarballs,
`release/manifest.json`, `release/signer.txt`, and the evidence archive
`bymorning-{{VERSION}}-evidence.tar.gz`. The archive keeps the `release/`
layout: `trusted_root.json` and `signer.txt` at its root and one evidence
folder per image under `release/{{VERSION}}/`. The Gateway evidence folder
holds:

| File | Signature | sha256 |
| ---- | --------- | ------ |
| `{{TARBALL_NAME}}` (in `release/`) | `{{TARBALL_NAME}}.bundle` | `{{TARBALL_SHA256}}` |
| `SHA256SUMS` | `SHA256SUMS.bundle` | — |
| `provenance.intoto.json` | `provenance.intoto.json.bundle` | `{{PROVENANCE_SHA256}}` |
| `openvex.json` | `openvex.json.bundle` | `{{OPENVEX_SHA256}}` |
| `sbom-image.cyclonedx.json` | via `SHA256SUMS` | `{{SBOM_IMAGE_CDX_SHA256}}` |
| `sbom-image.spdx.json` | via `SHA256SUMS` | `{{SBOM_IMAGE_SPDX_SHA256}}` |
| `sbom-source.cyclonedx.json` | via `SHA256SUMS` | `{{SBOM_SOURCE_SHA256}}` |
| `vulnerabilities-image-grype.json` | via `SHA256SUMS` | `{{VULN_IMAGE_SHA256}}` |
| `vulnerabilities-source-grype.json` | via `SHA256SUMS` | `{{VULN_SOURCE_SHA256}}` |
| `vulnerabilities.md` | via `SHA256SUMS` | `{{VULN_MD_SHA256}}` |
| `licenses.md` | via `SHA256SUMS` | `{{LICENSES_SHA256}}` |
| `gitleaks.json` | via `SHA256SUMS` | `{{GITLEAKS_SHA256}}` |
| `semgrep.sarif` | via `SHA256SUMS` | `{{SEMGREP_SHA256}}` |
| `bun-audit.txt` | via `SHA256SUMS` | `{{BUN_AUDIT_SHA256}}` |
| `tools.txt` | via `SHA256SUMS` | `{{TOOLS_SHA256}}` |
| `signer.txt` | compared with the identity in §15.1 | `{{SIGNER_SHA256}}` |
| `trusted_root.json` | Sigstore trust root | `{{TRUSTED_ROOT_SHA256}}` |

The execution image's folder holds its SBOMs, image scan, `vulnerabilities.md`,
`tools.txt`, `SHA256SUMS`, and the tarball and `SHA256SUMS` bundles; it has no
provenance or OpenVEX file of its own, and its OpenVEX statements are in the
Gateway's `openvex.json`.

## 15.3 Offline verification

Extract the evidence archive, place the tarball in `release/`, and verify from
the Gateway evidence folder. `SHA256SUMS` names the tarball as
`../../{{TARBALL_NAME}}`. With `--trusted-root`, no command contacts the
network:

```sh
tar -xzf bymorning-{{VERSION}}-evidence.tar.gz
cp {{TARBALL_NAME}} release/
cd release/{{VERSION}}/gateway
cat ../../signer.txt      # the identity must be the release signer in §15.1
cmp signer.txt ../../signer.txt
shasum -a 256 -c SHA256SUMS
id=https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v{{VERSION}}
v="--certificate-identity $id --certificate-oidc-issuer https://token.actions.githubusercontent.com --trusted-root ../../trusted_root.json"
cosign verify-blob --bundle SHA256SUMS.bundle $v SHA256SUMS
cosign verify-blob --bundle {{TARBALL_NAME}}.bundle $v ../../{{TARBALL_NAME}}
cosign verify-blob --bundle provenance.intoto.json.bundle $v provenance.intoto.json
cosign verify-blob --bundle openvex.json.bundle $v openvex.json
```

Repeat the checksum and tarball checks in the execution folder for the Code
Interpreter image. To verify a registry image instead, use the `cosign verify`
and `cosign verify-attestation` commands in §8.4 against
`ghcr.io/bymorning/bymorning@{{IMAGE_DIGEST}}`.

## 15.4 Build attestation

The SLSA v1 statement in `provenance.intoto.json` records the source commit,
the build inputs (both pinned base-image digests and the frozen lockfile), and
two subjects: the tarball and the image digest. The build is reproducible
(§8.1); the customer can rebuild from tag `v{{VERSION}}` and compare the
digest to `{{IMAGE_DIGEST}}`.

## 15.5 Verification status at release

| Gate | Result |
| ---- | ------ |
| Application security suites (§11.2) | {{RESULT}} |
| Image security gate (SEC-IMG, linux/amd64) | {{RESULT}} |
| AWS installer tests (SEC-TF) | {{RESULT}} |
| Azure installer tests, offline and on kind (SEC-AZ) | {{RESULT}} |
| gitleaks | {{GITLEAK_SUMMARY}} |
| semgrep | {{SEMGREP_SUMMARY}} |
| grype (image and source) | {{VULN_SUMMARY}} |

Open POA&M items at this release are listed in §12.1.
