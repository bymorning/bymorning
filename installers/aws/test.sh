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

echo "== terraform test (mock aws)"
terraform -chdir="$here/modules/bymorning" test

echo "AWS installer: offline checks passed"
