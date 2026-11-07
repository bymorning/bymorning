#!/bin/sh
# Exports the AWS installer's module in the layout the Terraform Registry publishes: a repository named
# terraform-aws-bymorning with the module at its root, a README, a LICENSE, and an example.
#
#   sh script/release/terraform-module.sh <output directory>
#
# The registry module is bymorning/bymorning/aws. Publish it once at https://registry.terraform.io (sign in with
# GitHub, Publish, Module); after that every v* tag of the mirror repository is a new version. Mirror a release by
# running this script into a clone of the repository, committing, and tagging the same version as the release.
set -eu

here=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
out=${1:?output directory}
module="$here/installers/aws/modules/bymorning"
example="$here/installers/aws/environments/example"
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/package.json" | head -1)

mkdir -p "$out/examples/basic"
# Replace the module files; leave .git alone.
find "$out" -mindepth 1 -maxdepth 1 ! -name .git ! -name examples -exec rm -rf {} +
rm -rf "$out/examples/basic"
mkdir -p "$out/examples/basic"
(cd "$module" && tar --exclude .terraform --exclude .terraform.lock.hcl -cf - .) | (cd "$out" && tar -xf -)
cp "$here/LICENSE" "$out/LICENSE"
(cd "$example" && tar --exclude .terraform --exclude .terraform.lock.hcl -cf - .) | (cd "$out/examples/basic" && tar -xf -)
# The example calls the module from the repository root.
sed -i.bak 's#source = "../../modules/bymorning"#source = "../.."#' "$out/examples/basic/main.tf" && rm "$out/examples/basic/main.tf.bak"

# A module repository never commits provider binaries or a lock file; keep a stray terraform init out of git.
printf '%s\n' '.terraform/' '.terraform.lock.hcl' '*.tfstate' '*.tfstate.*' >"$out/.gitignore"

cat >"$out/README.md" <<README
# terraform-aws-bymorning

A Terraform module that deploys [ByMorning](https://github.com/bymorning/bymorning), an open source, self-hosted MCP and model gateway, into a VPC
you already have, in commercial AWS or AWS GovCloud (US). It runs one ECS Fargate task (migrations, then the Gateway)
behind an Application Load Balancer, with RDS PostgreSQL 17, an S3 bucket, one KMS key, and Secrets Manager.

This repository is a mirror of \`installers/aws/modules/bymorning\` in the ByMorning repository, exported for the Terraform
Registry. Report issues and send changes there. ByMorning is open source and community maintained, under the MIT
License. This module passed offline tests and one end-to-end test in a commercial AWS account; Bedrock model calls and
AWS GovCloud were not tested. Run the sandbox checklist in the ByMorning repository before you rely on it.

\`\`\`hcl
module "bymorning" {
  source  = "bymorning/bymorning/aws"
  version = "$version"

  image           = "ghcr.io/bymorning/bymorning@sha256:<digest>" # pinned by digest; verify it with cosign first
  hostname        = "bymorning.example.com"
  certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/<id>"

  vpc_id                   = "vpc-0123456789abcdef0"
  service_subnet_ids       = ["subnet-aaa", "subnet-bbb"]
  load_balancer_subnet_ids = ["subnet-aaa", "subnet-bbb"]
  allowed_cidrs            = ["10.0.0.0/8"]
}
\`\`\`

The Region selects the partition, and GovCloud always uses FIPS endpoints. See
[the AWS installer guide](https://github.com/bymorning/bymorning/blob/v$version/installers/aws/README.md) for prerequisites,
verifying and mirroring the image, first sign-in, upgrades, and removal, and [examples/basic](examples/basic) for a root
module.
README
echo "exported terraform-aws-bymorning $version to $out"
