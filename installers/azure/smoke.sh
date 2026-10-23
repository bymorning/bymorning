#!/bin/sh
# Post-deployment smoke test for the Azure installer. Run it after a deployment: it
# needs kubectl access to the cluster and a reachable origin.
#
# Usage:
#   sh installers/azure/smoke.sh --origin https://bymorning.contoso.us [options]
#
# Steps are grouped by what they change:
#   READ     (default)  no changes: migrate, workload, env, health, signin
#   TEMP     --temp     create and delete short-lived pods/blobs: identity, network, aws
#   MUTATE   --rotate   rotate the Key Vault key and restart the Gateway
#   MANUAL   printed    steps that need a signed-in user (chat, code execution)
#
# Options:
#   --origin URL            browser origin (required)
#   --namespace NS          Gateway namespace                 (default bymorning)
#   --sandbox-namespace NS  Code Interpreter namespace        (default bymorning-sandbox)
#   --cli-image IMAGE       Azure CLI image for --temp identity (mirror mcr.microsoft.com/azure-cli into your registry)
#   --cloud NAME            az cloud name: AzureUSGovernment | AzureCloud (default AzureUSGovernment)
#   --vault NAME            Key Vault name (for --rotate; else derived from KEY_VAULT_KEY)
#   --decrypt-check CMD     command that exits 0 when a credential saved BEFORE rotation still decrypts
#   --aws-region REGION     region for the STS check (default: the pod's AWS_REGION)
#   --code-cleanup          after you ran code in the UI: assert no sandbox pods remain
set -u

ns=bymorning
sandbox=bymorning-sandbox
origin=""
cli_image=""
cloud=AzureUSGovernment
vault=""
decrypt_check=""
aws_region=""
temp=""
rotate=""
cleanup=""
while [ $# -gt 0 ]; do
  case $1 in
    --origin) origin=${2%/}; shift 2 ;;
    --namespace) ns=$2; shift 2 ;;
    --sandbox-namespace) sandbox=$2; shift 2 ;;
    --cli-image) cli_image=$2; shift 2 ;;
    --cloud) cloud=$2; shift 2 ;;
    --vault) vault=$2; shift 2 ;;
    --decrypt-check) decrypt_check=$2; shift 2 ;;
    --aws-region) aws_region=$2; shift 2 ;;
    --temp) temp=1; shift ;;
    --rotate) rotate=1; shift ;;
    --code-cleanup) cleanup=1; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$origin" ] || { echo "--origin is required" >&2; exit 2; }

failed=0
pass() { printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failed=$((failed + 1)); }
note() { printf 'info  %s\n' "$1"; }
step() { printf '\n== %s\n' "$1"; }
k() { kubectl -n "$ns" "$@"; }
gw() { k exec deploy/bymorning -c gateway -- "$@"; }
curl_() { curl -fsS --max-time 20 "$@"; }
# Audience of a JWT file in the Gateway container. The payload is unpadded base64url: pad it and try both
# base64 flags (GNU/newer macOS -d, older macOS -D); a failing first decoder must not consume the input.
jwt_aud() {
  payload=$(gw sh -c "cut -d. -f2 \"\$$1\"" 2>/dev/null | tr '_-' '/+') || return 0
  while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="$payload="; done
  { printf '%s' "$payload" | base64 -d 2>/dev/null || printf '%s' "$payload" | base64 -D 2>/dev/null; } | jq -r '.aud[0] // .aud' 2>/dev/null || true
}

# ── READ ────────────────────────────────────────────────────────────────

step "READ workload shape: one replica, Recreate"
[ "$(k get deploy bymorning -o jsonpath='{.spec.replicas}')" = 1 ] && pass "replicas=1" || fail "replicas must be 1"
[ "$(k get deploy bymorning -o jsonpath='{.spec.strategy.type}')" = Recreate ] && pass "strategy=Recreate" || fail "strategy must be Recreate"
ready=$(k get deploy bymorning -o jsonpath='{.status.readyReplicas}')
[ "${ready:-0}" = 1 ] && pass "1 ready replica" || fail "expected 1 ready replica, got ${ready:-0}"
pods=$(k get pods -l app.kubernetes.io/name=bymorning --field-selector=status.phase=Running -o name | wc -l | tr -d ' ')
[ "$pods" = 1 ] && pass "exactly one running pod" || fail "expected exactly one running pod, found $pods"

step "READ migration completed before the Gateway started"
code=$(k get pods -l app.kubernetes.io/name=bymorning -o jsonpath='{.items[0].status.initContainerStatuses[?(@.name=="migrate")].state.terminated.exitCode}')
[ "$code" = 0 ] && pass "migrate init container exited 0" || fail "migrate init container exit code: '${code}'"
if k logs deploy/bymorning -c migrate 2>/dev/null | grep -q "Database migration complete"; then pass "migration log line present"; else fail "no 'Database migration complete' in migrate logs"; fi

step "READ runtime environment (values are not printed)"
for var in APP_ORIGIN AZURE_CLOUD STORAGE_ACCOUNT_URL STORAGE_CONTAINER KEY_VAULT_KEY DATABASE_URL DATABASE_CA WEB_COOKIE_KEY AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_FEDERATED_TOKEN_FILE; do
  if gw sh -c "[ -n \"\${$var:-}\" ]" 2>/dev/null; then pass "$var set"; else fail "$var missing in the Gateway container"; fi
done
[ "$(gw printenv APP_ORIGIN 2>/dev/null)" = "$origin" ] && pass "APP_ORIGIN equals --origin" || fail "APP_ORIGIN differs from --origin"
# The single image is bound to Azure by the two selectors (the values are not secret).
storage_provider=$(gw printenv STORAGE_PROVIDER 2>/dev/null || true)
[ "$storage_provider" = azure-blob ] && pass "STORAGE_PROVIDER=azure-blob" || fail "STORAGE_PROVIDER is '${storage_provider:-unset}', expected azure-blob"
cipher_backend=$(gw printenv CIPHER_BACKEND 2>/dev/null || true)
[ "$cipher_backend" = keyvault ] && pass "CIPHER_BACKEND=keyvault" || fail "CIPHER_BACKEND is '${cipher_backend:-unset}', expected keyvault"
fips=$(gw printenv AWS_USE_FIPS_ENDPOINT 2>/dev/null || true)
note "AWS_USE_FIPS_ENDPOINT=${fips:-unset} (set to true only for Bedrock in a us-gov-* region)"
authority=$(gw printenv AZURE_AUTHORITY_HOST 2>/dev/null || true)
note "AZURE_AUTHORITY_HOST=${authority:-unset} (Government expects https://login.microsoftonline.us/)"
audience=$(jwt_aud AZURE_FEDERATED_TOKEN_FILE)
note "workload identity token audience=${audience:-unreadable}; must equal the federated credential audience (terraform output federated_audience)"

step "READ health, sign-in, headers"
[ "$(curl_ "$origin/system/health" || true)" = ok ] && pass "/system/health ok" || fail "/system/health did not return ok"
method=$(curl_ "$origin/auth/method" || true)
case $method in
  *ready*|*setup*) pass "/auth/method: $method" ;;
  *) fail "/auth/method unexpected: '$method'" ;;
esac
case $method in *setup*) note "Setup pending: the setup token is in the pod: kubectl -n $ns exec deploy/bymorning -c gateway -- cat /tmp/bymorning/setup-token" ;; esac
spa=$(curl -sS --max-time 20 -D - -o /dev/null "$origin/" || true)
echo "$spa" | head -1 | grep -q ' 200' && pass "sign-in page served (200)" || fail "GET / did not return 200"
echo "$spa" | grep -qi '^strict-transport-security:' && pass "HSTS present" || fail "HSTS missing (check ingress)"
echo "$spa" | grep -qi '^content-security-policy:' && pass "CSP present" || fail "CSP missing"
case $origin in https://*) pass "origin uses HTTPS" ;; *) fail "origin must be HTTPS (secure cookies)" ;; esac

# ── TEMP ────────────────────────────────────────────────────────────────

if [ -n "$temp" ]; then
  step "TEMP identity: Blob upload/readback and Key Vault wrap with the Gateway identity (creates then deletes one pod and one blob)"
  if [ -z "$cli_image" ]; then
    fail "--cli-image is required for the identity step"
  else
    account=$(gw printenv STORAGE_ACCOUNT_URL); container=$(gw printenv STORAGE_CONTAINER); key=$(gw printenv KEY_VAULT_KEY)
    name=smoke-$(date +%s)
    tenant=$(gw printenv AZURE_TENANT_ID); client=$(gw printenv AZURE_CLIENT_ID)
    keyname=$(printf '%s' "$key" | sed 's#.*/keys/##; s#/.*##'); vaultname=$(printf '%s' "$key" | sed 's#https://##; s#\..*##')
    acct=$(printf '%s' "$account" | sed 's#https://##; s#\..*##')
    overrides=$(jq -cn --arg image "$cli_image" '{
      apiVersion: "v1",
      metadata: { labels: { "azure.workload.identity/use": "true" } },
      spec: {
        serviceAccountName: "bymorning-gateway",
        securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: "RuntimeDefault" } },
        containers: [{ name: "probe", image: $image,
          command: ["sleep", "600"],
          env: [{ name: "HOME", value: "/tmp" }, { name: "AZURE_CONFIG_DIR", value: "/tmp/.azure" }],
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
          volumeMounts: [{ name: "tmp", mountPath: "/tmp" }] }],
        volumes: [{ name: "tmp", emptyDir: {} }] } }')
    kubectl -n "$ns" delete pod "$name" --ignore-not-found >/dev/null
    if kubectl -n "$ns" run "$name" --image="$cli_image" --restart=Never --overrides="$overrides" >/dev/null &&
       kubectl -n "$ns" wait --for=condition=Ready "pod/$name" --timeout=180s >/dev/null; then
      probe() { kubectl -n "$ns" exec "$name" -- sh -c "$1"; }
      probe "az cloud set --name $cloud && az login --service-principal -u \"\$AZURE_CLIENT_ID\" -t \"\$AZURE_TENANT_ID\" --federated-token \"\$(cat \$AZURE_FEDERATED_TOKEN_FILE)\" --allow-no-subscriptions -o none" \
        && pass "federated login as the Gateway identity ($cloud)" || fail "federated login failed (audience/issuer/subject mismatch?)"
      blob="smoke/$name.txt"
      if probe "echo smoke-$name > /tmp/up.txt && az storage blob upload --auth-mode login --account-name $acct --container-name $container --name $blob --file /tmp/up.txt --overwrite -o none && az storage blob download --auth-mode login --account-name $acct --container-name $container --name $blob --file /tmp/down.txt -o none && grep -q smoke-$name /tmp/down.txt"; then
        pass "Blob upload and readback in container $container"
      else fail "Blob upload/readback failed (role assignment or private endpoint/DNS?)"; fi
      probe "az storage blob delete --auth-mode login --account-name $acct --container-name $container --name $blob -o none" && pass "smoke blob deleted" || fail "smoke blob not deleted: $blob"
      if probe "az storage container list --auth-mode login --account-name $acct -o none" >/dev/null 2>&1; then fail "identity can list containers: role is wider than the container"; else pass "identity cannot list containers (role is container-scoped)"; fi
      # The key permits only wrapKey/unwrapKey (what the Gateway uses); az has no wrap command, so call the REST API.
      # shellcheck disable=SC2016
      kv_roundtrip='kid=$(az keyvault key show --id "$1" --query key.kid -o tsv) || exit 1
        host=${kid#https://}; host=${host%%/*}; resource="https://${host#*.}"
        wrapped=$(az rest --method post --resource "$resource" --url "$kid/wrapkey?api-version=7.4" \
          --body "{\"alg\":\"RSA-OAEP-256\",\"value\":\"c21va2U\"}" --query value -o tsv) || exit 1
        az rest --method post --resource "$resource" --url "$kid/unwrapkey?api-version=7.4" \
          --body "{\"alg\":\"RSA-OAEP-256\",\"value\":\"$wrapped\"}" --query value -o tsv | grep -qx c21va2U'
      if kubectl -n "$ns" exec "$name" -- sh -c "$kv_roundtrip" kv "$key"; then
        pass "Key Vault RSA-OAEP-256 wrap/unwrap round trip ($keyname)"
      else fail "Key Vault round trip failed"; fi
      note "vault=$vaultname; the identity should hold Key Vault Crypto User on the key only"
    else fail "probe pod did not become ready (image pull from registry? Pod Security?)"; fi
    kubectl -n "$ns" delete pod "$name" --ignore-not-found --wait=false >/dev/null
  fi

  step "TEMP network: sandbox namespace policy and egress (creates then deletes one pod in $sandbox)"
  kubectl get ns "$sandbox" >/dev/null 2>&1 && pass "namespace $sandbox exists" || fail "namespace $sandbox missing (apply the sandbox manifests: kubectl apply -k sandbox)"
  sa="system:serviceaccount:$ns:bymorning-gateway"
  can() { kubectl auth can-i "$@" --as="$sa" 2>/dev/null; }
  for verb in "create pods" "get pods" "list pods" "delete pods" "create pods/exec" "get pods/exec"; do
    [ "$(can $verb -n "$sandbox")" = yes ] && pass "Gateway can $verb in $sandbox" || fail "Gateway cannot $verb in $sandbox"
  done
  for verb in "create secrets" "get secrets" "create pods"; do
    [ "$(can $verb -n "$ns")" = no ] && pass "Gateway cannot $verb in $ns" || fail "Gateway is too privileged: can $verb in $ns"
  done
  [ "$(can create clusterrolebindings)" = no ] && pass "Gateway has no cluster-scoped write" || fail "Gateway can create clusterrolebindings"
  np=$(kubectl -n "$sandbox" get networkpolicy -o json 2>/dev/null | jq '[.items[] | select((.spec.podSelector | length) == 0 and (.spec.policyTypes | index("Egress")) and (.spec.policyTypes | index("Ingress")) and ((.spec.egress // []) | length) == 0)] | length')
  [ "${np:-0}" -ge 1 ] && pass "deny-all (ingress+egress) NetworkPolicy present" || fail "no deny-all NetworkPolicy in $sandbox"
  probe_pod=bymorning-smoke-egress
  kubectl -n "$sandbox" delete pod "$probe_pod" --ignore-not-found >/dev/null 2>&1
  if kubectl -n "$sandbox" run "$probe_pod" --image="${cli_image:-mcr.microsoft.com/azure-cli}" --restart=Never --labels=app.kubernetes.io/managed-by=bymorning-smoke \
      --overrides='{"spec":{"automountServiceAccountToken":false,"serviceAccountName":"bymorning-sandbox","securityContext":{"runAsNonRoot":true,"runAsUser":1000,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"probe","image":"'"${cli_image:-mcr.microsoft.com/azure-cli}"'","command":["sleep","120"],"securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}' >/dev/null &&
     kubectl -n "$sandbox" wait --for=condition=Ready "pod/$probe_pod" --timeout=180s >/dev/null; then
    for target in https://example.com http://169.254.169.254/metadata/instance?api-version=2021-02-01 http://168.63.129.16/machine?comp=goalstate "https://kubernetes.default.svc"; do
      if kubectl -n "$sandbox" exec "$probe_pod" -- python3 -c "import sys,urllib.request; urllib.request.urlopen(sys.argv[1], timeout=5)" "$target" >/dev/null 2>&1; then
        fail "sandbox pod reached $target: egress is NOT blocked"
      else pass "sandbox pod cannot reach $target"; fi
    done
    kubectl -n "$sandbox" exec "$probe_pod" -- python3 -c "import socket; socket.gethostbyname('example.com')" >/dev/null 2>&1 && note "DNS resolves in the sandbox (deny-all allows no DNS; check the policy)" || pass "DNS blocked in the sandbox"
  else fail "egress probe pod did not start in $sandbox (Pod Security, quota, or image)"; fi
  kubectl -n "$sandbox" delete pod "$probe_pod" --ignore-not-found --wait=false >/dev/null 2>&1

  step "TEMP aws: Bedrock web identity (no secrets printed)"
  role=$(gw printenv AWS_ROLE_ARN 2>/dev/null || true)
  if [ -z "$role" ]; then
    note "AWS_ROLE_ARN not set: web identity not configured; skipping (Bedrock API key path: confirm AWS_BEARER_TOKEN_BEDROCK and AWS_REGION by chat below)"
  else
    region=${aws_region:-$(gw printenv AWS_REGION 2>/dev/null || true)}
    [ -n "$region" ] && pass "AWS_REGION=$region" || fail "AWS_REGION unset: STS would be called in us-east-1"
    aud=$(jwt_aud AWS_WEB_IDENTITY_TOKEN_FILE)
    [ "$aud" = sts.amazonaws.com ] && pass "projected token audience sts.amazonaws.com" || fail "AWS token audience is '$aud'"
    arn=$(gw node -e '
      const fs = require("fs");
      const p = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: process.env.AWS_ROLE_ARN, RoleSessionName: "bymorning-smoke", WebIdentityToken: fs.readFileSync(process.env.AWS_WEB_IDENTITY_TOKEN_FILE, "utf8").trim() });
      fetch("https://sts." + process.argv[1] + ".amazonaws.com/?" + p)
        .then(async (r) => { const t = await r.text(); const m = /<Arn>([^<]+)<\/Arn>/.exec(t); if (r.ok && m) console.log(m[1]); else { console.error("STS " + r.status + " " + (/<Code>([^<]+)</.exec(t) || [])[1]); process.exit(1) } })
        .catch((e) => { console.error("STS unreachable: " + e.message); process.exit(1) })' "$region" 2>&1)
    case $arn in
      arn:*) pass "AssumeRoleWithWebIdentity succeeded as $arn" ;;
      *) fail "AssumeRoleWithWebIdentity failed: $arn" ;;
    esac
  fi
fi

# ── MUTATE ──────────────────────────────────────────────────────────────

if [ -n "$rotate" ]; then
  step "MUTATE Key Vault rotation: rotates the key, restarts the Gateway"
  key=$(gw printenv KEY_VAULT_KEY)
  keyname=$(printf '%s' "$key" | sed 's#.*/keys/##; s#/.*##')
  vaultname=${vault:-$(printf '%s' "$key" | sed 's#https://##; s#\..*##')}
  case $key in */keys/*/*) fail "KEY_VAULT_KEY pins a version; rotation would not be picked up. Use the unversioned URL."; ;; esac
  if [ -n "$decrypt_check" ]; then
    sh -c "$decrypt_check" >/dev/null 2>&1 && pass "credential decrypts BEFORE rotation" || fail "decrypt check fails before rotation; fix that first"
  else note "no --decrypt-check: save a credential (for example a Provider Connection) in the UI first, then verify it manually after"; fi
  az cloud set --name "$cloud" >/dev/null 2>&1 || note "az cloud set failed; using current az cloud"
  before=$(az keyvault key list-versions --vault-name "$vaultname" --name "$keyname" --query 'length(@)' -o tsv)
  az keyvault key rotate --vault-name "$vaultname" --name "$keyname" -o none && pass "rotated $keyname" || fail "rotation failed (operator needs Key Vault Crypto Officer)"
  after=$(az keyvault key list-versions --vault-name "$vaultname" --name "$keyname" --query 'length(@)' -o tsv)
  [ "$after" -gt "$before" ] && pass "new key version exists ($before -> $after)" || fail "no new key version"
  disabled=$(az keyvault key list-versions --vault-name "$vaultname" --name "$keyname" --query "[?attributes.enabled==\`false\`] | length(@)" -o tsv)
  [ "$disabled" = 0 ] && pass "all versions remain enabled (old versions must stay enabled to unwrap)" || fail "$disabled key version(s) disabled: credentials wrapped by them cannot be read"
  kubectl -n "$ns" rollout restart deploy/bymorning >/dev/null
  kubectl -n "$ns" rollout status deploy/bymorning --timeout=300s >/dev/null && pass "Gateway restarted and ready on the new version" || fail "Gateway did not become ready after rotation"
  # The Ingress can answer 503 for a few seconds after the new pod reports Ready; wait for it.
  healthy=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    [ "$(curl_ "$origin/system/health" 2>/dev/null || true)" = ok ] && { healthy=1; break; }
    sleep 5
  done
  [ -n "$healthy" ] && pass "health ok after rotation" || fail "health failed after rotation"
  if k logs deploy/bymorning -c gateway 2>/dev/null | grep -qi 'Cipher.*Unavailable'; then fail "Cipher unavailable errors in the Gateway log"; else pass "no Cipher errors in the Gateway log"; fi
  if [ -n "$decrypt_check" ]; then
    sh -c "$decrypt_check" >/dev/null 2>&1 && pass "credential saved before rotation still decrypts" || fail "credential saved before rotation no longer decrypts"
  else note "MANUAL: confirm the credential saved before rotation still works (for example run a model request using that Connection)"; fi
fi

# ── Cleanup check after manual code execution ─────────────────────────

if [ -n "$cleanup" ]; then
  step "READ sandbox pods cleaned up after code execution"
  left=$(kubectl -n "$sandbox" get pods -l app.kubernetes.io/managed-by=bymorning-code-interpreter -o name 2>/dev/null | wc -l | tr -d ' ')
  [ "$left" = 0 ] && pass "no Code Interpreter pods remain in $sandbox" || fail "$left Code Interpreter pod(s) remain in $sandbox (deadline is about 4 minutes)"
fi

cat <<MANUAL

== MANUAL steps (need a signed-in user; not automated here)
  1. Sign in at $origin through the configured Auth Provider. Confirm the Workspace loads.
  2. Bedrock chat: choose a Bedrock model, send one message, expect a reply. Confirm the call in AWS CloudTrail
     (AssumeRoleWithWebIdentity, then InvokeModel/Converse) in the customer's account and region.
  3. Code execution: ask for 'run python: print(1+1)'; expect 2. Then ask the code to reach the network
     (for example urllib.request.urlopen('https://example.com')): expect it to fail. Then run:
       sh installers/azure/smoke.sh --origin $origin --code-cleanup
  4. Large Tool result: confirm an object under tool-output/ in the Blob container.
MANUAL

if [ "$failed" -gt 0 ]; then printf '\n%s check(s) FAILED\n' "$failed" >&2; exit 1; fi
printf '\nall automated checks passed\n'
