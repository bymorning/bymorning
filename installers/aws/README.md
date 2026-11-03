# ByMorning on AWS

This installer deploys ByMorning into a VPC you already have, in commercial AWS or AWS GovCloud (US), with Terraform.
It creates:

```text
Browser ─► Application Load Balancer (HTTPS, your ACM certificate; internal by default)
             └─► ECS Fargate: one task          migrate (runs first, exits) ─► gateway (UI + API)
                   ├─► RDS PostgreSQL 17         encrypted, private, TLS 1.3, verify-full
                   ├─► S3 bucket                 KMS-encrypted, private, TLS-only, versioned
                   ├─► KMS key                   database, bucket, secrets, logs, and stored Credentials
                   ├─► Secrets Manager           database URL, cookie key, listener key, Setup token
                   ├─► Amazon Bedrock            only the model ARNs you list (optional)
                   └─► AgentCore Code Interpreter no network access (optional)
```

The Region selects the partition. In AWS GovCloud the task always uses FIPS endpoints and the load balancer a FIPS TLS
policy. In US commercial Regions both are on by default (`fips_endpoints = false` turns them off); outside the US
they are off, because FIPS endpoints don't exist there.

## What you need

- **Terraform** 1.9 or later, the **AWS CLI**, and credentials that can create the resources above.
- **A VPC** with private subnets for the task and the database (two Availability Zones), and subnets for the load
  balancer in two Availability Zones. The task subnets need HTTPS out to ECR or `ghcr.io`, S3, KMS, Secrets Manager,
  CloudWatch Logs, Bedrock, and your identity provider: a NAT gateway, or VPC endpoints plus an approved route to your
  identity provider. In GovCloud these are the FIPS hostnames (`kms-fips`, `s3-fips`, `bedrock-runtime-fips`,
  `bedrock-agentcore-fips`). Bedrock Mantle has no FIPS hostname.
- **A DNS name** and an **ACM certificate** for it in the same Region.
- **Bedrock model access** for the models you'll list, if you use Bedrock.
- **An OpenID Connect identity provider**, such as Microsoft Entra ID or Okta, where you can register an application.
- [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) to verify the image, and
  [crane](https://github.com/google/go-containerregistry/blob/main/cmd/crane/README.md) if you mirror it into ECR.

## Install

### 1. Choose and verify the image

Every release image is published to `ghcr.io/bymorning/bymorning` and signed by the release workflow. Look up the
digest of the version you want and verify it:

```sh
version=<version>
crane digest "ghcr.io/bymorning/bymorning:$version"      # sha256:...
cosign verify "ghcr.io/bymorning/bymorning:$version" \
  --certificate-identity "https://github.com/bymorning/bymorning/.github/workflows/full-gate.yml@refs/tags/v$version" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The task can pull `ghcr.io/bymorning/bymorning@sha256:<digest>` directly when its subnets reach the internet.
Otherwise mirror the image into ECR; copying by digest keeps the digest:

```sh
registry=<account>.dkr.ecr.<region>.amazonaws.com
aws ecr create-repository --repository-name bymorning --image-tag-mutability IMMUTABLE
aws ecr get-login-password | crane auth login "$registry" --username AWS --password-stdin
crane copy "ghcr.io/bymorning/bymorning@sha256:<digest>" "$registry/bymorning:$version"
```

With no internet access at all, download the release files on another machine (see
[the download page](https://bymorning.ai/download)), verify them there, and push the tarball's OCI layout instead:

```sh
mkdir layout && tar -xf bymorning-<commit>.tar -C layout
crane push layout "$registry/bymorning:$version"
crane digest "$registry/bymorning:$version"    # must equal the digest in manifest.json
```

### 2. Apply

```sh
cp -r installers/aws/environments/example installers/aws/environments/<name>
cd installers/aws/environments/<name>
cp terraform.tfvars.example terraform.tfvars    # fill in your values; image is the digest-pinned reference
terraform init
terraform apply
```

The first apply takes about 15 minutes, most of it for the database. Terraform waits until the task is healthy behind
the load balancer. Terraform state holds the generated secrets, so use a private, encrypted backend (`main.tf` shows
an S3 example).

### 3. Point DNS at the load balancer

Create a CNAME from your hostname to `terraform output -raw load_balancer_dns_name`, or a Route 53 alias using
`load_balancer_zone_id`. Then, from inside your network:

```sh
curl -fsS "$(terraform output -raw origin)/system/health"    # ok
```

### 4. Sign in for the first time

```sh
terraform output -raw setup_token
```

Open the address, enter the Setup token, and register your identity provider. Setup shows the redirect URI to add to
the provider. The first person to sign in becomes the Installation Admin. See
[First sign-in](https://bymorning.ai/docs/deploy/first-run).

## Settings

The example's `terraform.tfvars.example` lists every setting. The ones you are most likely to change:

| Variable                       | Default        | Effect                                                                   |
| ------------------------------ | -------------- | ------------------------------------------------------------------------ |
| `internal`                     | `true`         | `false` makes the load balancer internet-facing; give it public subnets. |
| `allowed_cidrs`                | required       | Who may reach the load balancer on 80 and 443.                           |
| `bedrock_model_arns`           | `[]`           | Models and inference profiles the task may invoke. No wildcards.         |
| `code_interpreter`             | `false`        | Adds an AgentCore Code Interpreter with no network access.               |
| `database.multi_az`            | `false`        | A standby in a second Availability Zone.                                 |
| `database.instance_class`      | `db.t4g.small` | The RDS instance size.                                                   |
| `database.deletion_protection` | `true`         | Set `false` and apply before destroying.                                 |
| `task.cpu`, `task.memory`      | `1024`, `2048` | The Fargate task size.                                                   |
| `login_banner`                 | none           | A system use notification acknowledged before sign-in.                   |
| `setup_token`                  | generated      | Your own Setup token instead of the generated one.                       |

## Upgrade

1. Read the release's upgrade notes in the [changelog](https://bymorning.ai/docs/changelog).
2. Snapshot the database:
   `aws rds create-db-snapshot --db-instance-identifier "$(terraform output -raw database_identifier)" --db-snapshot-identifier bymorning-before-<version>`
3. Verify the new image as in step 1, set `image` to its digest, and `terraform apply` with the installer from the
   same release.

Migrations only move forward. The task stops and the new one starts, so expect a short interruption; a task that never
becomes healthy is rolled back. To go back after a release that added migrations, restore the snapshot first.

## Remove it

Set `database.deletion_protection = false` and apply. Empty the storage bucket (the S3 console's **Empty** removes
every version), then `terraform destroy`. RDS keeps a final snapshot, and the KMS key waits 30 days before it is
deleted. Keep the key until you no longer need that snapshot.

## What it leaves to you

- One task runs at a time; an upgrade or crash causes a short outage.
- No WAF, load balancer access logs, GuardDuty, or alarms are configured. Add them with your account's standards.
- The load balancer does not validate the task's self-signed listener certificate; the hop is encrypted, not
  authenticated.
- The task connects to PostgreSQL as the database's administrator.
- Secrets are also in Terraform state.

The [security review package](../../docs/security/review/README.md) covers the controls and shared responsibilities in
detail.
