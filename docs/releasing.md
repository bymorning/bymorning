# Releasing ByMorning

This is the maintainers' procedure. What a release is, and how anyone can verify one, is in the
[README](../README.md#releases).

A release is one Gateway image and one Code Interpreter execution image, delivered as linux/amd64 OCI tarballs pinned
by digest, plus the Helm chart and signed evidence. Everything is signed keylessly by the `full-gate` workflow running
on a `v*` tag (`script/release/signing.ts` defines what counts as a release signature). The website
(`bymorning/website`) is a separate repository and is updated last.

## Before the tag

1. **Refresh the evidence.** Take the scan results from a `full-gate` run on `dev` (its `release` artifact), then
   update three files:
   - `docs/security/evidence/openvex.json`: every Critical and High advisory in the Gateway image, the execution image,
     and the source scan needs a statement, and each statement names the image the advisory appears in
     (`bymorning-gateway` or `bymorning-code-interpreter`). Drop statements for advisories that no longer match.
     `bun script/security/vex.ts --root . --version <version> --out <dir>` validates the document.
   - `docs/security/evidence/vulnerability-triage.md`: add "Re-scan for `<version>`". Compare against the previous
     release's images scanned with the same database; the scanner database grows between releases, so raw counts are
     not comparable.
   - `docs/security/review/release.json`: `VERSION`, `RELEASE_DATE`, and the scan summaries. Leave `RESULT` pending
     until the signed run passes.

   `bun run security:prerelease` fails if the security review's POA&M-13 does not name every pre-release dependency that
   ships.

2. **Set the version** in the root `package.json`, `app/host/package.json`, `server.json`, and
   `charts/bymorning/Chart.yaml` (both `version` and `appVersion`, and the image in its Artifact Hub annotation). Date
   the section in `CHANGELOG.md`. `sh script/release/versions.sh` and `sh charts/bymorning/test.sh` check that the
   files agree. `server.json`'s description must stay within the MCP Registry's 100 characters; `versions.sh` checks
   that too. Merge all of it to `dev` in a pull request.

## Build

3. **Tag and push.** The tag must match the `package.json` version, and tags are immutable once pushed.

   ```bash
   git tag v<version> && git push origin v<version>
   ```

4. **Dispatch the signed build** on the tag, then download its `release` artifact:

   ```bash
   gh workflow run full-gate.yml --ref v<version> -f sign=true
   gh run download <run id> -n release -D release
   ```

   The run builds both images, runs the image-security, image-boot, kind, and browser suites, and signs the evidence.
   The artifact holds:
   - `release/bymorning-<commit>.tar` (the Gateway) and `release/bymorning-code-interpreter-<commit>.tar` (the
     execution image); both are gitignored.
   - `release/manifest.json` and `release/signer.txt`.
   - `release/trusted_root.json`, the Sigstore trust root, for offline verification.
   - The evidence, in `release/<version>/gateway/` and `release/<version>/execution/`.

   Each artifact's `signing` in the manifest records who signed: `keyless` (the identity and issuer), `ephemeral` (a
   throwaway key, every other run), or `unsigned`.

   On a `v*` tag the run's last job, `publish`, then:
   - pushes both images to `ghcr.io/bymorning/bymorning` and `ghcr.io/bymorning/bymorning-code-interpreter` under the
     version tag, and checks each pushed digest against the manifest;
   - signs them keylessly with the same identity and attaches the SBOM to both and the SLSA provenance to the Gateway
     (`script/release/publish.sh`);
   - packages the Helm chart at the release version, pushes it to `oci://ghcr.io/bymorning/charts/bymorning`, and signs
     it.

   A first push can create a package as private (1.3.2 and 1.3.3 came up public): check that each is public under the
   organization's **Packages** settings. If a package name was used before by another repository, delete the old
   package first; the new repository cannot write to it (`permission_denied: write_package`).

5. **Verify what was published,** independently of the job's own log: each tag's digest equals the manifest's,
   `cosign verify` and `cosign verify-attestation` pass for both images, `cosign verify` passes for the chart, an
   anonymous `helm pull` works, and the offline evidence check in the release notes passes.

## After the build

6. **Commit the evidence** in a pull request: `release/manifest.json`, `release/signer.txt`,
   `release/trusted_root.json`, and `release/<version>/`, plus `RESULT` in `docs/security/review/release.json` once
   the gate has passed. The scan counts there must match the build's own evidence.

   ```bash
   git add release && git commit -m "release: <version>"
   ```

7. **Publish the GitHub release.** Create it as a draft, check its assets, then publish it.

   ```bash
   tar -czf bymorning-<version>-evidence.tar.gz \
     release/manifest.json release/signer.txt release/trusted_root.json release/<version>
   gh release create v<version> --draft --verify-tag --notes-file <notes> \
     release/bymorning-*<commit>.tar bymorning-<version>-evidence.tar.gz release/manifest.json release/signer.txt
   ```

   The two evidence folders hold files with the same names (`SHA256SUMS`, `signer.txt`, ...), and release assets must
   have unique names, so the evidence ships as one archive. The previous release's notes show the verification steps.

8. **Render the security review** and attach the PDF to the release:

   ```bash
   bunx playwright install chromium     # once
   bun run security:render -- --release release
   gh release upload v<version> build/security/<version>/bymorning-security-review-<version>.pdf
   ```

9. **Package the Azure installer** from the manifest and attach it:
   `bun installers/azure/export.ts --out <directory>` writes `bymorning-azure-<version>.zip`. It:
   - runs from the release build or a descendant that changes only `release/`, `CHANGELOG.md`,
     `docs/security/evidence/`, `docs/security/review/release.json`, and package versions (`--force` overrides);
   - refuses evidence that was not signed by a release signer or whose signatures do not verify (`--allow-unsigned`
     exports a marked "UNSIGNED REHEARSAL");
   - refuses to change the signer a target already pins (a different workflow or issuer) without `--rotate-signer`; a
     new release tag is not a change.

10. **Publish to the registries.**
    - **Terraform Registry:** run `sh script/release/terraform-module.sh <directory>` into a clone of
      `bymorning/terraform-aws-bymorning`, commit, and tag the same `v<version>`; the Registry picks up the tag. Do not
      run `terraform init` inside the export before committing (the script writes a `.gitignore` as a guard).
    - **MCP Registry:** `mcp-publisher validate`, then `mcp-publisher login github` as a member of the `bymorning`
      organization, and `mcp-publisher publish`.
    - **Artifact Hub** tracks the chart on ghcr.io by itself once the repository has been added.

11. **Update the website** (`bymorning/website`): `src/components/release.ts` from the manifest, the changelog and
    upgrade pages, and any page that changed. When docs change materially, freeze the previous version's pages under
    `/docs/<previous version>` first. Merge to `dev`, check the dev deployment, then merge `dev` into `production`.

## Local builds and the full gate

For your own builds, `bun script/release.ts` needs Docker with buildx and `syft grype cosign gitleaks semgrep`
(`brew install ...`). It leaves the evidence unsigned unless you point cosign at a development key
(`BYMORNING_COSIGN_KEY=<cosign.key>`, recorded as `ephemeral`); such a build is never deliverable.

The `full-gate` workflow (`.github/workflows/full-gate.yml`) runs the same build and evidence pipeline on every merge to
`dev` and nightly with a throwaway key, then boots the tarball with the AWS and Azure environments, runs the Azure kind
end-to-end, the browser suites, and the installer checks. Dispatched with `sign=true` on a `v*` tag it is the release
build described above; on any other ref it signs keylessly but only to exercise the signing path, and the export will
refuse the result. Every other run builds `<version>-ci.<run>` and records its evidence as `ephemeral`.
