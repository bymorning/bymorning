#!/usr/bin/env bash
set -euo pipefail

for name in DATABASE_URL AUTH_ISSUER AUTH_CLIENT_ID AUTH_PROVIDER WEB_COOKIE_KEY HOT_RELOAD_WORKSPACE_ID HOT_RELOAD_AUTH_COOKIE; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
done

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
artifact=/tmp/opencode/plugin-hot-reload
demo=/tmp/opencode/bymorning-plugin-demo
server_port=${HOT_RELOAD_SERVER_PORT:-3210}
web_port=${HOT_RELOAD_WEB_PORT:-3000}
web_host=${HOT_RELOAD_WEB_HOST:-localhost}
server_url="http://localhost:$server_port"
web_url="http://localhost:$web_port"
fixture="$root/packages/core/test/fixtures/hot-reload-plugin.ts"
plugin="$demo/plugin.ts"
config="$artifact/original-config.json"
mkdir -p "$artifact" "$demo"
mkdir -p "$demo/node_modules/@bymorning"
ln -sfn "$root/packages/plugin" "$demo/node_modules/@bymorning/plugin"
ln -sfn "$root/packages/plugin/node_modules/effect" "$demo/node_modules/effect"
rm -rf "$root/packages/web/test-results/timeline"
cp "$fixture" "$plugin"

if ss -ltn | grep -Eq ":($web_port|$server_port)[[:space:]]"; then
  echo "localhost:$web_port and localhost:$server_port must be free; refusing to stop an existing process" >&2
  exit 2
fi

server_group=
web_group=
restore_config=false
cleanup() {
  set +e
  if $restore_config; then
    curl --silent --show-error --fail -X PUT \
      -H "Cookie: $HOT_RELOAD_AUTH_COOKIE" \
      -H "Origin: ${APP_ORIGIN:-$web_url}" \
      -H 'Content-Type: application/json' \
      --data-binary "@$config" \
      "$server_url/api/config?workspace=$HOT_RELOAD_WORKSPACE_ID" >/dev/null
  fi
  [[ -n "$web_group" ]] && kill -- "-$web_group" 2>/dev/null
  [[ -n "$server_group" ]] && kill -- "-$server_group" 2>/dev/null
  rm -f "$config"
}
trap cleanup EXIT INT TERM

cd "$root"
APP_ORIGIN=${APP_ORIGIN:-$web_url} PORT=$server_port PLUGIN_WATCH_EXCLUDE=$demo \
  setsid bun run dev:server >"$artifact/server.log" 2>&1 &
server_group=$!
VITE_GATEWAY_URL=$server_url setsid bun run dev:web -- --host "$web_host" --port "$web_port" --strictPort >"$artifact/web.log" 2>&1 &
web_group=$!

wait_for_url() {
  local url=$1
  for _ in $(seq 1 120); do
    curl --silent --fail "$url" >/dev/null 2>&1 && return
    sleep 0.5
  done
  echo "Timed out waiting for $url" >&2
  return 1
}
wait_for_url "$server_url/system/health"
wait_for_url "$web_url"

server_pid=$(ss -ltnp "sport = :$server_port" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -1)
if [[ -z "$server_pid" ]]; then
  echo "Could not identify the Gateway listener PID" >&2
  exit 1
fi
printf '%s\n' "$server_pid" >"$artifact/server.pid"
ps -o pid,lstart,cmd -p "$server_pid" >"$artifact/server-before.txt"
started=$(date --iso-8601=seconds)
start_ticks=$(awk '{print $22}' "/proc/$server_pid/stat")

curl --silent --show-error --fail \
  -H "Cookie: $HOT_RELOAD_AUTH_COOKIE" \
  "$server_url/api/config?workspace=$HOT_RELOAD_WORKSPACE_ID" >"$config"
restore_config=true
jq --arg plugin "$plugin" '.plugins = ((.plugins // []) | if index($plugin) then . else . + [$plugin] end)' "$config" | \
  curl --silent --show-error --fail -X PUT \
    -H "Cookie: $HOT_RELOAD_AUTH_COOKIE" \
    -H "Origin: ${APP_ORIGIN:-$web_url}" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    "$server_url/api/config?workspace=$HOT_RELOAD_WORKSPACE_ID" >/dev/null

wait_for_value() {
  local url=$1 query=$2 expected=$3
  for _ in $(seq 1 120); do
    value=$(curl --silent --show-error --fail -H "Cookie: $HOT_RELOAD_AUTH_COOKIE" "$url" | jq -r "$query")
    [[ "$value" == "$expected" ]] && return
    sleep 0.5
  done
  echo "Timed out waiting for $expected" >&2
  return 1
}
wait_for_value "$server_url/api/plugin?workspace=$HOT_RELOAD_WORKSPACE_ID" \
  '.[] | select(.id == "demo.same-pid") | "\(.status)|\(.source.type)"' 'active|local'
wait_for_value "$server_url/api/integration?workspace=$HOT_RELOAD_WORKSPACE_ID" \
  '.[] | select(.id == "same-pid-demo") | .name' "Hot Reload v1 | pid $server_pid"
curl --silent --show-error --fail -H "Cookie: $HOT_RELOAD_AUTH_COOKIE" \
  "$server_url/api/plugin?workspace=$HOT_RELOAD_WORKSPACE_ID" >"$artifact/inventory-before.json"

HOT_RELOAD_PLUGIN_PATH=$plugin HOT_RELOAD_SERVER_PID=$server_pid HOT_RELOAD_WEB_URL=$web_url \
  bun run --cwd packages/web playwright test --config test-browser/playwright.config.ts plugin-hot-reload.spec.ts

kill -0 "$server_pid"
end_ticks=$(awk '{print $22}' "/proc/$server_pid/stat")
[[ "$start_ticks" == "$end_ticks" ]]
wait_for_value "$server_url/api/integration?workspace=$HOT_RELOAD_WORKSPACE_ID" \
  '.[] | select(.id == "same-pid-demo") | .name' "Hot Reload v2 | pid $server_pid"
curl --silent --show-error --fail -H "Cookie: $HOT_RELOAD_AUTH_COOKIE" \
  "$server_url/api/plugin?workspace=$HOT_RELOAD_WORKSPACE_ID" >"$artifact/inventory-after.json"
ps -o pid,lstart,cmd -p "$server_pid" >"$artifact/server-after.txt"
video=$(find "$root/packages/web/test-results/timeline" -name '*.webm' -print -quit)
[[ -n "$video" ]] && cp "$video" "$artifact/plugin-hot-reload.webm"

ended=$(date --iso-8601=seconds)
cat >"$artifact/evidence.md" <<EOF
# Same-process plugin hot reload evidence

- Phase base: aa3b2b9367f284238ffd4840a208686105abef76
- Candidate commit: $(git rev-parse HEAD)
- Started: $started
- Ended: $ended
- Workspace ID: $HOT_RELOAD_WORKSPACE_ID
- Web URL: $web_url
- Gateway URL: $server_url
- Initial inventory: demo.same-pid active (local); Hot Reload v1 | pid $server_pid
- Final inventory: demo.same-pid active (local); Hot Reload v2 | pid $server_pid
- PID before: $server_pid (start ticks $start_ticks)
- PID after: $server_pid (start ticks $end_ticks; kill -0 passed)
- Browser command: bun run --cwd packages/web playwright test --config test-browser/playwright.config.ts plugin-hot-reload.spec.ts
- Video: $artifact/plugin-hot-reload.webm
EOF

echo "Evidence: $artifact/evidence.md"
