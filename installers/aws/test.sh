#!/bin/sh
# Offline checks for the AWS installer. No AWS credentials; the provider is mocked.
#   sh installers/aws/test.sh
# Requires terraform.
set -eu

here=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)

echo "== terraform fmt"
terraform -chdir="$here" fmt -check -recursive

echo "== terraform validate (module + example root)"
for dir in modules/bymorning environments/example; do
  terraform -chdir="$here/$dir" init -backend=false -input=false >/dev/null
  terraform -chdir="$here/$dir" validate
done

echo "== the example passes every module variable through, with the module's defaults"
names() { sed -n 's/^variable "\([a-z_]*\)".*/\1/p' "$1" | sort; }
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
names "$here/modules/bymorning/variables.tf" >"$scratch/module"
names "$here/environments/example/variables.tf" >"$scratch/example"
missing=$(comm -23 "$scratch/module" "$scratch/example" | tr '\n' ' ')
[ -z "$missing" ] || { echo "FAIL: the example does not expose: $missing" >&2; exit 1; }
days() { sed -n '/^variable "log_retention_days"/,/^}/s/^ *default *= *//p' "$1"; }
[ "$(days "$here/modules/bymorning/variables.tf")" = "$(days "$here/environments/example/variables.tf")" ] ||
  { echo "FAIL: the log_retention_days defaults of the module and the example differ" >&2; exit 1; }

echo "== terraform test (mock aws)"
terraform -chdir="$here/modules/bymorning" test

echo "AWS installer: offline checks passed"
