#!/bin/sh
# Boots the Gateway image itself (linux/amd64) and verifies it the way an
# installer runs it, without touching a cloud. Two legs select the deployment
# environment the image receives; everything else is the shipped image:
#
#   LEG=aws (default)  the AWS ECS task's environment (STORAGE_PROVIDER=s3,
#                      CIPHER_BACKEND=kms): TLS listener, health, database
#                      migration over verify-full TLS, credential-envelope
#                      encryption through KMS, S3 storage, installation
#                      documents, plugin inventory, and startup failures
#                      (missing, unknown, and development-only selectors).
#   LEG=azure          the AKS pod's environment (STORAGE_PROVIDER=azure-blob,
#                      CIPHER_BACKEND=keyvault, AZURE_CLOUD=AzureCloud, workload
#                      identity): plain-HTTP health as the pod probes see it,
#                      the workload-identity token exchange, Key Vault key
#                      resolution and wrapping, Blob Storage against Azurite,
#                      inventory, log hygiene, and the cloud-endpoint refusals.
#                      Wiring only: the AWS leg owns the TLS and FIPS checks.
#
#   sh test/image-boot.sh                                   # builds the root Dockerfile
#   LEG=azure sh test/image-boot.sh                         # the Azure leg against a fresh build
#   IMAGE=bymorning:1.0.2-rc.1 sh test/image-boot.sh        # an image already loaded
#   TARBALL=release/bymorning-<commit>.tar sh test/image-boot.sh
#                                                           # the release tarball itself
#   TARBALL=/tmp/rel/bymorning-<commit>.tar RELEASE_DIR=/tmp/rel sh test/image-boot.sh
#                                                           # a test build's --out directory
#
# TARBALL mode is the release-candidate check and has no bypass. Before anything
# is loaded or run, fixtures/oci-archive.mjs (through fixtures/oci-load.sh) must
# accept the archive: safe members only, exactly one linux/amd64 manifest whose
# digest is the one release/manifest.json records for the gateway, every blob's
# sha256 and size, no unreferenced blobs, version and revision labels that match
# the manifest, and the image Cmd, User and port that an AWS ECS task definition
# relies on. RELEASE_DIR may point
# at another release directory holding a manifest.json (for example a test
# build's --out); the archive must still match every field in it. Only then is
# the image loaded and the runtime checks run. Nothing is pushed or signed.
# IMAGE= mode has no release record; set EXPECT_VERSION and EXPECT_COMMIT to
# check its labels. Needs jq in TARBALL mode.
#
# EMULATOR BOUNDARIES (everything else is the shipped image, unmodified):
#   * Postgres     a disposable local postgres:17 with its own throwaway CA. The
#                  image's DATABASE_URL trust setting (sslrootcert) points at that
#                  CA instead of the AWS RDS bundle; the RDS bundle path is
#                  separately proven to REJECT this CA (AWS leg).
#   * KMS and S3   (AWS leg) fixtures/aws-emulator.mjs, reached through Docker
#                  network aliases for the real FIPS hostnames (kms-fips.<region>,
#                  s3-fips.<region>, <bucket>.s3-fips.<region>) with a throwaway
#                  CA supplied through NODE_EXTRA_CA_CERTS. AWS_USE_FIPS_ENDPOINT
#                  stays true, so the SDK's FIPS endpoint routing is exercised.
#                  Static fake credentials stand in for the task role.
#   * AgentCore    NOT emulated, NOT replaced, and UNTESTED. The profile still
#                  selects the agentcore Code Interpreter with a fake identifier;
#                  no request reaches AgentCore. Real code execution needs a real
#                  Code Interpreter and the task role.
#   * Entra and    (Azure leg) fixtures/azure-emulator.mjs at the production
#     Key Vault    hostnames login.microsoftonline.com and <vault>.vault.azure.net
#                  (network aliases, throwaway CA). The AKS workload-identity
#                  webhook is reproduced by hand: AZURE_CLIENT_ID, AZURE_TENANT_ID,
#                  AZURE_FEDERATED_TOKEN_FILE and AZURE_AUTHORITY_HOST, with a
#                  projected token minted by a throwaway RSA key the emulator
#                  trusts. It never verifies Azure RBAC or Key Vault policy.
#   * Blob Storage (Azure leg) real Azurite (digest-pinned) with OAuth over TLS
#                  at <account>.blob.core.windows.net. The container Terraform
#                  would create is created through the account key first.
#
# WHAT THIS DOES NOT PROVE: the emulators do not verify SigV4, IAM or KMS key
# policy, Azure RBAC, VPC endpoints, security groups, ALB or ingress behavior, or
# a real RDS/Aurora or Flexible Server certificate chain. Passing means the
# shipped image starts, migrates, serves, and calls its cloud dependencies the
# way its code intends, not that a deployment is permitted to. A signed-in Blob
# write through an application feature stays with installers/azure/test/kind-e2e.sh.
#
# The shipped platform is linux/amd64; on an arm64 Docker host the image runs
# under emulation (slower). Override PLATFORM only for local runs.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
platform="${PLATFORM:-linux/amd64}"
postgres="${POSTGRES_IMAGE:-postgres:17-alpine}"
# Azurite 3.37.0 (multi-arch index digest), the same pin backends/azure tests use.
azurite="${AZURITE_IMAGE:-mcr.microsoft.com/azure-storage/azurite@sha256:830430c1da1a2d537e08f3e6764dd1f5ae00cf0346bcaf625b968ec3f0971fd5}"
leg="${LEG:-aws}"
case "$leg" in aws | azure) ;; *) echo "image boot: LEG must be aws or azure, not $leg" >&2; exit 1 ;; esac
suffix="${USER:-local}-$$"
network="bymorning-boot-$suffix"
volume="bymorning-boot-$suffix"
work=$(mktemp -d)
bucket=bymorning-smoke
region=us-east-1
origin=https://smoke.test

# Azure leg values (the AKS deployment's shape; none is a real tenant, account, or vault).
tenant=0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f
client_id=1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a
idp_client_id=2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b
account=bymorningsmoke
container=bymorning
vault=bymorning-kv
keyname=bymorning-cipher
wi_subject=system:serviceaccount:bymorning:bymorning-gateway

checks=0
failures=0
# AWS leg: 29 startup, serving, and dependency checks. Azure leg: 5 shared
# startup checks plus 9 wiring checks. Plus SMK-00 in tarball mode.
if [ "$leg" = aws ]; then expected_checks=29; else expected_checks=14; fi
[ -z "${TARBALL:-}" ] || expected_checks=$((expected_checks + 1))

report() { # id outcome detail
  checks=$((checks + 1))
  if [ "$2" = "ok" ]; then
    printf 'ok   %s %s\n' "$1" "$3"
  else
    printf 'FAIL %s %s\n' "$1" "$3" >&2
    failures=$((failures + 1))
  fi
}

cleanup() {
  for name in "boot-gateway-$suffix" "boot-aws-$suffix" "boot-azure-$suffix" "boot-azurite-$suffix" "boot-db-$suffix"; do docker rm -f "$name" >/dev/null 2>&1 || true; done
  for name in $(docker ps -aq --filter "label=bymorning.boot=$suffix"); do docker rm -f "$name" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# Every wait for a container is bounded well under the CI job's 30 minutes. A
# wait that expires prints what the containers were doing and exits non-zero,
# instead of leaving the job to its timeout with nothing to read.
boot_wait="${BOOT_WAIT:-300}"
diagnose() { # reason
  echo "image boot: $1" >&2
  echo "--- docker ps -a" >&2
  docker ps -a >&2 2>&1 || true
  for name in "boot-gateway-$suffix" "boot-aws-$suffix" "boot-azure-$suffix" "boot-azurite-$suffix" "boot-db-$suffix"; do
    docker inspect "$name" >/dev/null 2>&1 || continue
    echo "--- docker logs $name (last 200 lines)" >&2
    docker logs --tail 200 "$name" >&2 2>&1 || true
  done
}

# --- The image under test -------------------------------------------------
die() {
  echo "image boot: $1" >&2
  exit 1
}
if [ -n "${TARBALL:-}" ]; then
  # fixtures/oci-load.sh verifies the archive against the release manifest,
  # loads it, and sets image, expect_version, expect_commit, oci_facts.
  . "$root/packages/server/test/fixtures/oci-load.sh"
  oci_load "$TARBALL" "${RELEASE_DIR:-$root/release}" "$work"
  report SMK-00 ok "archive verified before load: $oci_facts"
elif [ -n "${IMAGE:-}" ]; then
  image="$IMAGE"
  expect_version="${EXPECT_VERSION:-}"
  expect_commit="${EXPECT_COMMIT:-}"
else
  image="bymorning-boot:${USER:-local}"
  docker build --platform "$platform" -f "$root/Dockerfile" -t "$image" "$root" >/dev/null
  expect_version="${EXPECT_VERSION:-}"
  expect_commit="${EXPECT_COMMIT:-}"
fi
arch=$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')
[ "$arch" = "$platform" ] && report SMK-01 ok "image is $arch" || report SMK-01 fail "image is $arch, expected $platform"

image_id=$(docker image inspect "$image" --format '{{.Id}}')
version_label=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.version"}}')
revision_label=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
cmd=$(docker image inspect "$image" --format '{{json .Config.Cmd}}')
labels=ok
[ -z "$expect_version" ] || [ "$version_label" = "$expect_version" ] || labels="version $version_label != $expect_version"
[ -z "$expect_commit" ] || case "$revision_label" in "$expect_commit"*) ;; *) labels="revision $revision_label !~ $expect_commit" ;; esac
[ "$cmd" = '["node","/app/bymorning.mjs"]' ] || labels="Cmd is $cmd"
[ "$labels" = ok ] && report SMK-01a ok "id $image_id; version=$version_label revision=$revision_label; Cmd $cmd (the gateway container in ecs.tf sets no command)" \
  || report SMK-01a fail "$labels"

node_run() { docker run --rm --platform "$platform" --label "bymorning.boot=$suffix" "$@"; }

# --- Throwaway PKI, generated by the image's own FIPS OpenSSL -------------
# The emulator leaf carries the leg's production hostnames; the Azure leg also
# mints the workload-identity token (RS256, throwaway key) the AKS webhook
# would project, and keeps the public key for the emulator to verify it with.
if [ "$leg" = aws ]; then
  emulator_san="DNS:kms-fips.$region.amazonaws.com,DNS:s3-fips.$region.amazonaws.com,DNS:*.s3-fips.$region.amazonaws.com,DNS:issuer.smoke.test"
else
  emulator_san="DNS:login.microsoftonline.com,DNS:$vault.vault.azure.net,DNS:$account.blob.core.windows.net"
fi
docker network create "$network" >/dev/null
docker volume create "$volume" >/dev/null
node_run -i --user 0 -v "$volume:/smoke" -e LEG="$leg" -e EMULATOR_SAN="$emulator_san" -e WI_SUBJECT="$wi_subject" --entrypoint sh "$image" -c '
  set -eu
  cd /smoke
  cat > "$LEG-emulator.mjs"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout ca.key -out ca.pem -days 2 -nodes -subj "/CN=smoke-ca" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign" 2>/dev/null
  leaf() { # name san
    openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout "$1.key" -out "$1.csr" -nodes -subj "/CN=$1" 2>/dev/null
    printf "subjectAltName=%s\nbasicConstraints=CA:FALSE\n" "$2" > "$1.ext"
    openssl x509 -req -in "$1.csr" -CA ca.pem -CAkey ca.key -CAcreateserial -out "$1.pem" -days 2 -extfile "$1.ext" 2>/dev/null
  }
  leaf db DNS:db.smoke.test
  leaf emulator "$EMULATOR_SAN"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout gateway.key -out gateway.pem -days 2 -nodes -subj "/CN=smoke.test" -addext "subjectAltName=DNS:smoke.test" 2>/dev/null
  if [ "$LEG" = azure ]; then
    node -e "
      const { generateKeyPairSync, createSign } = require(\"node:crypto\"), fs = require(\"node:fs\")
      const pair = generateKeyPairSync(\"rsa\", { modulusLength: 2048 })
      fs.writeFileSync(\"wi.pub\", pair.publicKey.export({ type: \"spki\", format: \"pem\" }))
      const b64 = (value) => Buffer.from(JSON.stringify(value)).toString(\"base64url\")
      const now = Math.floor(Date.now() / 1000)
      const signed = b64({ alg: \"RS256\", typ: \"JWT\", kid: \"smoke\" }) + \".\" + b64({ iss: \"https://kubernetes.smoke.test\", sub: process.env.WI_SUBJECT, aud: [\"api://AzureADTokenExchange\"], iat: now, nbf: now, exp: now + 7200 })
      fs.writeFileSync(\"azure-identity-token\", signed + \".\" + createSign(\"RSA-SHA256\").update(signed).sign(pair.privateKey).toString(\"base64url\"))
    "
    chmod 0644 wi.pub azure-identity-token
  fi
  chmod 0644 ca.pem db.pem emulator.pem gateway.pem "$LEG-emulator.mjs"
  chmod 0600 ca.key db.key emulator.key gateway.key
  chown 65532:65532 emulator.key
' <"$root/packages/server/test/fixtures/$leg-emulator.mjs"
volume_file() { node_run --user 0 -v "$volume:/smoke:ro" --entrypoint cat "$image" "/smoke/$1"; }
if [ "$leg" = aws ]; then
  # The AWS task serves TLS to the ALB; the AKS pod serves plain HTTP behind ingress.
  volume_file gateway.pem >"$work/gateway.pem"
  TLS_CERT=$(cat "$work/gateway.pem")
  TLS_KEY=$(volume_file gateway.key)
  export TLS_CERT TLS_KEY
fi

# --- Disposable Postgres with TLS 1.3 -------------------------------------
docker run -d --name "boot-db-$suffix" --label "bymorning.boot=$suffix" --network "$network" --network-alias db.smoke.test \
  -v "$volume:/smoke:ro" \
  -e POSTGRES_USER=bymorning -e POSTGRES_PASSWORD=bymorning-smoke-password -e POSTGRES_DB=bymorning \
  "$postgres" sh -c 'cp /smoke/db.key /tmp/db.key && chown postgres:postgres /tmp/db.key && chmod 600 /tmp/db.key &&
    exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/smoke/db.pem -c ssl_key_file=/tmp/db.key -c ssl_min_protocol_version=TLSv1.3 -c log_connections=on' >/dev/null
attempt=0
until [ "$(docker logs "boot-db-$suffix" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -le 90 ] || { diagnose "postgres did not become ready"; exit 1; }
  sleep 1
done
database() { # sslrootcert
  printf 'postgresql://bymorning:bymorning-smoke-password@db.smoke.test:5432/bymorning?sslmode=verify-full&sslrootcert=%s' "$1"
}
DATABASE_URL=$(database /smoke/ca.pem)
export DATABASE_URL

# [SMK-02] `migrate` applies the embedded migrations over verify-full TLS and exits 0; a rerun changes nothing.
# The migration ledger is compared before and after each run, not just the exit codes.
ledger() { # "none" before the ledger exists, else "<rows>:<md5 of the applied hashes>"
  psql_db() { docker exec "boot-db-$suffix" psql -U bymorning -d bymorning -tAc "$1" | tr -d ' '; }
  if [ "$(psql_db "select to_regclass('drizzle.__drizzle_migrations') is null")" = t ]; then
    echo none
  else
    psql_db "select count(*) || ':' || coalesce(md5(string_agg(hash, ',' order by id)), '') from drizzle.__drizzle_migrations"
  fi
}
migrate() { node_run --network "$network" -v "$volume:/smoke:ro" -e DATABASE_URL "$image" node /app/bymorning.mjs migrate 2>&1; }
expected=$(find "$root/packages/core/src/database/migration" -name migration.sql | wc -l | tr -d ' ')
before=$(ledger)
migrated=$(migrate) && status=0 || status=$?
first=$(ledger)
again=$(migrate) && again_status=0 || again_status=$?
second=$(ledger)
if [ "$before" = none ] && [ "$status" = 0 ] && [ "$again_status" = 0 ] && [ "${first%%:*}" = "$expected" ] && [ "$first" = "$second" ] \
  && echo "$migrated" | grep -q "Database migration complete" && echo "$again" | grep -q "Database migration complete"; then
  report SMK-02 ok "ledger none -> $first (${first%%:*} of $expected source migrations); rerun left it unchanged ($second)"
else
  report SMK-02 fail "before=$before first=$first second=$second expected=$expected status=$status rerun=$again_status: $migrated"
fi
ssl=$(docker logs "boot-db-$suffix" 2>&1 | grep -c 'SSL enabled (protocol=TLSv1.3' || true)
[ "${ssl:-0}" -ge 1 ] && report SMK-03 ok "database session negotiated TLSv1.3 with certificate verification" || report SMK-03 fail "no TLSv1.3 database session observed"

# [SMK-04] The AWS RDS CA bundle baked into the image (commercial + GovCloud roots; its contents are asserted by
# SEC-IMG-11 in image-security.sh) does NOT trust the local CA: verify-full fails closed
# and the failure never echoes the connection URL or password.
rejected=$(node_run --network "$network" -e DATABASE_URL="$(database /app/certs/rds-global-bundle.pem)" "$image" node /app/bymorning.mjs migrate 2>&1) && status=0 || status=$?
if [ "$status" != 0 ] && ! echo "$rejected" | grep -q "bymorning-smoke-password" && echo "$rejected" | grep -q "Host.MigrationError"; then
  report SMK-04 ok "RDS bundle rejects the local CA; migrate exits $status with an opaque error"
else
  report SMK-04 fail "status=$status: $rejected"
fi

# --- Shared helpers for both legs -------------------------------------------
cookie_key=$(node_run --entrypoint node "$image" -p 'require("node:crypto").randomBytes(32).toString("base64url")')
# Reads DATABASE_URL, TLS_CERT and TLS_KEY (exported above when set) by name so newlines survive.
gateway() { # name, extra docker args... : starts the Gateway detached
  name=$1
  shift
  docker run -d --name "$name" --label "bymorning.boot=$suffix" --platform "$platform" --network "$network" \
    -v "$volume:/smoke:ro" --env-file "$work/base.env" -e DATABASE_URL -e TLS_CERT -e TLS_KEY "$@" "$image" >/dev/null
}
wait_for_log() { # container needle label
  attempt=0
  until docker logs "$1" 2>&1 | grep -q "$2"; do
    attempt=$((attempt + 1))
    [ "$attempt" -le 60 ] || { diagnose "$3 did not start"; exit 1; }
    sleep 1
  done
}
# Each failure path must exit non-zero, name the culprit, and leak nothing.
expect_failure() { # id label needle env-file-line-to-remove-or-"" docker-args...
  id=$1 label=$2 needle=$3 remove=$4
  shift 4
  grep -v "^$remove=" "$work/base.env" >"$work/case.env" || true
  name="boot-fail-$id-$suffix"
  ( [ "$remove" != TLS_CERT ] || unset TLS_CERT
    [ "$remove" != TLS_KEY ] || unset TLS_KEY
    [ "$remove" != DATABASE_URL ] || unset DATABASE_URL
    docker run -d --name "$name" --label "bymorning.boot=$suffix" --platform "$platform" --network "$network" \
      -v "$volume:/smoke:ro" --env-file "$work/case.env" -e DATABASE_URL -e TLS_CERT -e TLS_KEY "$@" "$image" >/dev/null )
  attempt=0
  while [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ]; do
    attempt=$((attempt + 1))
    [ "$attempt" -le 90 ] || break
    sleep 1
  done
  running=$(docker inspect -f '{{.State.Running}}' "$name")
  code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
  output=$(docker logs "$name" 2>&1)
  docker rm -f "$name" >/dev/null 2>&1 || true
  if [ "$running" = false ] && [ "$code" != 0 ] && echo "$output" | grep -q "$needle" &&
    ! echo "$output" | grep -q "bymorning-smoke-password\|$cookie_key\|smoke-client-secret"; then
    report "$id" ok "$label: exits $code naming $needle"
  else
    report "$id" fail "$label: running=$running exit=$code output: $(echo "$output" | head -5 | tr '\n' ' ')"
  fi
}
# Installation documents and plugin inventory: the seven production plugins and
# the three documents; nothing development-only. The leg's document must load
# the plugins named in $3 and none of those in $4.
inventory_check() { # id document must-load must-not-load
  packaged=$(node_run --entrypoint sh "$image" -c 'ls /app/node_modules/@bymorning | tr "\n" " "; ls /app/bymorning*.jsonc | tr "\n" " "; ls /app/*.wasm /app/*.data 2>/dev/null | tr "\n" " "')
  want="plugin-atlassian plugin-code-interpreter-agentcore plugin-code-interpreter-kubernetes plugin-context7 plugin-google plugin-share plugin-slack"
  inventory=ok
  for plugin in $want; do case "$packaged" in *"$plugin"*) ;; *) inventory="missing $plugin" ;; esac; done
  case "$packaged" in *plugin-code-interpreter-docker*) inventory="docker Code Interpreter is packaged" ;; esac
  case "$packaged" in *bymorning.docker.jsonc*) inventory="development document is packaged" ;; esac
  case "$packaged" in *.wasm* | *pglite.data*) inventory="PGlite runtime is packaged" ;; esac
  for document in bymorning.jsonc bymorning.cui.jsonc bymorning.azure.jsonc; do
    case "$packaged" in *"/app/$document"*) ;; *) inventory="missing $document" ;; esac
  done
  document=$(node_run --entrypoint cat "$image" "/app/$2")
  for plugin in $3; do echo "$document" | grep -q "$plugin" || inventory="$2 does not load $plugin"; done
  for plugin in $4; do echo "$document" | grep -q "$plugin" && inventory="$2 loads $plugin"; done
  [ "$inventory" = ok ] && report "$1" ok "packaged: $packaged; $2 loads $3 and not $4" \
    || report "$1" fail "inventory=$inventory packaged=$packaged"
}
# The seeded Auth Provider reached the database, and its client secret is stored as ciphertext.
provider_row_check() { # id issuer-needle
  dump=$(docker exec "boot-db-$suffix" pg_dump -U bymorning bymorning 2>/dev/null || true)
  rows=$(printf '%s\n' "$dump" | grep -c "$2" || true)
  plain=$(printf '%s\n' "$dump" | grep -c 'smoke-client-secret' || true)
  [ "${rows:-0}" -ge 1 ] && [ "${plain:-1}" = 0 ] \
    && report "$1" ok "Auth Provider row is in the database and the client secret does not appear in plaintext" \
    || report "$1" fail "provider rows=$rows plaintext occurrences=$plain"
}

# =============================================================================
# AWS leg: an AWS ECS task
# =============================================================================
aws_leg() {
  kms_key="arn:aws:kms:$region:000000000000:key/00000000-0000-4000-8000-000000000000"
  # --- KMS and S3 emulator ---------------------------------------------------
  docker run -d --name "boot-aws-$suffix" --label "bymorning.boot=$suffix" --platform "$platform" --sysctl net.ipv4.ip_unprivileged_port_start=0 --network "$network" \
    --network-alias "kms-fips.$region.amazonaws.com" --network-alias "s3-fips.$region.amazonaws.com" \
    --network-alias "$bucket.s3-fips.$region.amazonaws.com" --network-alias issuer.smoke.test \
    -v "$volume:/smoke:ro" --entrypoint node "$image" /smoke/aws-emulator.mjs /smoke/emulator.key /smoke/emulator.pem "$bucket" "$region" "$kms_key" >/dev/null
  wait_for_log "boot-aws-$suffix" '"emulator":"ready"' "AWS emulator"

  # Environment the AWS task receives plus the emulator boundary. The
  # selectors and AWS_USE_FIPS_ENDPOINT are deployment environment, not image environment.
  cat >"$work/base.env" <<ENV
APP_ORIGIN=$origin
STORAGE_PROVIDER=s3
CIPHER_BACKEND=kms
AWS_USE_FIPS_ENDPOINT=true
STORAGE_BUCKET=$bucket
CODE_INTERPRETER_ID=smoke-interpreter-0000000000
AWS_REGION=$region
CREDENTIAL_KMS_KEY=$kms_key
WEB_COOKIE_KEY=$cookie_key
TRUSTED_PROXIES=172.16.0.0/12
BYMORNING_CONFIG=${SMOKE_CONFIG:-/app/bymorning.cui.jsonc}
AWS_ACCESS_KEY_ID=emulator
AWS_SECRET_ACCESS_KEY=emulator
NODE_EXTRA_CA_CERTS=/smoke/ca.pem
AUTH_PROVIDER=custom
AUTH_ISSUER=https://issuer.smoke.test
AUTH_CLIENT_ID=smoke-client
AUTH_CLIENT_SECRET=smoke-client-secret
AUTH_EMAIL_DOMAINS=smoke.test
ENV

  # --- Failure paths ----------------------------------------------------------
  n=10
  for variable in DATABASE_URL WEB_COOKIE_KEY STORAGE_BUCKET CODE_INTERPRETER_ID AWS_REGION CREDENTIAL_KMS_KEY APP_ORIGIN; do
    n=$((n + 1))
    expect_failure "SMK-$n" "absent $variable" "$variable" "$variable"
  done
  expect_failure SMK-18 "TLS_CERT without TLS_KEY" "TLS_KEY" TLS_KEY
  expect_failure SMK-19 "unreadable BYMORNING_CONFIG" "smoke-missing.jsonc" BYMORNING_CONFIG -e BYMORNING_CONFIG=/app/smoke-missing.jsonc
  expect_failure SMK-20 "malformed WEB_COOKIE_KEY" "SchemaError" WEB_COOKIE_KEY -e WEB_COOKIE_KEY=not-a-32-byte-key
  # The image without its installer's selectors refuses to start; a development-only
  # value is refused naming what the image offers.
  expect_failure SMK-21 "absent STORAGE_PROVIDER" "STORAGE_PROVIDER" STORAGE_PROVIDER
  expect_failure SMK-22 "absent CIPHER_BACKEND" "CIPHER_BACKEND" CIPHER_BACKEND
  expect_failure SMK-23 "development-only STORAGE_PROVIDER=filesystem" "s3, azure-blob" STORAGE_PROVIDER -e STORAGE_PROVIDER=filesystem

  # --- The serving Gateway --------------------------------------------------
  gateway "boot-gateway-$suffix" --network-alias smoke.test
  # The probe runs inside the image on the same network (host curl builds differ in CA handling).
  probe_status=0
  probe=$(node_run -i --network "$network" -v "$volume:/smoke:ro" --entrypoint node "$image" --input-type=module - smoke.test /smoke/gateway.pem \
    <"$root/packages/server/test/fixtures/gateway-probe.mjs" 2>&1) || probe_status=$?
  if [ "$probe_status" != 0 ]; then
    printf '%s\n' "$probe" | tail -20 >&2
    diagnose "the Gateway probe exited $probe_status"
  fi
  # Every expected check must be reported exactly once; a silent or crashed probe fails all of them.
  for id in SMK-30 SMK-32 SMK-33 SMK-34; do
    line=$(printf '%s\n' "$probe" | grep "^$id " || true)
    if [ "$probe_status" = 0 ] && [ "$(printf '%s\n' "$probe" | grep -c "^$id ")" = 1 ]; then
      rest=${line#* }
      report "$id" "${rest%% *}" "${rest#* }"
    else
      report "$id" fail "probe exit $probe_status and did not report $id exactly once"
    fi
  done

  # [SMK-31] The in-task probe the module configures (ecs.tf health_check_script) passes inside the container.
  if docker exec "boot-gateway-$suffix" node -e "require('node:https').get({ host: '127.0.0.1', port: 3210, path: '/system/health', rejectUnauthorized: false }, (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"; then
    report SMK-31 ok "container health probe passes"
  else
    report SMK-31 fail "container health probe failed"
  fi

  # [SMK-35] Inventory; the CUI document loads only AgentCore.
  logs=$(docker logs "boot-gateway-$suffix" 2>&1)
  inventory_check SMK-35 bymorning.cui.jsonc plugin-code-interpreter-agentcore "plugin-share plugin-google"

  # [SMK-36] Credential-at-rest encryption reached KMS through the FIPS endpoint alias; S3 was reached too.
  aws_log=$(docker logs "boot-aws-$suffix" 2>&1)
  echo "$aws_log" | grep -q '"emulator":"kms","op":"GenerateDataKey","allowed":true' \
    && report SMK-36 ok "seeded Auth Provider secret wrapped through KMS GenerateDataKey with the pinned encryption context" \
    || report SMK-36 fail "no permitted KMS GenerateDataKey observed: $(echo "$aws_log" | tail -5 | tr '\n' ' ')"
  echo "$aws_log" | grep -q '"emulator":"s3"' \
    && report SMK-37 ok "S3 storage reached via the FIPS virtual-hosted endpoint" \
    || report SMK-37 fail "the Gateway made no S3 request at boot (no storage traffic observed)"
  ! echo "$aws_log" | grep -q '"allowed":false\|"emulator":"misrouted"' \
    && report SMK-38 ok "every KMS call named the configured key with the pinned encryption context; no request reached an unexpected hostname" \
    || report SMK-38 fail "KMS call with an unexpected key or context, or a misrouted request: $(echo "$aws_log" | grep 'allowed":false\|misrouted' | head -3 | tr '\n' ' ')"

  # [SMK-39] No secret reaches the Gateway log.
  ! echo "$logs" | grep -q "bymorning-smoke-password\|$cookie_key\|smoke-client-secret\|BEGIN PRIVATE KEY" \
    && report SMK-39 ok "startup log carries no database password, cookie key, client secret, or private key" \
    || report SMK-39 fail "a secret appears in the Gateway log"

  # [SMK-40] The seeded Auth Provider is in the database as ciphertext.
  provider_row_check SMK-40 issuer.smoke.test

  not_covered="AgentCore code execution; IAM, KMS key policy, SigV4; VPC endpoints, security groups, ALB; a real RDS certificate chain."
}

# =============================================================================
# Azure leg: the AKS pod (installers/azure/k8s/base) with workload identity
# =============================================================================
azure_leg() {
  blob_host="$account.blob.core.windows.net"
  # --- Azurite (real, OAuth over TLS on 443) and the Entra + Key Vault emulator ---
  echo "azure leg: starting Azurite and the Entra/Key Vault emulator" >&2
  account_key=$(node_run --entrypoint node "$image" -p 'require("node:crypto").randomBytes(32).toString("base64")')
  docker run -d --name "boot-azurite-$suffix" --label "bymorning.boot=$suffix" --network "$network" --network-alias "$blob_host" \
    -v "$volume:/smoke:ro" -e "AZURITE_ACCOUNTS=$account:$account_key" "$azurite" \
    azurite-blob --blobHost 0.0.0.0 --blobPort 443 --location /data --oauth basic --cert /smoke/emulator.pem --key /smoke/emulator.key --skipApiVersionCheck --loose >/dev/null
  docker run -d --name "boot-azure-$suffix" --label "bymorning.boot=$suffix" --platform "$platform" --sysctl net.ipv4.ip_unprivileged_port_start=0 --network "$network" \
    --network-alias login.microsoftonline.com --network-alias "$vault.vault.azure.net" \
    -v "$volume:/smoke:ro" -e TENANT_ID="$tenant" -e CLIENT_ID="$client_id" -e SUBJECT="$wi_subject" -e VAULT_NAME="$vault" -e KEY_NAME="$keyname" \
    --entrypoint node "$image" /smoke/azure-emulator.mjs /smoke/emulator.key /smoke/emulator.pem /smoke/wi.pub >/dev/null
  wait_for_log "boot-azure-$suffix" '"emulator":"ready"' "Azure emulator"
  wait_for_log "boot-azurite-$suffix" "successfully listens" "Azurite"
  # Shared Key requests to Azurite from inside the network (the account key is
  # Terraform's; the Gateway itself only ever holds a bearer token).
  azurite_api() { # method path query -> "<status> <body on one line>"
    node_run --network "$network" -v "$volume:/smoke:ro" -e AZ_ACCOUNT="$account" -e AZ_KEY="$account_key" -e AZ_METHOD="$1" -e AZ_PATH="$2" -e AZ_QUERY="$3" \
      --entrypoint node "$image" --input-type=module -e '
      import { createHmac } from "node:crypto"
      import { readFileSync } from "node:fs"
      import { request } from "node:https"
      const { AZ_ACCOUNT: account, AZ_KEY: key, AZ_METHOD: method, AZ_PATH: path, AZ_QUERY: query } = process.env
      const date = new Date().toUTCString()
      const params = Object.fromEntries(new URLSearchParams(query))
      const resource = `/${account}${path}` + Object.keys(params).sort().map((name) => `\n${name}:${params[name]}`).join("")
      const toSign = [method, "", "", "", "", "", "", "", "", "", "", "", `x-ms-date:${date}\nx-ms-version:2021-08-06\n${resource}`].join("\n")
      const signature = createHmac("sha256", Buffer.from(key, "base64")).update(toSign).digest("base64")
      const req = request({ host: `${account}.blob.core.windows.net`, path: `${path}?${query}`, method, ca: readFileSync("/smoke/ca.pem"),
        headers: { "x-ms-date": date, "x-ms-version": "2021-08-06", authorization: `SharedKey ${account}:${signature}`, "content-length": 0 } }, (res) => {
        const chunks = []
        res.on("data", (chunk) => chunks.push(chunk))
        res.on("end", () => console.log(res.statusCode, Buffer.concat(chunks).toString().replace(/\s+/g, " ")))
      })
      req.setTimeout(20000, () => req.destroy(new Error("timeout")))
      req.on("error", (error) => console.log(0, String(error)))
      req.end()' 2>&1
  }
  echo "azure leg: emulators ready; creating container $container" >&2
  created=$(azurite_api PUT "/$container" restype=container)
  case "$created" in 201*) ;; *) echo "image boot: could not create the Azurite container: $created" >&2; exit 1 ;; esac

  # Environment the AKS pod receives (installers/azure/k8s/base/kustomization.yaml,
  # scripts/create-secret.sh) plus what the workload-identity webhook injects and
  # the emulator boundary. No TLS_CERT/TLS_KEY: ingress terminates TLS.
  cat >"$work/base.env" <<ENV
APP_ORIGIN=$origin
STORAGE_PROVIDER=azure-blob
CIPHER_BACKEND=keyvault
AZURE_CLOUD=AzureCloud
STORAGE_ACCOUNT_URL=https://$blob_host
STORAGE_CONTAINER=$container
KEY_VAULT_KEY=https://$vault.vault.azure.net/keys/$keyname
WEB_COOKIE_KEY=$cookie_key
TRUSTED_PROXIES=10.244.0.0/16
BYMORNING_CONFIG=${SMOKE_CONFIG:-/app/bymorning.azure.jsonc}
AZURE_CLIENT_ID=$client_id
AZURE_TENANT_ID=$tenant
AZURE_FEDERATED_TOKEN_FILE=/smoke/azure-identity-token
AZURE_AUTHORITY_HOST=https://login.microsoftonline.com/
NODE_EXTRA_CA_CERTS=/smoke/ca.pem
AUTH_PROVIDER=microsoft
AUTH_ISSUER=https://login.microsoftonline.com/$tenant/v2.0
AUTH_CLIENT_ID=$idp_client_id
AUTH_CLIENT_SECRET=smoke-client-secret
AUTH_EMAIL_DOMAINS=smoke.test
ENV

  # --- The serving Gateway --------------------------------------------------
  echo "azure leg: starting the Gateway" >&2
  gateway "boot-gateway-$suffix"
  # [SMK-50] Plain-HTTP health, as the pod's startup/readiness probes see it. The
  # Gateway's socket listens before its routes are attached (Storage init, seeding
  # and the other boot steps run in between); a request accepted in that window is
  # never answered. So each probe carries its own timeout, as the pod's probes do,
  # and the whole wait has a deadline (BOOT_WAIT seconds).
  health() {
    docker exec "boot-gateway-$suffix" node -e "
      setTimeout(() => process.exit(1), 10000).unref()
      require('node:http').get({ host: '127.0.0.1', port: 3210, path: '/system/health', timeout: 5000 }, (r) => process.exit(r.statusCode === 200 ? 0 : 1))
        .on('timeout', function () { this.destroy(new Error('timeout')) })
        .on('error', () => process.exit(1))" 2>/dev/null
  }
  started=$(date +%s)
  deadline=$((started + boot_wait))
  until health; do
    [ "$(docker inspect -f '{{.State.Running}}' "boot-gateway-$suffix")" = true ] || break
    [ "$(date +%s)" -lt "$deadline" ] || break
    sleep 1
  done
  if health; then
    report SMK-50 ok "HTTP /system/health -> 200 after $(($(date +%s) - started))s with the Azure selection (azure-blob + keyvault, AzureCloud)"
  else
    report SMK-50 fail "Gateway did not answer /system/health with 200 within ${boot_wait}s (running=$(docker inspect -f '{{.State.Running}}' "boot-gateway-$suffix"))"
    diagnose "the Gateway did not become healthy; stopping the Azure leg"
    exit 1
  fi
  logs=$(docker logs "boot-gateway-$suffix" 2>&1)
  azure_log=$(docker logs "boot-azure-$suffix" 2>&1)
  azurite_log=$(docker logs "boot-azurite-$suffix" 2>&1)

  # [SMK-51] Workload identity: the projected token was exchanged (jwt-bearer client assertion, verified
  # aud/sub/signature) for bearer tokens for both Storage and Key Vault; nothing was refused.
  storage_tokens=$(echo "$azure_log" | grep -c '"op":"token".*"resource":"https://storage.azure.com".*"ok":true' || true)
  vault_tokens=$(echo "$azure_log" | grep -c '"op":"token".*"resource":"https://vault.azure.net".*"ok":true' || true)
  refused=$(echo "$azure_log" | grep -c '"op":"token".*"ok":false' || true)
  [ "${storage_tokens:-0}" -ge 1 ] && [ "${vault_tokens:-0}" -ge 1 ] && [ "${refused:-0}" = 0 ] \
    && report SMK-51 ok "AZURE_FEDERATED_TOKEN_FILE exchanged at login.microsoftonline.com for storage ($storage_tokens) and vault ($vault_tokens) tokens; assertion sub=$wi_subject verified; none refused" \
    || report SMK-51 fail "storage=$storage_tokens vault=$vault_tokens refused=$refused: $(echo "$azure_log" | grep '"op":"token"' | head -3 | tr '\n' ' ')"

  # [SMK-52] Key Vault: the unversioned KEY_VAULT_KEY resolved to the latest version at startup and the
  # seeded Auth Provider secret's data key was wrapped there (RSA-OAEP-256); no failed or misrouted call.
  echo "$azure_log" | grep -q '"op":"getkey".*"by":"latest"' && echo "$azure_log" | grep -q '"op":"wrapkey".*"alg":"RSA-OAEP-256","ok":true' \
    && ! echo "$azure_log" | grep -q '"emulator":"keyvault".*"ok":false\|"emulator":"misrouted"' \
    && report SMK-52 ok "Key Vault challenge answered, latest version resolved, data key wrapped with RSA-OAEP-256 at $vault.vault.azure.net" \
    || report SMK-52 fail "$(echo "$azure_log" | grep '"emulator":"keyvault"\|misrouted' | tail -5 | tr '\n' ' ')"

  # [SMK-53] Blob Storage: the Gateway opened its container at <account>.blob.core.windows.net over TLS
  # with the bearer token (Azurite's access log shows the authenticated 200), and the container is
  # listable through the account key (real Azurite, the Terraform-created container).
  listing=$(azurite_api GET "/$container" "restype=container&comp=list")
  if echo "$azurite_log" | grep -q "/$container?restype=container[^ ]* HTTP/1.1\" 200" && case "$listing" in 200*EnumerationResults*) true ;; *) false ;; esac; then
    report SMK-53 ok "Gateway's bearer-authenticated container request answered 200 by Azurite; container $container lists through Shared Key"
  else
    report SMK-53 fail "azurite log: $(echo "$azurite_log" | grep "$container" | head -3 | tr '\n' ' '); listing: $(echo "$listing" | head -c 200)"
  fi

  # [SMK-54] Inventory; the Azure document loads the collaboration plugins, not an AWS Code Interpreter.
  inventory_check SMK-54 bymorning.azure.jsonc "plugin-google plugin-atlassian plugin-share" plugin-code-interpreter-agentcore

  # [SMK-55] No secret reaches the Gateway log: database password, cookie key, client secret, account
  # key (the Gateway never holds it), the projected token, or a private key.
  wi_token=$(volume_file azure-identity-token)
  ! echo "$logs" | grep -q "bymorning-smoke-password\|$cookie_key\|smoke-client-secret\|$account_key\|$wi_token\|BEGIN PRIVATE KEY" \
    && report SMK-55 ok "startup log carries no database password, cookie key, client secret, account key, projected token, or private key" \
    || report SMK-55 fail "a secret appears in the Gateway log"

  # [SMK-56] The seeded Microsoft Auth Provider is in the database as ciphertext.
  provider_row_check SMK-56 "login.microsoftonline.com/$tenant/v2.0"

  # --- Failure paths: the cloud selector and its endpoint rule -----------------
  expect_failure SMK-57 "absent AZURE_CLOUD" "AZURE_CLOUD" AZURE_CLOUD
  expect_failure SMK-58 "STORAGE_ACCOUNT_URL under another cloud's suffix" "STORAGE_ACCOUNT_URL" STORAGE_ACCOUNT_URL -e "STORAGE_ACCOUNT_URL=https://$account.blob.core.usgovcloudapi.net"

  not_covered="Azure RBAC and Key Vault access policy; a real Flexible Server certificate chain; ingress; a signed-in Blob write through an application feature (installers/azure/test/kind-e2e.sh E2E-08); Kubernetes code execution (kind-e2e.sh E2E-13)."
}

if [ "$leg" = aws ]; then aws_leg; else azure_leg; fi

echo
echo "not covered: $not_covered"
if [ "$failures" -gt 0 ]; then
  echo "image boot: $failures of $checks checks FAILED" >&2
  exit 1
fi
[ "$checks" = "$expected_checks" ] || { echo "image boot: ran $checks checks, expected $expected_checks" >&2; exit 1; }
echo "image boot ($leg): all $checks checks passed ($image, $image_id)"
