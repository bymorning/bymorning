#!/bin/sh
# Offline checks for the Helm chart. No cluster, no cloud. Needs helm, kubeconform, and bun.
#   sh charts/bymorning/test.sh
set -eu

here=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
digest=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

echo "== the chart tracks the release version"
root=$(CDPATH='' cd -- "$here/../.." && pwd)
release=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/package.json" | head -1)
chart=$(sed -n 's/^version: *//p' "$here/Chart.yaml")
app=$(sed -n 's/^appVersion: *"\(.*\)"$/\1/p' "$here/Chart.yaml")
[ "$release" = "$chart" ] && [ "$release" = "$app" ] || { echo "FAIL: package.json is $release but Chart.yaml is version $chart, appVersion $app; bump them together" >&2; exit 1; }
grep -q "image: ghcr.io/bymorning/bymorning:$release\$" "$here/Chart.yaml" || { echo "FAIL: the Artifact Hub image annotation in Chart.yaml is not $release" >&2; exit 1; }

echo "== helm lint"
helm lint "$here" -f "$here/ci/production-values.yaml"
helm lint "$here" -f "$here/ci/evaluation-values.yaml"

echo "== render, schema, policy"
helm template x "$here" -f "$here/ci/production-values.yaml" >"$scratch/production.yaml"
helm template x "$here" -f "$here/ci/evaluation-values.yaml" >"$scratch/evaluation.yaml"
kubeconform -strict -summary -kubernetes-version 1.31.0 "$scratch/production.yaml" "$scratch/evaluation.yaml"
bun "$here/test/policy-check.ts" <"$scratch/production.yaml"
bun "$here/test/policy-check.ts" --evaluation <"$scratch/evaluation.yaml"

echo "== guards refuse an unsafe or incomplete install"
refuse() { # label expected-text helm-args...
  label=$1 text=$2
  shift 2
  if output=$(helm template x "$here" "$@" 2>&1); then
    echo "FAIL: $label rendered" >&2
    exit 1
  fi
  printf '%s' "$output" | grep -q "$text" || { echo "FAIL: $label: wanted '$text' in: $output" >&2; exit 1; }
  echo "   refused: $label"
}
production="-f $here/ci/production-values.yaml"
# shellcheck disable=SC2086
{
  refuse "no appOrigin" "appOrigin is required" --set image.digest=$digest
  refuse "no digest" "image.digest is required" --set appOrigin=https://b.example.com --set existingSecret=s --set config.STORAGE_PROVIDER=s3
  refuse "a tag, not a digest" "image.digest is required" $production --set image.digest=latest
  refuse "http origin in production" "must be an https origin" $production --set appOrigin=http://b.example.com
  refuse "no backends" "STORAGE_PROVIDER" --set image.digest=$digest --set appOrigin=https://b.example.com --set existingSecret=s
  refuse "no secrets" "provide secrets" --set image.digest=$digest --set appOrigin=https://b.example.com --set config.STORAGE_PROVIDER=s3
  refuse "listener TLS without a Secret" "tls.secretName is required" $production --set tls.enabled=true
  refuse "ingress without a host" "ingress.host is required" $production --set ingress.host=
}

echo "== listener TLS switches the probes and the ingress backend to HTTPS"
helm template x "$here" -f "$here/ci/production-values.yaml" --set tls.enabled=true --set tls.secretName=t >"$scratch/tls.yaml"
grep -q 'scheme: HTTPS' "$scratch/tls.yaml"
grep -q 'backend-protocol: HTTPS' "$scratch/tls.yaml"
grep -q 'key: tls.key' "$scratch/tls.yaml"

echo "chart: offline checks passed"
