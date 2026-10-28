#!/bin/sh
# Pushes both release tarballs in this directory (the Gateway image and the
# code execution image) into an Azure Container Registry, verifies each pushed
# digest against release/image-azure.txt and release/image-execution.txt, and
# prints the two digest-pinned references to use next: the Gateway image for
# scripts/overlay.sh --image, and the execution image for the code-interpreter
# component's bymorning.jsonc.
#
# Sign in to the registry first, from a host that can reach it (the registry is
# private unless acr_public_network_access = true):
#   az acr login --name <registry name> --expose-token --output tsv --query accessToken \
#     | crane auth login <login server> --username 00000000-0000-0000-0000-000000000000 --password-stdin
# then:
#   sh release/mirror.sh <acr login server> <version>
# for example:
#   sh release/mirror.sh contoso.azurecr.us 1.2.0
#
# Needs crane (github.com/google/go-containerregistry). The tag is the release
# version; the references printed are by digest, which is what the Gateway and
# the Terraform module require.
#
# Before anything is pushed each tarball is checked: when cosign is on PATH, its
# signature (release/gateway/evidence/<tarball>.bundle,
# release/code-interpreter/evidence/<tarball>.bundle) is verified against the
# signer pinned in release/ (signer.txt, or cosign.pub for a rehearsal build);
# then its OCI index must name exactly one linux/amd64 image manifest whose
# digest is the recorded one, and every blob must hash to its digest.
# Set BYMORNING_SKIP_COSIGN=1 only on a host where cosign cannot load its trust
# root, after verifying the bundles elsewhere.
set -eu

registry=${1:?acr login server, for example contoso.azurecr.us}
version=${2:?release version, for example 1.2.0}
here=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)

layout=$(mktemp -d)
trap 'rm -rf "$layout"' EXIT

fail() { echo "$*" >&2; exit 1; }

# sha256 of a file, with whichever tool this host has.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 -r "$1" | cut -d' ' -f1
  fi
}

# verify_layout <layout> <expected digest> <label>: the extracted OCI layout's
# index.json names exactly one image manifest, for linux/amd64, with the
# expected digest, and every blob (the manifest, its config, and its layers)
# hashes to its name, so the content pushed is the content the digest names.
verify_layout() {
  [ -f "$1/index.json" ] || fail "$3: the tarball has no index.json; it is not an OCI layout"
  index=$(tr -d ' \t\r\n' < "$1/index.json")
  count=$(printf '%s\n' "$index" | awk '{ print gsub(/"digest":/, "") }')
  [ "$count" = 1 ] || fail "$3: the tarball's index.json names $count manifests, expected exactly one"
  found=$(printf '%s\n' "$index" | sed -n 's/.*"digest":"\([^"]*\)".*/\1/p')
  [ "$found" = "$2" ] || fail "$3: the tarball's manifest is $found, but $3 expects $2"
  case "$index" in
    *'"mediaType":"application/vnd.oci.image.manifest.v1+json"'* | *'"mediaType":"application/vnd.docker.distribution.manifest.v2+json"'*) ;;
    *) fail "$3: the tarball's index does not name an image manifest" ;;
  esac
  case "$index" in
    *'"architecture":"amd64"'*) ;;
    *) fail "$3: the tarball's image is not linux/amd64" ;;
  esac
  case "$index" in
    *'"os":"linux"'*) ;;
    *) fail "$3: the tarball's image is not linux/amd64" ;;
  esac
  [ -f "$1/blobs/sha256/${2#sha256:}" ] || fail "$3: the tarball has no manifest blob for $2"
  if [ -z "$(sha256 "$1/index.json")" ]; then
    echo "$3: no sha256sum, shasum, or openssl on PATH; blob contents are verified by the registry and the digest after the push" >&2
    return 0
  fi
  for blob in "$1"/blobs/sha256/*; do
    hashed=$(sha256 "$blob")
    [ "$hashed" = "${blob##*/}" ] || fail "$3: blob ${blob##*/} hashes to $hashed; the tarball is corrupt or was modified"
  done
}

# cosign_verify <file> <bundle>: cosign verify-blob against the signer this package pins. A keyless
# release pins release/signer.txt (the identity and OIDC issuer of the signing workflow); a
# release/trusted_root.json beside it lets the check run without network access. A rehearsal build
# pins release/cosign.pub instead.
cosign_verify() {
  if [ -f "$here/signer.txt" ]; then
    identity=$(sed -n 's/^identity: *//p' "$here/signer.txt" | head -1)
    issuer=$(sed -n 's/^issuer: *//p' "$here/signer.txt" | head -1)
    [ -n "$identity" ] && [ -n "$issuer" ] || fail "$here/signer.txt names no identity and issuer"
    if [ -f "$here/trusted_root.json" ]; then
      cosign verify-blob --bundle "$2" --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" \
        --trusted-root "$here/trusted_root.json" "$1" >/dev/null
    else
      cosign verify-blob --bundle "$2" --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" "$1" >/dev/null
    fi
  else
    cosign verify-blob --key "$here/cosign.pub" --bundle "$2" "$1" >/dev/null
  fi
}

# verify_signature <tarball> <bundle> <label>: verify the tarball signature when cosign is available
# and the bundle is present.
verify_signature() {
  if [ "${BYMORNING_SKIP_COSIGN:-}" = 1 ]; then
    echo "$3: signature not verified (BYMORNING_SKIP_COSIGN=1)" >&2
  elif ! command -v cosign >/dev/null 2>&1; then
    echo "$3: cosign is not on PATH; the tarball signature is not verified here (the digest still is)." >&2
    echo "$3: verify it as the README's 'Release evidence' section describes." >&2
  elif [ ! -f "$2" ]; then
    echo "$3: WARNING: signature bundle $2 is missing; the signature is not verified (an unsigned rehearsal export?)" >&2
  elif [ ! -f "$here/signer.txt" ] && [ ! -f "$here/cosign.pub" ]; then
    fail "$3: $here has neither signer.txt nor cosign.pub; cannot verify the signature"
  else
    cosign_verify "$1" "$2" ||
      fail "$3: cosign could not verify $1 against the signer pinned in release/"
    echo "$3: signature verified against the pinned signer" >&2
  fi
}

mirror() { # record repository evidence-folder
  record="$here/$1"
  [ -f "$record" ] || fail "$record is missing"
  recorded=$(sed -n 's/^version: *//p' "$record" | head -1)
  [ "$recorded" = "$version" ] || fail "$1 records version $recorded, not $version"
  expected=$(sed -n 's/^digest: *//p' "$record" | head -1)
  printf '%s\n' "$expected" | grep -Eqx 'sha256:[0-9a-f]{64}' || fail "$1 has no valid digest line (sha256:<64 hex>)"
  name=$(sed -n 's/^tarball: *//p' "$record" | head -1)
  tarball="$here/$name"
  [ -n "$name" ] && [ -f "$tarball" ] || fail "release tarball not found: $tarball"

  verify_signature "$tarball" "$here/$3/$name.bundle" "$1"

  # The tarball is an OCI layout; crane push preserves its manifest digest.
  rm -rf "${layout:?}/$2" && mkdir -p "$layout/$2"
  tar -xf "$tarball" -C "$layout/$2"
  verify_layout "$layout/$2" "$expected" "$1"
  target="$registry/$2"
  crane push "$layout/$2" "$target:$version" >/dev/null
  pushed=$(crane digest "$target:$version")
  if [ "$pushed" != "$expected" ]; then
    echo "pushed digest $pushed does not match $1 $expected" >&2
    exit 1
  fi
  echo "$target@$pushed"
}

gateway=$(mirror image-azure.txt bymorning gateway/evidence)
execution=$(mirror image-execution.txt bymorning-code-interpreter code-interpreter/evidence)
echo "gateway image:   $gateway"
echo "execution image: $execution"
