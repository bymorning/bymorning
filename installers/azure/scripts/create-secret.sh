#!/bin/sh
# Creates (or updates) the Kubernetes Secret "bymorning" from Terraform outputs.
# Values are staged in a private temp directory (mode 700) removed on exit; they never appear on the command line.
#
# Usage:
#   sh create-secret.sh <terraform-root-dir> <postgres-ca.pem> [--namespace bymorning] \
#      [--bedrock-api-key-file <file>] [--dry-run]
#
# Optional extras go in the same Secret by adding files named on the command line:
#   --extra KEY=<file>     value read from a file (e.g. AUTH_CLIENT_SECRET=./client-secret.txt)
#   --literal KEY=VALUE    non-secret value on the command line (e.g. AUTH_PROVIDER=microsoft)
#
# Requires terraform, kubectl, jq. Terraform state holds these values; the Secret
# is a copy inside the cluster. Prefer the Key Vault CSI driver (see README) if your
# policy forbids Kubernetes Secrets.
set -eu

[ $# -ge 2 ] || { sed -n '2,15p' "$0" >&2; exit 2; }
root=$1
ca=$2
shift 2
namespace=bymorning
bedrock=""
dry=""
extras=""
literals=""
while [ $# -gt 0 ]; do
  case $1 in
    --namespace) namespace=$2; shift 2 ;;
    --bedrock-api-key-file) bedrock=$2; shift 2 ;;
    --extra) extras="$extras $2"; shift 2 ;;
    --literal) literals="$literals $2"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -r "$ca" ] || { echo "cannot read CA bundle $ca" >&2; exit 1; }
grep -q 'BEGIN CERTIFICATE' "$ca" || { echo "$ca is not a PEM certificate bundle" >&2; exit 1; }

url=$(terraform -chdir="$root" output -raw database_url)
cookie=$(terraform -chdir="$root" output -raw web_cookie_key)

apply() {
  if [ -n "$dry" ]; then kubectl create secret generic "$@" --namespace "$namespace" --dry-run=client -o name
  else kubectl create secret generic "$@" --namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f - ; fi
}

# Stage values as files (kubectl --from-file keeps them off the command line).
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
chmod 700 "$tmp"
umask 077
printf '%s' "$url" > "$tmp/DATABASE_URL"
printf '%s' "$cookie" > "$tmp/WEB_COOKIE_KEY"
cp "$ca" "$tmp/DATABASE_CA"
set -- bymorning --from-file="$tmp/DATABASE_URL" --from-file="$tmp/WEB_COOKIE_KEY" --from-file="$tmp/DATABASE_CA"
for e in $extras; do
  k=${e%%=*}
  f=${e#*=}
  [ -r "$f" ] || { echo "cannot read $f" >&2; exit 1; }
  cp "$f" "$tmp/$k"
  set -- "$@" --from-file="$tmp/$k"
done
for e in $literals; do
  k=${e%%=*}
  printf '%s' "${e#*=}" > "$tmp/$k"
  set -- "$@" --from-file="$tmp/$k"
done
apply "$@"
if [ -n "$bedrock" ]; then
  [ -r "$bedrock" ] || { echo "cannot read $bedrock" >&2; exit 1; }
  cp "$bedrock" "$tmp/AWS_BEARER_TOKEN_BEDROCK"
  apply bymorning-bedrock --from-file="$tmp/AWS_BEARER_TOKEN_BEDROCK"
fi
rm -rf "$tmp"
echo "secret bymorning applied to namespace $namespace"
