#!/bin/sh
# End-to-end verification of the Azure Government release candidate on a local kind cluster,
# using the EXACT built artifacts and the installer's own manifests. No cloud, no Azure account.
#
#   KIND_INTEGRATION=1 RELEASE_DIR=/path/to/release sh installers/azure/test/kind-e2e.sh
#
# Needs: docker (amd64 emulation on arm64 hosts), kind >= 0.33, kubectl, jq, openssl, bun, cosign.
# Without KIND_INTEGRATION=1 it prints a notice and exits 0 (gate shared with the other kind tests).
#   RELEASE_DIR   directory with manifest.json (script/release.ts), cosign.pub, both tarballs, and the
#                 evidence folders the manifest names (<version>/gateway/ and <version>/execution/,
#                 holding the .bundle signatures and SHA256SUMS). Default: <repo>/release.
#   KIND_CLUSTER  cluster name (default bymorning-azure-e2e); the script refuses to reuse one.
#   KIND_KEEP=1   keep the cluster (and work directory) afterwards.
#   POSTGRES_IMAGE, AZURITE_IMAGE   images the node pulls for the emulator boundary.
#   E2E_SANDBOX_CPU   sandbox pod CPU request/limit override for small nodes (default: the installer's 1).
#
# WHAT IS REAL: the two release tarballs (digests and cosign signatures verified before they are
# loaded, imported into the node by digest), scripts/overlay.sh and scripts/create-secret.sh, the
# installer's k8s base and components, plugins/code-interpreter-kubernetes/deploy, restricted Pod
# Security Admission, kindnet NetworkPolicy enforcement, the AKS-style projected token, the generated
# SDK, PostgreSQL 17 over TLS, Azurite with OAuth over TLS, real RSA key wrapping.
#
# EMULATOR BOUNDARY (clearly not Azure or AWS; see e2e/emulators.mjs and e2e/boundary.yaml):
#   Entra ID token endpoint and OIDC issuer at login.microsoftonline.us, Key Vault at
#   <vault>.vault.usgovcloudapi.net, AWS STS and Bedrock ConverseStream. They verify the projected
#   service account token against the cluster's own JWKS, but not Azure RBAC, Key Vault access
#   policy, IAM, SigV4 signatures or private endpoints. Hostnames reach them through CoreDNS
#   rewrites and a throwaway CA (NODE_EXTRA_CA_CERTS); the workload identity webhook (absent on
#   kind) is reproduced by e2e/overlay.yaml.tmpl. Bedrock uses us-east-1, NOT a GovCloud region.
#   Terraform is replaced by a shim that returns the two sensitive outputs create-secret.sh reads.
set -eu

here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
installer=$(dirname "$here")
root=$(CDPATH= cd -- "$installer/../.." && pwd)
[ "${KIND_INTEGRATION:-}" = 1 ] || { echo "azure kind e2e: skipped (set KIND_INTEGRATION=1 to run)"; exit 0; }

release=${RELEASE_DIR:-$root/release}
cluster=${KIND_CLUSTER:-bymorning-azure-e2e}
postgres_image=${POSTGRES_IMAGE:-postgres:17-alpine}
azurite_image=${AZURITE_IMAGE:-mcr.microsoft.com/azure-storage/azurite:3.35.0}
node_image="kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
work=$(mktemp -d)
export KUBECONFIG="$work/kubeconfig"
node="$cluster-control-plane"
overlay_name=kind-e2e
overlays="$installer/k8s/overlays"

failures=0
checks=0
report() { # id outcome detail
  checks=$((checks + 1))
  case $2 in
    ok) printf 'ok   %s %s\n' "$1" "$3" ;;
    skip) printf 'SKIP %s %s\n' "$1" "$3" ;;
    *) printf 'FAIL %s %s\n' "$1" "$3" >&2; failures=$((failures + 1)) ;;
  esac
}
die() { echo "azure kind e2e: $1" >&2; exit 1; }

cleanup() {
  status=$?
  rm -rf "$overlays/$overlay_name" "$overlays/$overlay_name-boundary"
  if [ "${KIND_KEEP:-}" = 1 ]; then
    echo "kept cluster $cluster (KUBECONFIG=$KUBECONFIG, work=$work)"
  else
    kind delete cluster --name "$cluster" >/dev/null 2>&1 || true
    rm -rf "$work"
  fi
  exit "$status"
}
trap cleanup EXIT

for tool in docker kind kubectl jq openssl bun cosign; do command -v "$tool" >/dev/null || die "$tool is required"; done
kind get clusters 2>/dev/null | grep -qx "$cluster" && die "kind cluster $cluster already exists; delete it or set KIND_CLUSTER"

# ---------------------------------------------------------------------------------------------
# 1. The artifacts: digest and signature, before anything is loaded.
# ---------------------------------------------------------------------------------------------
manifest="$release/manifest.json"
[ -f "$manifest" ] && [ -f "$release/cosign.pub" ] || die "$release lacks manifest.json or cosign.pub"
field() { jq -er "$1" "$manifest" || die "manifest.json lacks $1"; }
version=$(field .version)
gateway_commit=$(field .commit)
gateway_tar="$release/$(field .artifacts.gateway.tarball)"
gateway_digest=$(field .artifacts.gateway.digest)
gateway_evidence="$release/$(field .artifacts.gateway.evidence)"
execution_tar="$release/$(field .artifacts.execution.tarball)"
execution_digest=$(field .artifacts.execution.digest)
execution_evidence="$release/$(field .artifacts.execution.evidence)"
[ -f "$gateway_tar" ] && [ -f "$execution_tar" ] || die "a release tarball named in the manifest is missing"

verify_tarball() { # tarball digest bundle label
  index=$(tar -xOf "$1" index.json) || return 1
  count=$(printf '%s' "$index" | jq '.manifests | length')
  found=$(printf '%s' "$index" | jq -r '.manifests[0].digest')
  platform=$(printf '%s' "$index" | jq -r '.manifests[0].platform | "\(.os)/\(.architecture)"')
  [ "$count" = 1 ] && [ "$found" = "$2" ] || { echo "$4: archive holds $found ($count manifests), record says $2" >&2; return 1; }
  cosign verify-blob --key "$release/cosign.pub" --bundle "$3" "$1" >/dev/null 2>&1 || { echo "$4: cosign signature invalid" >&2; return 1; }
  cosign verify-blob --key "$release/cosign.pub" --bundle "$(dirname "$3")/SHA256SUMS.bundle" "$(dirname "$3")/SHA256SUMS" >/dev/null 2>&1 || { echo "$4: SHA256SUMS signature invalid" >&2; return 1; }
  sum=$(shasum -a 256 "$1" | cut -d' ' -f1)
  grep -q "^$sum  " "$(dirname "$3")/SHA256SUMS" || { echo "$4: tarball sha256 is not in the signed SHA256SUMS" >&2; return 1; }
  echo "$found $platform"
}
if g=$(verify_tarball "$gateway_tar" "$gateway_digest" "$gateway_evidence/$(basename "$gateway_tar").bundle" gateway) &&
  x=$(verify_tarball "$execution_tar" "$execution_digest" "$execution_evidence/$(basename "$execution_tar").bundle" execution); then
  report E2E-01 ok "release $version: gateway $g and execution $x match the recorded digests and verify with cosign (tarball bundle + SHA256SUMS bundle) before load"
else
  report E2E-01 fail "artifact verification failed"
  exit 1
fi

# ---------------------------------------------------------------------------------------------
# 2. Cluster and images (imported by digest, not rebuilt).
# ---------------------------------------------------------------------------------------------
kind create cluster --name "$cluster" --image "$node_image" --wait 180s >/dev/null
kind get kubeconfig --name "$cluster" >"$KUBECONFIG"
gateway_image="registry.test/bymorning@$gateway_digest"
execution_image="registry.test/bymorning-code-interpreter@$execution_digest"
import() { # tarball base-name digest
  # kind's own loader names the imported image `import-<date>@<digest>`, which CRI cannot resolve;
  # importing with a base name makes the digest reference the manifests use resolvable offline.
  docker exec -i "$node" ctr -n k8s.io images import --all-platforms --digests --base-name "$2" - <"$1" >/dev/null
  # The import also records the archive's index digest as `<base>@<index digest>`; CRI then reports
  # whichever reference it lists first as the pod's imageID. Keep only the manifest digest so the
  # digest the pod runs (E2E-03) is the one the release records.
  for extra in $(docker exec "$node" ctr -n k8s.io images ls -q | grep "^$2@" | grep -vx "$2@$3"); do
    docker exec "$node" ctr -n k8s.io images rm "$extra" >/dev/null
  done
  docker exec "$node" ctr -n k8s.io images ls -q | grep -qx "$2@$3"
}
import "$gateway_tar" registry.test/bymorning "$gateway_digest" && import "$execution_tar" registry.test/bymorning-code-interpreter "$execution_digest" \
  && report E2E-02 ok "both images imported into the kind node by digest ($gateway_image, $execution_image)" \
  || { report E2E-02 fail "image import"; exit 1; }
for image in "$postgres_image" "$azurite_image"; do docker pull -q "$image" >/dev/null 2>&1 || true; done

# ---------------------------------------------------------------------------------------------
# 3. Values, throwaway PKI, emulator boundary.
# ---------------------------------------------------------------------------------------------
rand() { openssl rand -hex "$1"; }
tenant=$(uuidgen | tr 'A-Z' 'a-z')
client_id=$(uuidgen | tr 'A-Z' 'a-z')
idp_client_id=$(uuidgen | tr 'A-Z' 'a-z')
idp_client_secret=$(rand 24)
db_password=$(rand 16)
account=bymorningacct
account_key=$(openssl rand -base64 32)
vault=bymorning-kv
keyname=bymorning-cipher
container=bymorning
aws_region=us-east-1
role_arn=arn:aws:iam::123456789012:role/bymorning-e2e
static_key=AKIAE2ESTATICKEY00
static_secret=$(rand 20)
db_host=bymorning-e2e.postgres.database.usgovcloudapi.net
host=bymorning.e2e.test
cookie_key=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
email_domain=example.test

pki="$work/pki"
mkdir -p "$pki"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout "$pki/ca.key" -out "$pki/ca.pem" -days 2 -nodes -subj "/CN=azure-e2e-throwaway-ca" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign" 2>/dev/null
leaf() { # name san
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout "$pki/$1.key" -out "$pki/$1.csr" -nodes -subj "/CN=$1" 2>/dev/null
  printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' "$2" >"$pki/$1.ext"
  openssl x509 -req -in "$pki/$1.csr" -CA "$pki/ca.pem" -CAkey "$pki/ca.key" -CAcreateserial -out "$pki/$1.pem" -days 2 -extfile "$pki/$1.ext" 2>/dev/null
}
leaf emulator "DNS:login.microsoftonline.us,DNS:$vault.vault.usgovcloudapi.net,DNS:$account.blob.core.usgovcloudapi.net,DNS:sts.$aws_region.amazonaws.com,DNS:sts.amazonaws.com,DNS:bedrock-runtime.$aws_region.amazonaws.com,DNS:localhost,IP:127.0.0.1"
leaf postgres "DNS:$db_host,DNS:localhost"

boundary=azure-e2e-boundary
kubectl create namespace "$boundary" >/dev/null
kubectl -n "$boundary" create secret generic emulator-tls --from-file=tls.crt="$pki/emulator.pem" --from-file=tls.key="$pki/emulator.key" >/dev/null
kubectl -n "$boundary" create secret generic postgres-tls --from-file=tls.crt="$pki/postgres.pem" --from-file=tls.key="$pki/postgres.key" >/dev/null
kubectl -n "$boundary" create configmap emulator-script --from-file=emulators.mjs="$here/e2e/emulators.mjs" >/dev/null
sed -e "s#@POSTGRES_IMAGE@#$postgres_image#" -e "s#@AZURITE_IMAGE@#$azurite_image#" -e "s#@GATEWAY_IMAGE@#$gateway_image#" \
  -e "s#@DB_PASSWORD@#$db_password#" -e "s#@ACCOUNT@#$account#g" -e "s#@ACCOUNT_KEY@#$account_key#" -e "s#@TENANT@#$tenant#" \
  -e "s#@CLIENT_ID@#$client_id#" -e "s#@VAULT@#$vault#" -e "s#@KEY@#$keyname#" -e "s#@ROLE_ARN@#$role_arn#" -e "s#@AWS_REGION@#$aws_region#" \
  -e "s#@IDP_CLIENT_ID@#$idp_client_id#" -e "s#@IDP_CLIENT_SECRET@#$idp_client_secret#" -e "s#@STATIC_AWS_KEY@#$static_key#" \
  "$here/e2e/boundary.yaml" | kubectl apply -f - >/dev/null

# Real hostnames resolve to the boundary services (CoreDNS rewrite; answers keep the original name).
rewrites=""
for pair in "login.microsoftonline.us emulators" "$vault.vault.usgovcloudapi.net emulators" "sts.$aws_region.amazonaws.com emulators" \
  "sts.amazonaws.com emulators" "bedrock-runtime.$aws_region.amazonaws.com emulators" "$account.blob.core.usgovcloudapi.net azurite" "$db_host postgres"; do
  set -- $pair
  rewrites="$rewrites    rewrite name exact $1 $2.$boundary.svc.cluster.local\n"
done
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | awk -v add="$rewrites" '{print} /^\.:53 \{/ {printf "%s", add}' >"$work/Corefile"
kubectl -n kube-system create configmap coredns --from-file=Corefile="$work/Corefile" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n kube-system rollout restart deployment coredns >/dev/null
kubectl -n kube-system rollout status deployment coredns --timeout=120s >/dev/null
for name in postgres azurite emulators; do kubectl -n "$boundary" rollout status "deployment/$name" --timeout=300s >/dev/null || { kubectl -n "$boundary" describe pod -l app=$name | tail -20 >&2; die "$name did not become ready"; }; done

# ---------------------------------------------------------------------------------------------
# 4. Installer path: Terraform outputs (shim) -> create-secret.sh -> overlay.sh -> kubectl apply -k.
# ---------------------------------------------------------------------------------------------
export E2E_TENANT=$tenant E2E_CLIENT_ID=$client_id E2E_IDP_CLIENT_ID=$idp_client_id E2E_IDP_CLIENT_SECRET=$idp_client_secret
export E2E_DB_PASSWORD=$db_password E2E_ACCOUNT=$account E2E_ACCOUNT_KEY=$account_key E2E_CONTAINER=$container E2E_VAULT=$vault E2E_KEY=$keyname
export E2E_AWS_REGION=$aws_region E2E_ROLE_ARN=$role_arn E2E_STATIC_KEY=$static_key E2E_STATIC_SECRET=$static_secret E2E_HOST=$host
export E2E_COOKIE_KEY=$cookie_key E2E_DOMAIN=$email_domain E2E_CA="$pki/ca.pem" E2E_BOUNDARY=$boundary E2E_CLUSTER=$cluster
export E2E_GATEWAY_IMAGE=$gateway_image E2E_GATEWAY_DIGEST=$gateway_digest E2E_EXECUTION_DIGEST=$execution_digest E2E_POSTGRES_HOST=$db_host
export NODE_EXTRA_CA_CERTS="$pki/ca.pem"
export E2E_RELEASE_VERSION=$version E2E_GATEWAY_COMMIT=$gateway_commit E2E_WORK=$work

mkdir -p "$work/bin" "$work/tf-root"
cat >"$work/bin/terraform" <<'SHIM'
#!/bin/sh
# Stand-in for `terraform -chdir=<root> output -raw <name>`: only the sensitive outputs create-secret.sh reads.
[ "$2" = output ] && [ "$3" = -raw ] || { echo "terraform shim: unsupported: $*" >&2; exit 2; }
case $4 in
  database_url) printf 'postgresql://bymorning:%s@%s:5432/bymorning' "$E2E_DB_PASSWORD" "$E2E_POSTGRES_HOST" ;;
  web_cookie_key) printf '%s' "$E2E_COOKIE_KEY" ;;
  *) echo "terraform shim: unknown output $4" >&2; exit 1 ;;
esac
SHIM
chmod +x "$work/bin/terraform"

jq -n --arg client "$client_id" --arg tenant "$tenant" --arg account "https://$account.blob.core.usgovcloudapi.net" \
  --arg container "$container" --arg key "https://$vault.vault.usgovcloudapi.net/keys/$keyname" '{
  gateway_client_id: {value: $client}, tenant_id: {value: $tenant}, azure_cloud: {value: "AzureUSGovernment"},
  storage_account_url: {value: $account}, storage_container: {value: $container}, key_vault_key: {value: $key}}' >"$work/outputs.json"

kubectl apply -f "$installer/k8s/base/namespace.yaml" >/dev/null
printf '%s' "$idp_client_secret" >"$work/idp-client-secret"
PATH="$work/bin:$PATH" sh "$installer/scripts/create-secret.sh" "$work/tf-root" "$pki/ca.pem" \
  --literal AUTH_PROVIDER=microsoft --literal "AUTH_ISSUER=https://login.microsoftonline.us/$tenant/v2.0" \
  --literal "AUTH_CLIENT_ID=$idp_client_id" --literal "AUTH_EMAIL_DOMAINS=$email_domain" --extra "AUTH_CLIENT_SECRET=$work/idp-client-secret" >/dev/null
sh "$installer/scripts/overlay.sh" "$work/outputs.json" "$overlay_name" --host "$host" --image "$gateway_image" \
  --aws-role-arn "$role_arn" --aws-region "$aws_region" --component bedrock-web-identity --component code-interpreter-kubernetes >/dev/null

# Boundary overlay on top of the generated one; the execution digest is the README's operator edit.
b="$overlays/$overlay_name-boundary"
mkdir -p "$b"
sed -e "s#@CLIENT_ID@#$client_id#" -e "s#@TENANT@#$tenant#" "$here/e2e/overlay.yaml.tmpl" >"$b/kustomization.yaml"
cp "$pki/ca.pem" "$b/ca.pem"
# E2E_SANDBOX_CPU lowers the sandbox pod's CPU request (the installer default
# is 1) so a 2-vCPU kind node, with the Gateway and system pods already on it,
# can still schedule the execution pod; the full-gate workflow sets 250m.
sed -e "s#REGISTRY.azurecr.us/bymorning-code-interpreter@sha256:REPLACE#$execution_image#" \
  -e "s#\"serviceAccountName\": \"bymorning-sandbox\",#\"serviceAccountName\": \"bymorning-sandbox\",${E2E_SANDBOX_CPU:+ \"cpu\": \"$E2E_SANDBOX_CPU\",}#" \
  "$installer/k8s/components/code-interpreter-kubernetes/config/bymorning.jsonc" >"$b/bymorning.jsonc"
grep -q "$execution_image" "$b/bymorning.jsonc" || die "execution image placeholder not replaced"
[ -z "${E2E_SANDBOX_CPU:-}" ] || grep -q "\"cpu\": \"$E2E_SANDBOX_CPU\"" "$b/bymorning.jsonc" || die "sandbox cpu override not applied"
kubectl kustomize "$b" >"$work/rendered.yaml"
kubectl apply -k "$installer/../../plugins/code-interpreter-kubernetes/deploy" >/dev/null
export E2E_RENDERED="$work/rendered.yaml"

# The container is Terraform's azurerm_storage_container in a real deployment.
bun "$here/e2e/driver.ts" prepare
kubectl apply -f "$work/rendered.yaml" >/dev/null
wait_gateway() { # fail fast on a crashing init container or gateway instead of waiting out the rollout
  attempt=0
  while :; do
    ready=$(kubectl -n bymorning get deploy bymorning -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)
    [ "${ready:-0}" = 1 ] && return 0
    restarts=$(kubectl -n bymorning get pods -l app.kubernetes.io/name=bymorning -o json | jq '[.items[].status | ((.initContainerStatuses // []) + (.containerStatuses // []))[] | .restartCount] | max // 0')
    attempt=$((attempt + 1))
    if [ "$restarts" -ge 2 ] || [ "$attempt" -gt 200 ]; then
      kubectl -n bymorning get pods >&2
      kubectl -n bymorning describe pod -l app.kubernetes.io/name=bymorning | tail -25 >&2
      kubectl -n bymorning logs deploy/bymorning -c migrate --tail=40 >&2 || true
      kubectl -n bymorning logs deploy/bymorning -c gateway --tail=40 >&2 || true
      return 1
    fi
    sleep 3
  done
}
wait_gateway || die "Gateway did not become ready"

# ---------------------------------------------------------------------------------------------
# 5. Checks (driver prints one numbered line per check).
# ---------------------------------------------------------------------------------------------
env | grep -E '^(E2E_|NODE_EXTRA_CA_CERTS=)' | sed 's/^/export /; s/=\(.*\)$/="\1"/' >"$work/driver.env"
set +e
bun "$here/e2e/driver.ts" verify
status=$?
set -e
[ "$status" = 0 ] || failures=$((failures + 1))
if [ "$failures" -gt 0 ]; then
  echo "azure kind e2e: FAILED" >&2
  exit 1
fi
echo "azure kind e2e: all checks passed ($version, gateway $gateway_digest)"
