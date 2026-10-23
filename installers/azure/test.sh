#!/bin/sh
# Offline checks for the Azure installer. No Azure credentials, no cluster.
#   sh installers/azure/test.sh
# Requires terraform, kubectl (for `kubectl kustomize`), kubeconform, jq, and bun.
set -eu

here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
k8s="$here/k8s"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch" "$k8s"/overlays/test-*' EXIT

echo "== terraform fmt"
terraform -chdir="$here" fmt -check -recursive

echo "== terraform validate (module + root)"
for dir in modules/bymorning environments/example; do
  terraform -chdir="$here/$dir" init -backend=false -input=false >/dev/null
  terraform -chdir="$here/$dir" validate
done

echo "== terraform test (mock azurerm)"
terraform -chdir="$here/modules/bymorning" test

echo "== shell syntax"
for f in "$here"/smoke.sh "$here"/scripts/*.sh "$here"/release/mirror.sh "$here"/test.sh "$here"/test/kind-e2e.sh; do sh -n "$f"; done
node --check "$here/test/e2e/emulators.mjs"

render() { # <overlay dir name>
  kubectl kustomize "$k8s/overlays/$1"
}
check() { # <label> <overlay dir name>
  render "$2" > "$scratch/$2.yaml"
  kubeconform -strict -summary -kubernetes-version 1.31.0 "$scratch/$2.yaml"
  bun "$here/test/policy-check.ts" < "$scratch/$2.yaml"
  echo "   ($1)"
}

echo "== kustomize + kubeconform + policy"
kubectl kustomize "$k8s/base" > "$scratch/base.yaml"
kubeconform -strict -summary -kubernetes-version 1.31.0 "$scratch/base.yaml"
check "example overlay" example
grep -q 'image: acrbymorning1a2b3.azurecr.us/bymorning:azure$' "$scratch/example.yaml"
sh "$here/scripts/overlay.sh" "$here/test/outputs.sample.json" test-plain --host bymorning.contoso.us --image acr.azurecr.us/bymorning@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
check "generated overlay" test-plain
sh "$here/scripts/overlay.sh" "$here/test/outputs.sample.json" test-full --host bymorning.contoso.us --image acr.azurecr.us/bymorning:1.0.0 \
  --aws-role-arn arn:aws-us-gov:iam::123456789012:role/bymorning-bedrock --aws-region us-gov-west-1 \
  --component bedrock-web-identity --component code-interpreter-kubernetes
check "web identity + code interpreter" test-full
grep -q 'arn:aws-us-gov:iam::123456789012:role/bymorning-bedrock' "$scratch/test-full.yaml"
grep -q 'AWS_REGION: us-gov-west-1' "$scratch/test-full.yaml"
# A GovCloud Bedrock region gets the FIPS flag from the overlay; the image no longer bakes it.
grep -q 'AWS_USE_FIPS_ENDPOINT: "true"' "$scratch/test-full.yaml"
# The single image is bound to Azure by the base ConfigMap.
grep -q 'STORAGE_PROVIDER: azure-blob' "$scratch/base.yaml"
grep -q 'CIPHER_BACKEND: keyvault' "$scratch/base.yaml"
# The bymorning-aws ConfigMap must land in the Gateway namespace, not `default` (the pod's envFrom would not find it).
awk '/^kind: ConfigMap$/ {c=1} c && /name: bymorning-aws-/ {n=1} n && /namespace: bymorning$/ {ok=1} /^---$/ {c=0; n=0} END {exit !ok}' "$scratch/test-full.yaml"
grep -q 'audience: sts.amazonaws.com' "$scratch/test-full.yaml"
grep -q 'plugin-code-interpreter-kubernetes' "$scratch/test-full.yaml"
grep -q 'digest' "$k8s/overlays/test-plain/kustomization.yaml"
# The overlay's image must be what the pods actually run (a base-level rename once hid it).
[ "$(grep -c 'image: acr.azurecr.us/bymorning@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef$' "$scratch/test-plain.yaml")" = 2 ]
if grep -lE 'image: REGISTRY' "$scratch"/*.yaml; then echo "a rendered overlay still names the placeholder registry" >&2; exit 1; fi
sh "$here/scripts/overlay.sh" "$here/test/outputs.sample.json" test-key --host bymorning.contoso.us --image acr.azurecr.us/bymorning:1.0.0 \
  --aws-region us-east-1 --component bedrock-api-key
check "bedrock api key" test-key
grep -q 'name: bymorning-bedrock' "$scratch/test-key.yaml"

echo "== plugin deploy manifests match the Gateway identity"
kubectl kustomize "$here/../../plugins/code-interpreter-kubernetes/deploy" > "$scratch/plugin-deploy.yaml"
kubeconform -strict -summary -kubernetes-version 1.31.0 "$scratch/plugin-deploy.yaml"
grep -q 'name: bymorning-gateway' "$scratch/plugin-deploy.yaml"
grep -q 'namespace: bymorning$' "$scratch/plugin-deploy.yaml"
grep -q 'name: bymorning-sandbox' "$scratch/plugin-deploy.yaml"
grep -q 'name: bymorning-gateway' "$scratch/base.yaml"
grep -q '"namespace": "bymorning-sandbox"' "$k8s/components/code-interpreter-kubernetes/config/bymorning.jsonc"

echo "== create-secret.sh with stubbed terraform/kubectl"
real_kubectl=$(command -v kubectl)
mkdir -p "$scratch/bin"
cat > "$scratch/bin/terraform" <<'STUB'
#!/bin/sh
case "$*" in
  *database_url*) printf 'postgresql://u:p@host:5432/db' ;;
  *web_cookie_key*) printf 'a2V5' ;;
  *) exit 1 ;;
esac
STUB
cat > "$scratch/bin/kubectl" <<STUB
#!/bin/sh
case "\$1" in
  apply) cat > "$scratch/applied-\$\$.yaml" ;;
  *) exec "$real_kubectl" "\$@" ;;
esac
STUB
chmod +x "$scratch/bin/terraform" "$scratch/bin/kubectl"
printf -- '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n' > "$scratch/ca.pem"
printf 'topsecret' > "$scratch/client-secret"
PATH="$scratch/bin:$PATH" sh "$here/scripts/create-secret.sh" "$scratch" "$scratch/ca.pem" \
  --literal AUTH_PROVIDER=microsoft --extra AUTH_CLIENT_SECRET="$scratch/client-secret"
applied=$(cat "$scratch"/applied-*.yaml)
for key in DATABASE_URL WEB_COOKIE_KEY DATABASE_CA AUTH_PROVIDER AUTH_CLIENT_SECRET; do
  printf '%s\n' "$applied" | grep -q "^  $key:" || { echo "Secret missing $key" >&2; exit 1; }
done
printf '%s\n' "$applied" | grep '^  DATABASE_URL:' | awk '{print $2}' | base64 -d | grep -q '^postgresql://u:p@host'

echo "== policy check rejects a weakened manifest"
sed 's/readOnlyRootFilesystem: true/readOnlyRootFilesystem: false/' "$scratch/base.yaml" > "$scratch/weak.yaml"
if bun "$here/test/policy-check.ts" < "$scratch/weak.yaml" >/dev/null 2>&1; then
  echo "policy check accepted readOnlyRootFilesystem=false" >&2
  exit 1
fi
echo "ok"
