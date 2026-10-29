#!/bin/sh
# Exercises the Azure mirror script against a local registry:2:
#   installers/azure/release/mirror.sh            (ACR; given the local registry directly)
#
# It builds a two-line OCI image (FROM scratch + COPY) with docker buildx,
# signs it with a throwaway cosign key, lays out the installer's release/
# directory, and checks that an intact release is pushed with the recorded
# digest while tampered releases (modified layer, wrong index digest, two
# manifests, another platform, a malformed digest line) are refused before
# anything reaches the registry, with and without cosign on PATH.
#
#   sh script/release/mirror-check.sh
#
# AZURE_MIRROR points the check at another copy of the script (for example an
# earlier revision, to see what it lets through).
#
# Needs docker (with a buildx builder that can export an OCI layout), crane,
# cosign, and shasum or sha256sum. The throwaway signatures are made without a
# transparency log, so the cosign on the scripts' PATH is a shim adding
# --insecure-ignore-tlog=true to verify-blob; the verification is otherwise the
# real one against the release's cosign.pub.
set -eu

repo=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
azure_mirror=${AZURE_MIRROR:-$repo/installers/azure/release/mirror.sh}
work=$(mktemp -d)
container=""
cleanup() {
  [ -z "$container" ] || docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

for tool in docker crane cosign; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done
real_crane=$(command -v crane)
real_cosign=$(command -v cosign)

# --- a local registry
container=$(docker run -d --rm -p 127.0.0.1::5000 registry:2)
port=$(docker port "$container" 5000/tcp | head -1 | sed 's/.*://')
registry="127.0.0.1:$port"
tries=0
until "$real_crane" catalog "$registry" >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 50 ] || { echo "registry did not start" >&2; exit 1; }
  sleep 0.2
done

# --- a small OCI tarball and a throwaway key
mkdir -p "$work/context"
printf 'FROM scratch\nCOPY hello.txt /hello.txt\n' > "$work/context/Dockerfile"
echo "mirror check" > "$work/context/hello.txt"
docker buildx build --quiet --platform linux/amd64 --provenance=false --sbom=false \
  --output "type=oci,dest=$work/image.tar" "$work/context" >/dev/null
mkdir -p "$work/layout"
tar -xf "$work/image.tar" -C "$work/layout"
digest=$(tr -d ' \t\r\n' < "$work/layout/index.json" | sed -n 's/.*"digest":"\([^"]*\)".*/\1/p')
echo "image $digest"
(cd "$work" && COSIGN_PASSWORD=check cosign generate-key-pair >/dev/null 2>&1)
sign() { # file bundle
  COSIGN_PASSWORD=check "$real_cosign" sign-blob --yes --key "$work/cosign.key" --tlog-upload=false \
    --use-signing-config=false --bundle "$2" "$1" >/dev/null 2>&1
}

# Tampered variants of the tarball. Each is a full OCI layout re-tarred.
variant() { # name edit-command
  rm -rf "$work/v" && cp -R "$work/layout" "$work/v" && chmod -R u+w "$work/v"
  (cd "$work/v" && eval "$2")
  (cd "$work/v" && tar -cf "$work/$1.tar" index.json oci-layout blobs)
}
config=$(tr -d ' \t\r\n' < "$work/layout/blobs/sha256/${digest#sha256:}" | sed -n 's/.*"config":{[^}]*"digest":"sha256:\([0-9a-f]*\)".*/\1/p')
layer=$(for blob in "$work"/layout/blobs/sha256/*; do
  name=${blob##*/}
  [ "sha256:$name" = "$digest" ] || [ "$name" = "$config" ] || echo "$name"
done | head -1)
variant layer "printf 'x' >> blobs/sha256/$layer"
variant index "sed 's/${digest#sha256:}/$config/' index.json > i && mv i index.json"
variant two "sed 's/\"manifests\":\[\(.*\)\]}/\"manifests\":[\1,\1]}/' index.json > i && mv i index.json"
variant arm64 "sed 's/\"architecture\":\"amd64\"/\"architecture\":\"arm64\"/' index.json > i && mv i index.json"

# --- shims: crane skips the registry login; aws prints a dummy password; cosign
# tolerates the missing tlog entry.
mkdir -p "$work/bin" "$work/nocosign"
cat > "$work/bin/crane" <<EOF
#!/bin/sh
[ "\$1 \$2" = "auth login" ] && exit 0
exec "$real_crane" "\$@"
EOF
printf '#!/bin/sh\necho dummy\n' > "$work/bin/aws"
cat > "$work/bin/cosign" <<EOF
#!/bin/sh
[ "\$1" = verify-blob ] && { shift; exec "$real_cosign" verify-blob --insecure-ignore-tlog=true "\$@"; }
exec "$real_cosign" "\$@"
EOF
chmod +x "$work/bin/crane" "$work/bin/aws" "$work/bin/cosign"
cp "$work/bin/crane" "$work/bin/aws" "$work/nocosign/"
with_cosign="$work/bin:/usr/bin:/bin"
without_cosign="$work/nocosign:/usr/bin:/bin"

failures=0
pass() { echo "ok   $1"; }
flunk() { echo "FAIL $1" >&2; sed 's/^/     | /' "$work/out" >&2; failures=$((failures + 1)); }
absent() { ! "$real_crane" digest "$1" >/dev/null 2>&1; }

# expect <name> <0|1> <stderr/stdout pattern> <image reference that must (not) exist> -- command...
expect() {
  name=$1 status=$2 pattern=$3 reference=$4
  shift 5
  set +e
  "$@" > "$work/out" 2>&1
  code=$?
  set -e
  if [ "$status" = 0 ] && [ "$code" -ne 0 ]; then flunk "$name (exit $code)"; return; fi
  if [ "$status" = 1 ] && [ "$code" -eq 0 ]; then flunk "$name (exit 0, expected a refusal)"; return; fi
  grep -q -- "$pattern" "$work/out" || { flunk "$name (no '$pattern')"; return; }
  if [ "$status" = 1 ] && ! absent "$reference"; then flunk "$name (something was pushed: $reference)"; return; fi
  if [ "$status" = 0 ] && absent "$reference"; then flunk "$name (nothing at $reference)"; return; fi
  pass "$name"
}

tag=$(printf '%s' "$digest" | cut -c8-19)
seen() { # name pattern: the last run printed the pattern
  if grep -q -- "$2" "$work/out"; then pass "$1"; else flunk "$1"; fi
}

# --- Azure: release/{mirror.sh,image-azure.txt,image-execution.txt,cosign.pub,<tarballs>,
#     gateway/evidence/<tarball>.bundle,code-interpreter/evidence/<tarball>.bundle}
azure() { # directory gateway-variant execution-variant [execution-bundle-variant]
  release="$work/$1/release"
  mkdir -p "$release/gateway/evidence" "$release/code-interpreter/evidence"
  cp "$azure_mirror" "$release/mirror.sh" && cp "$work/cosign.pub" "$release/"
  cp "$work/$2.tar" "$release/bymorning-check.tar"
  cp "$work/$3.tar" "$release/bymorning-code-interpreter-check.tar"
  printf '# check\nversion: 9.9.9\ntarball: bymorning-check.tar\ndigest: %s\n' "$digest" > "$release/image-azure.txt"
  printf '# check\nversion: 9.9.9\ntarball: bymorning-code-interpreter-check.tar\ndigest: %s\n' "$digest" \
    > "$release/image-execution.txt"
  sign "$work/$2.tar" "$release/gateway/evidence/bymorning-check.tar.bundle"
  sign "$work/${4:-image}.tar" "$release/code-interpreter/evidence/bymorning-code-interpreter-check.tar.bundle"
  echo "$release/mirror.sh"
}
script=$(azure az-good image image)
expect "azure: intact release pushes both images" 0 "execution image: $registry/good/bymorning-code-interpreter@$digest" \
  "$registry/good/bymorning-code-interpreter:9.9.9" -- env PATH="$with_cosign" sh "$script" "$registry/good" 9.9.9
seen "azure: cosign verified the Gateway signature" "image-azure.txt: signature verified"
seen "azure: cosign verified the execution signature" "image-execution.txt: signature verified"
expect "azure: a version other than the recorded one is refused" 1 "records version 9.9.9, not 9.9.8" \
  "$registry/version/bymorning:9.9.8" -- env PATH="$with_cosign" sh "$script" "$registry/version" 9.9.8
script=$(azure az-layer image layer)
expect "azure: modified execution layer is refused by cosign" 1 "cosign could not verify" \
  "$registry/layer1/bymorning-code-interpreter:9.9.9" -- env PATH="$with_cosign" sh "$script" "$registry/layer1" 9.9.9
expect "azure: modified execution layer is refused without cosign" 1 "hashes to" \
  "$registry/layer2/bymorning-code-interpreter:9.9.9" -- env PATH="$without_cosign" sh "$script" "$registry/layer2" 9.9.9
script=$(azure az-index image index index)
expect "azure: index naming another digest is refused" 1 "but image-execution.txt expects" \
  "$registry/index/bymorning-code-interpreter:9.9.9" -- env PATH="$with_cosign" sh "$script" "$registry/index" 9.9.9
script=$(azure az-two two image)
expect "azure: two manifests are refused before the Gateway is pushed" 1 "names 2 manifests" \
  "$registry/two/bymorning:9.9.9" -- env PATH="$with_cosign" sh "$script" "$registry/two" 9.9.9
script=$(azure az-arm64 image arm64 arm64)
expect "azure: another platform is refused" 1 "not linux/amd64" \
  "$registry/arm64/bymorning-code-interpreter:9.9.9" -- env PATH="$with_cosign" sh "$script" "$registry/arm64" 9.9.9

# --- Azure, keyless pin: release/signer.txt names the signing workflow instead of a key. Keyless
# signatures cannot be produced offline, so a cosign stand-in accepts verify-blob only when asked for
# exactly the identity and issuer in signer.txt; what is checked is that mirror.sh asks for them.
keyless_identity="https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v9.9.9"
keyless_issuer="https://token.actions.githubusercontent.com"
mkdir -p "$work/pin"
cat > "$work/pin/cosign" <<EOF
#!/bin/sh
case "\$*" in
  verify-blob*"--certificate-identity $keyless_identity --certificate-oidc-issuer $keyless_issuer"*) exit 0 ;;
esac
echo "unexpected cosign arguments: \$*" >&2
exit 1
EOF
chmod +x "$work/pin/cosign"
cp "$work/bin/crane" "$work/bin/aws" "$work/pin/"
with_pin="$work/pin:/usr/bin:/bin"
pin() { # directory identity: a keyless package: signer.txt in place of cosign.pub
  script=$(azure "$1" image image)
  rm "$(dirname "$script")/cosign.pub"
  printf 'identity: %s\nissuer: %s\n' "$2" "$keyless_issuer" > "$(dirname "$script")/signer.txt"
}
pin az-keyless "$keyless_identity"
expect "azure keyless: verification asks for the identity and issuer in signer.txt" 0 "signature verified against the pinned signer" \
  "$registry/keyless/bymorning:9.9.9" -- env PATH="$with_pin" sh "$script" "$registry/keyless" 9.9.9
pin az-keyless-other "https://github.com/someone-else/fork/.github/workflows/full-gate.yml@refs/tags/v9.9.9"
expect "azure keyless: a different signing identity is refused" 1 "cosign could not verify" \
  "$registry/keyless2/bymorning:9.9.9" -- env PATH="$with_pin" sh "$script" "$registry/keyless2" 9.9.9
pin az-keyless-empty ""
expect "azure keyless: an empty signer.txt is refused" 1 "names no identity and issuer" \
  "$registry/keyless3/bymorning:9.9.9" -- env PATH="$with_pin" sh "$script" "$registry/keyless3" 9.9.9

if [ "$failures" -gt 0 ]; then
  echo "$failures mirror check(s) failed" >&2
  exit 1
fi
echo "all mirror checks passed"
