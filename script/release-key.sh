#!/bin/sh
# Creates the release signing key in AWS KMS, once, and writes its public key
# to release/cosign.pub. The private key never leaves KMS: script/release.ts
# signs through cosign with BYMORNING_COSIGN_KEY=awskms:///alias/bymorning-release.
#
#   sh script/release-key.sh [alias] [region]
#
# Idempotent: an existing alias is reused and only the public key is exported.
# The key is ECC_NIST_P256 SIGN_VERIFY with the default key policy, so signing
# is governed by IAM in the owning AWS account.
# Scheduling deletion enforces the 30-day waiting window. Never schedule deletion
# while a delivered release still needs verification: customers pin the public
# key, not the KMS key, but a replacement key means a new cosign.pub for them.
set -eu

alias=${1:-bymorning-release}
region=${2:-us-east-1}
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

if ! aws kms describe-key --region "$region" --key-id "alias/$alias" >/dev/null 2>&1; then
  key=$(aws kms create-key --region "$region" \
    --key-spec ECC_NIST_P256 --key-usage SIGN_VERIFY \
    --description "ByMorning release signing (cosign)" \
    --tags TagKey=purpose,TagValue=release-signing \
    --query KeyMetadata.KeyId --output text)
  aws kms create-alias --region "$region" --alias-name "alias/$alias" --target-key-id "$key"
  echo "created alias/$alias -> $key"
fi

# cosign's AWS SDK cannot always refresh an SSO session the CLI can, so hand it
# the resolved short-lived credentials.
eval "$(aws configure export-credentials --format env)"
pub=$(AWS_REGION=$region cosign public-key --key "awskms:///alias/$alias")
printf '%s\n' "$pub" >"$root/release/cosign.pub"
arn=$(aws kms describe-key --region "$region" --key-id "alias/$alias" --query KeyMetadata.Arn --output text)
echo "key: $arn"
echo "public key: release/cosign.pub (sha256 $(shasum -a 256 "$root/release/cosign.pub" | cut -d' ' -f1))"
echo "sign with: BYMORNING_COSIGN_KEY=awskms:///alias/$alias AWS_REGION=$region bun script/release.ts"
