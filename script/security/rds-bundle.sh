#!/bin/sh
# Shows what AWS changed in its RDS CA bundles since an image was built.
#
# When AWS adds a Region it adds roots to its global bundle, the sha256 pinned
# in the Dockerfile stops matching, and the image build fails closed ("digest
# mismatch"). Run this before re-pinning: it prints each partition's served
# sha256 and the certificates added or removed relative to the bundle in IMAGE
# (default: the loaded image of the current release). Added roots are routine;
# a removed root can break verify-full for existing databases.
#
#   sh script/security/rds-bundle.sh
#   IMAGE=bymorning-candidate:<digest> sh script/security/rds-bundle.sh
#
# Needs curl, openssl, docker, and jq.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -z "${IMAGE:-}" ]; then
  digest=$(jq -r '.artifacts.gateway.digest' "$root/release/manifest.json")
  IMAGE="bymorning-candidate:${digest#sha256:}"
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  { echo "image $IMAGE is not loaded; load the release tarball (sh packages/server/test/fixtures/oci-load.sh) or set IMAGE" >&2; exit 1; }
docker run --rm --entrypoint cat "$IMAGE" /app/certs/rds-global-bundle.pem > "$work/image.pem"

# fingerprints <bundle>: one "fingerprint<TAB>subject, notAfter" line per certificate
fingerprints() {
  mkdir -p "$work/split"
  rm -f "$work/split/"*
  awk -v d="$work/split" '/-----BEGIN CERTIFICATE-----/{n++} n{print > (d "/" n ".pem")}' "$1"
  for c in "$work/split/"*.pem; do
    printf '%s\t%s\n' \
      "$(openssl x509 -in "$c" -noout -fingerprint -sha256 | sed 's/.*=//')" \
      "$(openssl x509 -in "$c" -noout -subject -enddate | sed 's/^subject=//; s/^notAfter=/until /' | tr '\n' ' ')"
  done | sort
}

fingerprints "$work/image.pem" > "$work/image.list"
sed -n 's/^ADD --checksum=sha256:\([0-9a-f]*\) \(https:[^ ]*\) \/certs\/\([a-z]*\)\.pem$/\1 \2 \3/p' "$root/Dockerfile" |
  while read -r pinned url name; do
    curl -fsS "$url" -o "$work/$name.pem"
    served=$(openssl dgst -sha256 -r "$work/$name.pem" | cut -d' ' -f1)
    echo "== $name ($url)"
    if [ "$served" = "$pinned" ]; then echo "   matches the Dockerfile pin $pinned"; else echo "   Dockerfile pin $pinned, AWS now serves $served"; fi
    fingerprints "$work/$name.pem" > "$work/$name.list"
    cut -f1 "$work/$name.list" > "$work/$name.fp"
    echo "   certificates served: $(wc -l < "$work/$name.list" | tr -d ' ')"
  done

cat "$work"/*.fp | sort -u > "$work/served.fp"
cut -f1 "$work/image.list" > "$work/image.fp"
echo "== compared with $IMAGE ($(wc -l < "$work/image.fp" | tr -d ' ') certificates)"
added=$(grep -vxFf "$work/image.fp" "$work/served.fp" || true)
removed=$(grep -vxFf "$work/served.fp" "$work/image.fp" || true)
for fp in $added; do printf '   ADDED   %s\n' "$(cat "$work"/*.list | grep "^$fp" | head -1 | cut -f2)"; done
for fp in $removed; do printf '   REMOVED %s\n' "$(grep "^$fp" "$work/image.list" | cut -f2)"; done
[ -n "$added$removed" ] || echo "   no certificate changes"
