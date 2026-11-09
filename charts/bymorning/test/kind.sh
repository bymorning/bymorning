#!/bin/sh
# End-to-end check of the Helm chart on a local kind cluster, with the real signed release image.
#   KIND_INTEGRATION=1 RELEASE_DIR=/path/to/release sh charts/bymorning/test/kind.sh
# The release directory is the full-gate `release` artifact (manifest.json, the Gateway tarball, signer.txt,
# trusted_root.json, and <version>/gateway/). Needs docker (amd64 emulation on arm64 hosts), kind, kubectl,
# helm, jq, curl, openssl, and cosign. Without KIND_INTEGRATION=1 it prints a notice and exits 0.
set -eu

[ "${KIND_INTEGRATION:-}" = 1 ] || { echo "chart kind e2e: skipped (set KIND_INTEGRATION=1 to run)"; exit 0; }
here=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
release=${RELEASE_DIR:?RELEASE_DIR is the release directory}
cluster=bymorning-chart-$$
node_image="kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
postgres_image=${POSTGRES_IMAGE:-postgres:17-alpine}
work=$(mktemp -d)
export KUBECONFIG="$work/kubeconfig"
checks=0
failures=0

report() { # id outcome detail
  checks=$((checks + 1))
  if [ "$2" = ok ]; then printf 'ok   %s %s\n' "$1" "$3"; else printf 'FAIL %s %s\n' "$1" "$3" >&2; failures=$((failures + 1)); fi
}
cleanup() {
  [ -z "${forward:-}" ] || kill "$forward" 2>/dev/null || true
  kind delete cluster --name "$cluster" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

version=$(jq -r .version "$release/manifest.json")
tarball="$release/$(jq -r .artifacts.gateway.tarball "$release/manifest.json")"
digest=$(jq -r .artifacts.gateway.digest "$release/manifest.json")
evidence="$release/$version/gateway"

# 1. The image is the signed release: archive digest, signature against the signer the release pins
# (signer.txt for keyless, offline when trusted_root.json ships; cosign.pub for a gate run's ephemeral key),
# and its SHA256SUMS entry.
if [ -f "$release/signer.txt" ]; then
  signer=$(sed -n 's/^identity: *//p' "$release/signer.txt" | head -1)
  issuer=$(sed -n 's/^issuer: *//p' "$release/signer.txt" | head -1)
  if [ -f "$release/trusted_root.json" ]; then root="--trusted-root $release/trusted_root.json"; else root=""; fi
  # shellcheck disable=SC2086
  verify() { cosign verify-blob --bundle "$2" --certificate-identity "$signer" --certificate-oidc-issuer "$issuer" $root "$1" >/dev/null 2>&1; }
else
  signer="the release key (cosign.pub)"
  verify() { cosign verify-blob --key "$release/cosign.pub" --bundle "$2" "$1" >/dev/null 2>&1; }
fi
found=$(tar -xOf "$tarball" index.json | jq -r '.manifests[0].digest')
if [ "$found" = "$digest" ] && verify "$tarball" "$evidence/$(basename "$tarball").bundle" &&
  grep -q "^$(shasum -a 256 "$tarball" | cut -d' ' -f1)  " "$evidence/SHA256SUMS"; then
  report CHART-01 ok "release $version Gateway $digest matches the manifest and verifies against $signer"
else
  report CHART-01 fail "the Gateway tarball does not match the manifest or does not verify"
  exit 1
fi

# 2. Cluster and image, imported by digest so the pod's digest reference resolves offline.
kind create cluster --name "$cluster" --image "$node_image" --wait 180s >/dev/null
node="$cluster-control-plane"
docker exec -i "$node" ctr -n k8s.io images import --all-platforms --digests --base-name ghcr.io/bymorning/bymorning - <"$tarball" >/dev/null
for extra in $(docker exec "$node" ctr -n k8s.io images ls -q | grep '^ghcr.io/bymorning/bymorning@' | grep -vx "ghcr.io/bymorning/bymorning@$digest"); do
  docker exec "$node" ctr -n k8s.io images rm "$extra" >/dev/null
done
docker exec "$node" ctr -n k8s.io images ls -q | grep -qx "ghcr.io/bymorning/bymorning@$digest" \
  && report CHART-02 ok "image imported into the kind node by digest" || { report CHART-02 fail "image import"; exit 1; }

# 3. A PostgreSQL for the chart to use.
# A registry that throttles the shared CI runners (Docker Hub answers 429) must not fail the run: pull with
# retries on the host, then load the image into the kind node, because the kubelet pulls for itself otherwise.
preload() { # cluster image...
  _cluster=$1; shift
  for _image in "$@"; do
    _try=1
    until docker pull -q "$_image" >/dev/null 2>&1; do
      [ "$_try" -lt 5 ] || { echo "preload: could not pull $_image; the kubelet will try" >&2; continue 2; }
      sleep $((_try * 15)); _try=$((_try + 1))
    done
    # Import only the node's own platform: `kind load` passes --all-platforms, which fails when Docker's
    # containerd image store has pulled one platform of a multi-platform image.
    docker save "$_image" | docker exec -i "$_cluster-control-plane" ctr -n k8s.io images import - >/dev/null 2>&1 \
      || echo "preload: could not load $_image into $_cluster; the kubelet will pull it" >&2
  done
}
preload "$cluster" "$postgres_image"
kubectl apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata: { name: postgres, labels: { app: postgres } }
spec:
  containers:
    - name: postgres
      image: $postgres_image
      env:
        - { name: POSTGRES_USER, value: bymorning }
        - { name: POSTGRES_PASSWORD, value: bymorning }
        - { name: POSTGRES_DB, value: bymorning }
      readinessProbe: { exec: { command: ["pg_isready", "-U", "bymorning"] }, periodSeconds: 2 }
---
apiVersion: v1
kind: Service
metadata: { name: postgres }
spec: { selector: { app: postgres }, ports: [{ port: 5432 }] }
YAML
kubectl wait --for=condition=Ready pod/postgres --timeout=180s >/dev/null

# 4. Install the chart as an evaluation installation with the real digest.
key() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '='; }
install() { # extra helm args...
  helm upgrade --install bymorning "$here" -f "$here/ci/evaluation-values.yaml" \
    --set image.digest="$digest" --set secrets.WEB_COOKIE_KEY="$cookie" --set secrets.CIPHER_KEY="$cipher" \
    --wait --timeout 10m "$@" >/dev/null
}
cookie=$(key)
cipher=$(key)
if install; then
  report CHART-03 ok "helm install --wait completed: migrate ran, then the Gateway became ready"
else
  kubectl get pods -o wide >&2 || true
  kubectl logs deploy/bymorning --all-containers --tail=40 >&2 || true
  report CHART-03 fail "helm install failed"
  exit 1
fi

pod() { kubectl get pod -l app.kubernetes.io/name=bymorning -o jsonpath='{.items[0].metadata.name}'; }
running=$(kubectl get pod "$(pod)" -o jsonpath='{.status.containerStatuses[0].imageID}')
case "$running" in *"$digest") report CHART-04 ok "the pod runs the release digest" ;; *) report CHART-04 fail "pod runs $running, expected $digest" ;; esac

migrate_code=$(kubectl get pod "$(pod)" -o jsonpath='{.status.initContainerStatuses[0].state.terminated.exitCode}')
[ "$migrate_code" = 0 ] && report CHART-05 ok "the migrate init container exited 0" || report CHART-05 fail "migrate exit code $migrate_code"

log=$(kubectl logs "$(pod)" -c gateway)
if echo "$log" | grep -q "Host resolved" && echo "$log" | grep -q "mode=evaluation" && echo "$log" | grep -q "storage=filesystem" &&
  echo "$log" | grep -q "evaluation installation, not a production one" && ! echo "$log" | grep -q "$cipher"; then
  report CHART-06 ok "startup logged storage=filesystem, mode=evaluation, and the warning, and did not log CIPHER_KEY"
else
  report CHART-06 fail "unexpected startup log: $(echo "$log" | tail -5 | tr '\n' ' ')"
fi

# 5. Reach it through the Service.
kubectl port-forward --address 127.0.0.1 svc/bymorning 3210:80 >"$work/forward.log" 2>&1 &
forward=$!
attempt=0
until [ "$(curl -s --max-time 5 http://127.0.0.1:3210/system/health 2>/dev/null || true)" = ok ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -le 30 ] || break
  sleep 1
done
health=$(curl -s --max-time 5 http://127.0.0.1:3210/system/health || true)
method=$(curl -s --max-time 5 http://127.0.0.1:3210/auth/method | jq -c '{state,local}' 2>/dev/null || true)
if [ "$health" = ok ] && [ "$method" = '{"state":"ready","local":true}' ]; then
  report CHART-07 ok "/system/health is ok and Local Login is offered through the Service"
else
  cat "$work/forward.log" >&2 || true
  report CHART-07 fail "health='$health' method='$method'"
fi

# 6. The pod's own hardening, as the cluster sees it.
sc=$(kubectl get pod "$(pod)" -o json | jq -c '[.spec.containers[0].securityContext.readOnlyRootFilesystem, .spec.containers[0].securityContext.allowPrivilegeEscalation, .spec.securityContext.runAsUser, .spec.automountServiceAccountToken]')
[ "$sc" = '[true,false,65532,false]' ] && report CHART-08 ok "read-only root, no privilege escalation, uid 65532, no service account token" || report CHART-08 fail "securityContext $sc"

# 7. A config change rolls the pod (Recreate: never two at once) and the data volume survives.
kubectl exec "$(pod)" -- sh -c 'echo kept >/data/chart-check' >/dev/null
before=$(pod)
if install --set config.LOGIN_BANNER="chart test"; then
  after=$(pod)
  count=$(kubectl get pod -l app.kubernetes.io/name=bymorning --no-headers | wc -l | tr -d ' ')
  kept=$(kubectl exec "$after" -- cat /data/chart-check 2>/dev/null || true)
  if [ "$before" != "$after" ] && [ "$count" = 1 ] && [ "$kept" = kept ]; then
    report CHART-09 ok "a config change replaced the pod (one pod, no overlap) and the data volume kept its file"
  else
    report CHART-09 fail "before=$before after=$after pods=$count kept='$kept'"
  fi
else
  report CHART-09 fail "helm upgrade failed"
fi

# 8. Uninstall removes what the chart made (the evaluation data volume goes with it).
helm uninstall bymorning --wait >/dev/null
left=$(kubectl get all,cm,secret,pvc,sa,ingress -l app.kubernetes.io/instance=bymorning --no-headers 2>/dev/null | wc -l | tr -d ' ')
[ "$left" = 0 ] && report CHART-10 ok "helm uninstall left nothing behind" || report CHART-10 fail "$left objects left"

[ "$failures" = 0 ] || { echo "chart kind e2e: $failures of $checks checks failed" >&2; exit 1; }
echo "chart kind e2e: all $checks checks passed"
