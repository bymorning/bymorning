#!/bin/sh
# Every file that states the release version agrees with the root package.json. Run in the full gate's installers job.
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"
want=$(jq -er .version package.json)
status=0
check() { [ "$2" = "$want" ] || { echo "FAIL: $1 is $2, package.json is $want" >&2; status=1; }; }
check app/host/package.json "$(jq -er .version app/host/package.json)"
check "server.json version" "$(jq -er .version server.json)"
check "charts/bymorning/Chart.yaml version" "$(sed -n 's/^version: *//p' charts/bymorning/Chart.yaml)"
check "charts/bymorning/Chart.yaml appVersion" "$(sed -n 's/^appVersion: *"\(.*\)"$/\1/p' charts/bymorning/Chart.yaml)"
[ "$status" = 0 ] && echo "versions: every release version file states $want"
exit "$status"
