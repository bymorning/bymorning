#!/bin/sh
# Publishes a signed release's two images to an OCI registry:
#
#   sh script/release/publish.sh <release directory> <repository prefix>
#   sh script/release/publish.sh "$RELEASE_DIR" ghcr.io/bymorning
#
# The release directory is the full-gate `release` artifact: manifest.json, both
# tarballs, signer.txt, trusted_root.json, and <version>/{gateway,execution}/.
# For each image this script
#   1. verifies the tarball's signature against the pinned signer (offline, with
#      the shipped trust root) before anything is pushed,
#   2. pushes the OCI layout with crane under the release version tag and checks
#      that the registry's digest is the manifest's digest,
#   3. signs the pushed digest and attaches the image SBOM (CycloneDX) and, for
#      the Gateway, the SLSA v1 provenance as cosign attestations, and
#   4. verifies the signature and attestations it just published.
#
# Signing is keyless (the running workflow's OIDC identity, which for a release
# is the same identity signer.txt names) unless PUBLISH_KEY is set, which signs
# with that key instead: a local rehearsal against a scratch registry, verified
# with PUBLISH_PUBLIC_KEY. (Not COSIGN_KEY: cosign reads that variable as --key
# for every command, including the keyless verification.) Needs jq, tar, crane, and cosign; sign in to the
# registry first (crane auth login), because cosign reuses that login.
set -eu

release=${1:?release directory}
prefix=${2:?repository prefix, for example ghcr.io/bymorning}
fail() { echo "publish: $*" >&2; exit 1; }
# run <failure message> <command...>: on failure, print the command's own output after the message.
run() {
  message=$1
  shift
  output=$("$@" 2>&1) || fail "$message
$output"
}
for tool in jq tar crane cosign; do command -v "$tool" >/dev/null || fail "$tool is not on PATH"; done

manifest="$release/manifest.json"
[ -f "$manifest" ] || fail "$manifest is missing"
version=$(jq -er .version "$manifest")
identity=$(sed -n 's/^identity: *//p' "$release/signer.txt")
issuer=$(sed -n 's/^issuer: *//p' "$release/signer.txt")
[ -n "$identity" ] && [ -n "$issuer" ] || fail "$release/signer.txt names no identity and issuer"
[ -f "$release/trusted_root.json" ] || fail "$release/trusted_root.json is missing"
pinned="--certificate-identity $identity --certificate-oidc-issuer $issuer"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

publish() { # artifact repository evidence-folder
  tarball=$(jq -er ".artifacts.$1.tarball" "$manifest")
  digest=$(jq -er ".artifacts.$1.digest" "$manifest")
  evidence="$release/$version/$3"
  printf '%s\n' "$digest" | grep -Eqx 'sha256:[0-9a-f]{64}' || fail "$1 has no valid digest in the manifest"
  [ -f "$release/$tarball" ] || fail "$release/$tarball is missing"

  # shellcheck disable=SC2086
  run "$tarball does not verify against $release/signer.txt" \
    cosign verify-blob --bundle "$evidence/$tarball.bundle" $pinned --trusted-root "$release/trusted_root.json" "$release/$tarball"

  layout="$work/$2"
  mkdir -p "$layout"
  tar -xf "$release/$tarball" -C "$layout"
  ref="$prefix/$2"
  run "pushing $ref:$version failed" crane push "$layout" "$ref:$version"
  pushed=$(crane digest "$ref:$version")
  [ "$pushed" = "$digest" ] || fail "$ref:$version has digest $pushed, but the manifest records $digest"

  if [ -n "${PUBLISH_KEY:-}" ]; then sign="--key $PUBLISH_KEY"; else sign=""; fi
  # shellcheck disable=SC2086
  run "signing $ref@$digest failed" cosign sign --yes $sign "$ref@$digest"
  # shellcheck disable=SC2086
  run "attaching the SBOM to $ref@$digest failed" \
    cosign attest --yes $sign --type cyclonedx --predicate "$evidence/sbom-image.cyclonedx.json" "$ref@$digest"
  types=cyclonedx
  if [ -f "$evidence/provenance.intoto.json" ]; then
    jq -e .predicate "$evidence/provenance.intoto.json" >"$work/$2.provenance.json" || fail "$evidence/provenance.intoto.json has no predicate"
    # shellcheck disable=SC2086
    run "attaching the provenance to $ref@$digest failed" \
      cosign attest --yes $sign --type slsaprovenance1 --predicate "$work/$2.provenance.json" "$ref@$digest"
    types="$types slsaprovenance1"
  fi

  if [ -n "${PUBLISH_KEY:-}" ]; then check="--key ${PUBLISH_PUBLIC_KEY:?PUBLISH_PUBLIC_KEY verifies a PUBLISH_KEY rehearsal}"; else check=$pinned; fi
  # shellcheck disable=SC2086
  run "the signature on $ref@$digest does not verify" cosign verify $check "$ref@$digest"
  for type in $types; do
    # shellcheck disable=SC2086
    run "the $type attestation on $ref@$digest does not verify" cosign verify-attestation $check --type "$type" "$ref@$digest"
  done
  echo "$ref:$version@$digest (signed; attestations: $types)"
}

publish gateway bymorning gateway
publish execution bymorning-code-interpreter execution
