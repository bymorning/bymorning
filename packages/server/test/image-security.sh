#!/bin/sh
# Security gate for the Gateway image. Builds the root Dockerfile (or reuses an
# image passed as IMAGE=, or loads the release tarball itself) and asserts the
# properties the shipped artifact must hold: FIPS 140-3 operation on the RHEL 9
# OpenSSL FIPS Provider (CMVP #4857), non-root execution, no JavaScript package
# managers, the expected Node toolchain, release labels, working approved
# cryptography, and an RDS CA bundle that covers both AWS partitions.
#
#   sh test/image-security.sh                # builds a fresh image
#   IMAGE=bymorning:1.0.0 sh test/image-security.sh
#   TARBALL=release/bymorning-<commit>.tar sh test/image-security.sh
#   TARBALL=/tmp/rel/bymorning-<commit>.tar RELEASE_DIR=/tmp/rel sh test/image-security.sh
#
# TARBALL mode is the release gate: fixtures/oci-load.sh verifies the archive
# against RELEASE_DIR/manifest.json (digest, blobs, labels, user, command) before
# `docker load`, exactly as test/image-boot.sh does, so the checks run on the
# artifact the customer receives. SEC-IMG-05 then also requires the version
# label to equal the manifest's version. Needs node and jq in TARBALL mode.
#
# One image serves every cloud: both backends ship in it, so there is no
# absence check. The image bakes no deployment environment (AWS_USE_FIPS_ENDPOINT,
# NODE_EXTRA_CA_CERTS, selectors); the installer sets those.
#
# The shipped platform is linux/amd64; override PLATFORM only for local runs.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
platform="${PLATFORM:-linux/amd64}"
gate=$(mktemp -d)
trap 'rm -rf "$gate"' EXIT

checks=0
failures=0
note() { printf '%s\n' "$1"; }
expect_version=""
if [ -n "${TARBALL:-}" ]; then
  # Sets image, expect_version, expect_commit, oci_facts; exits 1 on any disagreement.
  . "$root/packages/server/test/fixtures/oci-load.sh"
  oci_load "$TARBALL" "${RELEASE_DIR:-$root/release}" "$gate"
  note "archive verified before load: $oci_facts"
elif [ -n "${IMAGE:-}" ]; then
  image="$IMAGE"
else
  image="bymorning-security:${USER:-local}"
  docker build --platform "$platform" -f "$root/Dockerfile" -t "$image" "$root" >/dev/null
fi
report() { # id outcome detail
  checks=$((checks + 1))
  if [ "$2" = "ok" ]; then
    printf 'ok   %s %s\n' "$1" "$3"
  else
    printf 'FAIL %s %s\n' "$1" "$3" >&2
    failures=$((failures + 1))
  fi
}
# node_in <script>: run Node in the image with its baked-in environment.
node_in() { docker run --rm --platform "$platform" --entrypoint node "$image" "$@"; }
sh_in() { docker run --rm --platform "$platform" --entrypoint sh "$image" -c "$1"; }

# [SEC-IMG-01] FIPS mode is active from the image's own environment.
fips=$(node_in -p 'require("node:crypto").getFips()')
[ "$fips" = "1" ] && report SEC-IMG-01 ok "crypto.getFips() is 1 (FIPS mode active)" || report SEC-IMG-01 fail "crypto.getFips() is $fips, expected 1"

# [SEC-IMG-02] The process never runs as root, by config and at runtime.
config_user=$(docker image inspect "$image" --format '{{.Config.User}}')
uidgid=$(node_in -p 'process.getuid() + ":" + process.getgid()')
if [ "$config_user" = "65532:65532" ] && [ "$uidgid" = "65532:65532" ]; then
  report SEC-IMG-02 ok "runs as 65532:65532"
else
  report SEC-IMG-02 fail "user is config=$config_user runtime=$uidgid, expected 65532:65532"
fi

# [SEC-IMG-03] No JavaScript package manager ships in the runtime.
found=$(sh_in 'for b in bun npm npx; do command -v "$b" 2>/dev/null; done; for p in /usr/local/bin/bun /usr/bin/bun /usr/bin/npm /usr/bin/npx /usr/local/bin/npm /opt/app-root/src/.npm-global/bin/npm; do [ -e "$p" ] && echo "$p"; done' || true)
[ -z "$found" ] && report SEC-IMG-03 ok "no bun/npm/npx in the runtime" || report SEC-IMG-03 fail "package managers present: $(echo "$found" | tr '\n' ' ')"

# [SEC-IMG-04] Node 22 linked against the shared system OpenSSL (the FIPS design premise).
nodev=$(node_in -p 'process.version')
shared=$(node_in -p 'process.config.variables.node_shared_openssl')
opensslv=$(node_in -p 'process.versions.openssl')
case "$nodev" in
  v22.*) : ;;
  *) report SEC-IMG-04 fail "node $nodev is not 22.x" ;;
esac
if [ "$shared" = "true" ] && [ "${nodev#v22.}" != "$nodev" ]; then
  report SEC-IMG-04 ok "node $nodev on shared system OpenSSL $opensslv"
else
  [ "$shared" = "true" ] || report SEC-IMG-04 fail "node is not linked against shared OpenSSL"
fi

# [SEC-IMG-05] Release labels and security environment are stamped, and no
# deployment environment is baked in. AWS_USE_FIPS_ENDPOINT is the installer's
# (AWS ECS sets true; Azure sets it only for Bedrock in a GovCloud partition),
# as is any trust-anchor override (NODE_EXTRA_CA_CERTS).
labels=$(docker image inspect "$image" --format '{{json .Config.Labels}}')
envs=$(docker image inspect "$image" --format '{{json .Config.Env}}')
missing=""
for label in org.opencontainers.image.version org.opencontainers.image.source org.opencontainers.image.revision org.opencontainers.image.created; do
  echo "$labels" | grep -q "\"$label\"" || missing="$missing $label"
done
for env in OPENSSL_CONF=/etc/pki/tls/openssl-fips.cnf BYMORNING_VERSION= HOST=0.0.0.0; do
  echo "$envs" | grep -q "$env" || missing="$missing env:$env"
done
for env in AWS_USE_FIPS_ENDPOINT NODE_EXTRA_CA_CERTS STORAGE_PROVIDER CIPHER_BACKEND BYMORNING_DATA_DIR; do
  echo "$envs" | grep -q "\"$env=" && missing="$missing env:$env-unexpected"
done
version_label=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.version"}}')
[ -z "$expect_version" ] || [ "$version_label" = "$expect_version" ] || missing="$missing version-label:$version_label!=$expect_version"
[ -z "$missing" ] && report SEC-IMG-05 ok "OCI labels (version $version_label) and OPENSSL_CONF/BYMORNING_VERSION/HOST present; no deployment environment baked in" || report SEC-IMG-05 fail "missing:$missing"

# [SEC-IMG-06] The active FIPS module is the validated RHEL 9 OpenSSL FIPS Provider.
providers=$(sh_in 'openssl list -providers')
if echo "$providers" | grep -q "Red Hat Enterprise Linux 9 - OpenSSL FIPS Provider" && echo "$providers" | grep -A2 'name: Red Hat' | grep -q 'status: active'; then
  module_version=$(echo "$providers" | grep -A1 'name: Red Hat' | sed -n 's/.*version: //p')
  report SEC-IMG-06 ok "fips provider active: $module_version (CMVP #4857)"
else
  report SEC-IMG-06 fail "RHEL 9 OpenSSL FIPS Provider not active: $(echo "$providers" | tr '\n' ' ')"
fi

# [SEC-IMG-07] Approved cryptography the application depends on works under FIPS.
crypto=$(node_in --input-type=module -e '
  import crypto from "node:crypto"
  const fail = (name, error) => { console.log(`${name}: ${error}`); process.exit(1) }
  const key = crypto.randomBytes(32)
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 })
  const encrypted = Buffer.concat([cipher.update("cui"), cipher.final()])
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 })
  decipher.setAuthTag(cipher.getAuthTag())
  if (Buffer.concat([decipher.update(encrypted), decipher.final()]).toString() !== "cui") fail("aes-256-gcm", "roundtrip mismatch")
  if (crypto.createHash("sha256").update("abc").digest("hex") !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") fail("sha256", "known answer mismatch")
  if (crypto.randomBytes(32).length !== 32) fail("randomBytes", "length mismatch")
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
  const signature = crypto.sign("sha256", Buffer.from("m"), pair.privateKey)
  if (!crypto.verify("sha256", Buffer.from("m"), pair.publicKey, signature)) fail("ecdsa-p256", "verify failed")
  if (Buffer.from(crypto.hkdfSync("sha256", "ikm", "salt", "info", 32)).length !== 32) fail("hkdf", "length mismatch")
  if (!crypto.timingSafeEqual(Buffer.from("aa"), Buffer.from("aa"))) fail("timingSafeEqual", "mismatch")
  console.log("aes-256-gcm, sha256, randomBytes, ecdsa-p256, hkdf, timingSafeEqual")
' 2>&1) && report SEC-IMG-07 ok "$crypto" || report SEC-IMG-07 fail "$crypto"

# [SEC-IMG-08] The TLS listener negotiates only FIPS-approved versions and suites.
# The cipher policy is extracted from packages/server/src/application.ts so this
# test cannot drift from the shipped configuration.
ciphers=$(sed -n '/export const ciphers = \[/,/\]\.join/p' "$root/packages/server/src/application.ts" | sed -n 's/.*"\(ECDHE-[A-Z0-9-]*\)".*/\1/p' | paste -sd: -)
suites13=$(sed -n '/export const ciphers = \[/,/\]\.join/p' "$root/packages/server/src/application.ts" | sed -n 's/.*"\(TLS_AES_[A-Z0-9_]*\)".*/\1/p' | paste -sd: -)
tls=$(docker run --rm --platform "$platform" --entrypoint sh -e SEC_CIPHERS="$ciphers" -e SEC_SUITES="$suites13" "$image" -c '
  set -eu
  cd /tmp
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout key.pem -out cert.pem -days 1 -nodes -subj "/CN=sec-img" >/dev/null 2>&1
  node --input-type=module -e "
    import { createServer } from \"node:https\"
    import { connect } from \"node:tls\"
    import { readFileSync } from \"node:fs\"
    const server = createServer({
      key: readFileSync(\"/tmp/key.pem\"),
      cert: readFileSync(\"/tmp/cert.pem\"),
      minVersion: \"TLSv1.2\",
      ciphers: process.env.SEC_CIPHERS,
      ciphersuites: process.env.SEC_SUITES,
      honorCipherOrder: true,
    }, (req, res) => res.end(\"ok\"))
    await new Promise((resolve) => server.listen(0, \"127.0.0.1\", resolve))
    const port = server.address().port
    const attempt = (options) => new Promise((resolve) => {
      let socket
      const done = (verdict) => { try { socket?.destroy() } catch {} ; resolve(verdict) }
      try {
        socket = connect({ port, host: \"127.0.0.1\", rejectUnauthorized: false, ...options }, () =>
          done(\"connected \" + socket.getProtocol() + \" \" + socket.getCipher().name))
        socket.setTimeout(5000, () => done(\"refused\"))
        socket.on(\"error\", () => done(\"refused\"))
      } catch { done(\"refused\") }
    })
    const lines = [
      \"tls1.3=\" + (await attempt({ minVersion: \"TLSv1.3\", maxVersion: \"TLSv1.3\" })),
      \"tls1.2=\" + (await attempt({ minVersion: \"TLSv1.2\", maxVersion: \"TLSv1.2\", ciphers: \"ECDHE-ECDSA-AES128-GCM-SHA256\" })),
      \"tls1.1=\" + (await attempt({ minVersion: \"TLSv1.1\", maxVersion: \"TLSv1.1\" })),
      \"chacha20=\" + (await attempt({ minVersion: \"TLSv1.2\", maxVersion: \"TLSv1.2\", ciphers: \"ECDHE-ECDSA-CHACHA20-POLY1305\" })),
    ]
    console.log(lines.join(\"|\"))
    process.exit(0)
  "
' 2>&1) || { report SEC-IMG-08 fail "TLS probe errored: $tls"; tls=""; }
if [ -n "$tls" ]; then
  case "$tls" in
    *"tls1.3=connected TLSv1.3 TLS_AES_"*"_GCM_SHA"*) t13=ok ;; *) t13=fail ;;
  esac
  case "$tls" in
    *"tls1.2=connected TLSv1.2 ECDHE-ECDSA-AES"*"GCM"*) t12=ok ;; *) t12=fail ;;
  esac
  case "$tls" in *"tls1.1=refused"*) t11=ok ;; *) t11=fail ;; esac
  case "$tls" in *"chacha20=refused"*) cc=ok ;; *) cc=fail ;; esac
  if [ "$t13|$t12|$t11|$cc" = "ok|ok|ok|ok" ]; then
    report SEC-IMG-08 ok "TLS 1.3/1.2 AES-GCM connect; TLS 1.1 and ChaCha20 refused"
  else
    report SEC-IMG-08 fail "$tls"
  fi
fi

# [SEC-IMG-12] Ed25519 is never FIPS 186-5 approved and stays blocked by the
# FIPS provider inside the image.
ed25519=$(node_in --input-type=module -e '
  import { createPublicKey, verify } from "node:crypto"
  try {
    const key = createPublicKey("-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEASNhudCRMKUhBdLfAE/Q8YXDVtNbzYH7ib4k2OQ1Yk6Y=\n-----END PUBLIC KEY-----\n")
    verify(null, Buffer.from("m"), key, Buffer.alloc(64))
    console.log("available")
  } catch (error) {
    console.log("blocked")
  }
' 2>&1)
if [ "$ed25519" = "blocked" ]; then
  report SEC-IMG-12 ok "Ed25519 remains blocked by the FIPS provider"
else
  report SEC-IMG-12 fail "ed25519=[$ed25519]"
fi

# [SEC-IMG-10] System package manager audit. rpm and microdnf are kept on
# purpose: the rpm database is the SBOM and vulnerability-scan source of truth
# for the base image, and microdnf enables emergency patching. No other
# manager may appear.
others=$(sh_in 'for b in yum dnf apt apt-get apk; do command -v "$b" 2>/dev/null; done' || true)
if [ -z "$others" ]; then
  kept=$(sh_in 'for b in rpm microdnf; do command -v "$b" 2>/dev/null || true; done' | tr '\n' ' ')
  report SEC-IMG-10 ok "no other package managers; retained by design: $kept"
else
  report SEC-IMG-10 fail "unexpected package managers: $(echo "$others" | tr '\n' ' ')"
fi

# [SEC-IMG-11] The AWS RDS CA bundle is pinned in the image and readable by the
# runtime user so DATABASE_URL can require sslmode=verify-full (Azure
# deployments ignore it and supply DATABASE_CA). It must carry the roots of
# both AWS partitions: the commercial global bundle alone does not verify Aurora
# in us-gov-west-1 or us-gov-east-1 (UNABLE_TO_GET_ISSUER_CERT_LOCALLY), so
# require a commercial root and the GovCloud roots, and require each GovCloud
# intermediate in the bundle to verify against it.
bundle=$(sh_in '
  set -e
  b=/app/certs/rds-global-bundle.pem
  test -r "$b"
  head -c 27 "$b"; echo
  stat -c "mode=%a" /app/certs "$b"
  echo "count=$(grep -c -- "-----BEGIN CERTIFICATE-----" "$b")"
  openssl crl2pkcs7 -nocrl -certfile "$b" | openssl pkcs7 -print_certs -noout | grep "^subject=" | sed "s/^.*CN *= *//; s/,.*$//; s/^/cn=/"
  work=$(mktemp -d)
  awk -v d="$work" "/-----BEGIN CERTIFICATE-----/{n++} {print > (d \"/\" n \".pem\")}" "$b"
  for c in "$work"/*.pem; do
    case "$(openssl x509 -in "$c" -noout -subject)" in
      *"us-gov-"*"Root CA"*) ;;
      *"us-gov-"*) openssl verify -CAfile "$b" "$c" >/dev/null 2>&1 && echo "govverify=ok" || echo "govverify=fail" ;;
    esac
  done
' 2>&1 || true)
count=$(echo "$bundle" | sed -n 's/^count=//p')
commercial=$(echo "$bundle" | grep -c '^cn=Amazon RDS us-east-1 Root CA' || true)
govwest=$(echo "$bundle" | grep -c '^cn=Amazon RDS us-gov-west-1 Root CA' || true)
goveast=$(echo "$bundle" | grep -c '^cn=Amazon RDS us-gov-east-1 Root CA' || true)
govok=$(echo "$bundle" | grep -c '^govverify=ok$' || true)
govbad=$(echo "$bundle" | grep -c '^govverify=fail$' || true)
if echo "$bundle" | grep -q -- '-----BEGIN CERTIFICATE-----' && echo "$bundle" | grep -q '^mode=755$' && echo "$bundle" | grep -q '^mode=644$' \
  && [ "$commercial" -ge 1 ] && [ "$govwest" -ge 1 ] && [ "$goveast" -ge 1 ] && [ "$govok" -ge 1 ] && [ "$govbad" = 0 ]; then
  report SEC-IMG-11 ok "/app/certs/rds-global-bundle.pem readable by uid 65532: $count certificates; roots us-east-1=$commercial us-gov-west-1=$govwest us-gov-east-1=$goveast; $govok GovCloud intermediates verify"
else
  report SEC-IMG-11 fail "RDS CA bundle: count=$count us-east-1=$commercial us-gov-west-1=$govwest us-gov-east-1=$goveast govverify ok=$govok fail=$govbad: $(echo "$bundle" | grep -v '^cn=' | tr '\n' ' ')"
fi

note ""
if [ "$failures" -gt 0 ]; then
  note "image security: $failures of $checks checks FAILED"
  exit 1
fi
note "image security: all $checks checks passed ($image)"
