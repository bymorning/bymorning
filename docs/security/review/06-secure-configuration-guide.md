---
title: Secure Configuration Guide (CUI Profile)
---

# Secure Configuration Guide (CUI Profile)

The CUI profile is the hardening baseline for operating ByMorning with CUI,
including ITAR and EAR data. Apply it before admitting users to any
installation that may handle CUI. Installer settings live in the customer's
copy of the AWS or Azure installer; application settings live in the Console
and are admin-only.

An evaluation installation (`BYMORNING_EVALUATION=true`) is out of scope for
CUI and production use. It keeps files unencrypted on local disk, protects
stored secrets only with an operator-held local key, and offers Local Login.
The image refuses the CUI profile in an evaluation installation. In the CUI
profile `BYMORNING_EVALUATION` must be unset or `false`; neither installer
sets it.

## 6.1 Installer settings

### 6.1.1 AWS installer

Set these in the environment's `terraform.tfvars`, or as arguments in the
environment's module block where the example root does not expose them.
"Verify" points at the numbered check in §6.4; "plan" means inspect the value
and confirm `terraform plan` shows no drift.

| Setting | CUI profile value | Why | Verify |
| ------- | ----------------- | --- | ------ |
| `image` | The digest-pinned reference matching the image digest in §15 | Immutable, signature-verified image; the module refuses a tag-only reference | #1 |
| `hostname`, `certificate_arn` | An ACM certificate for the hostname in the deployment Region | TLS at the load balancer | #3 |
| `internal` | `true` (default) | No internet-facing load balancer unless expressly authorized | #2 |
| `allowed_cidrs` | The customer's VPN or proxy egress ranges only | Managed access control points (3.1.14); the load balancer admits only these ranges | plan |
| `assign_public_ip` | `false` (default) | The task stays private | plan |
| `fips_endpoints` (module argument) | Unset: always on in AWS GovCloud (US), on by default in US commercial Regions; never `false` | FIPS endpoints for S3, KMS, Bedrock, and AgentCore, and the FIPS load balancer TLS policy | #2 |
| `cui_profile`, `code_interpreter` | `true`, `true` | Loads the CUI installation document: AgentCore only, no Share or Google plugin | #5 |
| `bedrock_model_arns` | An explicit list of approved model and inference-profile ARNs | The task role may invoke only these; wildcards are refused | plan |
| `database.deletion_protection` | `true` (default) | Prevents accidental deletion | #7 |
| `database.backup_retention_days` | `7` (default) or longer per policy | Point-in-time recovery window | #7 |
| `database.multi_az` | `true` recommended | A standby in a second Availability Zone; the default is one instance | #7 |
| `log_retention_days` (module argument) | Per the customer's audit retention policy, for example `365`; the default is 90 | Audit record retention (3.3.1) | #9 |
| `login_banner` | Approved system-use notice (sample in §6.2.2) | Notice acknowledged before sign-in (3.1.9) | #4 |
| `setup_token` | Omit, so the module generates one, or supply it from a secret store | Read once with `terraform output -raw setup_token` | — |
| Terraform backend | A private, encrypted backend with state locking | State holds every generated secret | — |

The module fixes the rest of the security posture without settings. ECS Exec
is disabled, secrets reach the task only as ECS container secrets, and the
database requires TLS 1.3 with `verify-full`. The KMS key rotates annually,
and the bucket refuses non-TLS requests. Forwarded-for headers are trusted
only from the VPC CIDR.

The AWS installer does not configure the following, and a CUI deployment
needs each one, added with the customer's account standards:

| Control | Why |
| ------- | --- |
| AWS WAF on the load balancer | Request filtering and rate limiting at the edge |
| Load balancer access logs | Connection-level records for 3.3.1; the module enables none |
| GuardDuty, including Malware Protection for S3 | Threat detection and upload scanning |
| CloudTrail management events and data events for the bucket and key | Records of object and key use |
| CloudWatch alarms and notifications | Alerting on task failure, health, and audit signals |
| S3 Object Lock or an immutable log archive | Tamper resistance for exported logs and backups |
| VPC endpoints and egress filtering | The task security group allows HTTPS to any address; a firewall, proxy, or endpoints restrict it to the destinations in §9.2 |
| KMS key administrators | The key policy delegates to the account; name key administrator roles and restrict who can use or schedule deletion of the key |
| Log retention and export beyond the default | CloudWatch keeps 90 days unless changed; export to the customer's log archive |
| VPC flow logs, AWS Config, Security Hub, AWS Backup | Account-level monitoring and backup vaulting |
| A least-privilege database role | The task connects as the database administrator |

### 6.1.2 Azure installer

| Setting | CUI profile value | Why |
| ------- | ----------------- | --- |
| `environment`, `location` | `usgovernment` with an Azure Government region where required | Cloud and data location |
| `private_cluster` | `true` (default) | Private Kubernetes API server |
| `admin_group_object_ids` | The customer's cluster-administrator Entra groups | Azure RBAC for Kubernetes; local accounts disabled |
| `fips_node_pools` | `true` | FIPS-enabled node images for the system and user pools |
| `deployer_ip_ranges` | Empty (run inside the VNet) or the single runner address | Key Vault and Storage accept only private endpoints and these addresses |
| `key_vault_sku` | `premium` | HSM-backed Key Vault key |
| `outbound_type` | `userDefinedRouting` through the customer's firewall | Egress allowlisting to the destinations in §9.2 |
| `log_analytics`, `log_retention_days` (module argument) | `true`, per audit retention policy | Container Insights and log retention |
| `postgres_high_availability` (module argument) | `true` where zones exist | Zone-redundant database |
| `network_policy` | An engine that enforces `NetworkPolicy` (`cilium` default) | The Kubernetes Code Interpreter refuses to run without a deny-all policy |
| Installation document (`bymorning-config` ConfigMap) | Only the Kubernetes Code Interpreter plugin; remove the Google, Atlassian, and Share plugins | The Azure installer has no packaged CUI document |
| Ingress | The customer's ingress controller with a FIPS-approved TLS policy; `TLS_CERT` and `TLS_KEY` to encrypt the ingress-to-pod hop | TLS terminates at the ingress; the pod serves HTTP by default |
| `LOGIN_BANNER` | Approved system-use notice | Notice acknowledged before sign-in |

With `sandbox_node_pool`, sandbox pods run under Kata VM isolation on a pool
that cannot itself be FIPS-enabled. The Azure installer does not configure an
ingress WAF, Microsoft Defender for Cloud, diagnostic settings for Key Vault,
Storage, or PostgreSQL, customer-managed keys for Storage or PostgreSQL,
immutable storage, or alerts.

## 6.2 Application settings

Settings split across two roles. Installation Admin settings (Auth Providers,
the Installation Policy, admin grants, Account suspension) are
installation-scoped and refuse Workspace administrators without a grant
(SEC-INST). Workspace administrator settings cover one Workspace. Members
cannot change security-relevant configuration: the plugin, `providers.allow`,
Routing, Gateway, WebSearch, Code Interpreter, Tool-output, and default-Agent
sections, plus Service Accounts and Keys, Spend Limits, and Managed Policies,
all refuse member writes (SEC-AUTHZ, SEC-TOOLAUTHZ).

### 6.2.1 Installation Policy (Installation Admin, once per installation)

The Installation Policy is a clamp every Workspace's effective configuration
resolves against; a Workspace may tighten it, never loosen it (SEC-INST).

| Setting | CUI profile value | Why |
| ------- | ----------------- | --- |
| `provisioning` | `invite-only` (default) | First logins require an invitation |
| `providers.allow` | `["amazon-bedrock"]` | Installation-wide Provider admission clamp |
| `share`, `websearch` | `"off"` | Defense in depth beneath the profile's missing Share plugin; search providers are outside the boundary |
| `plugins` | `"off"`, or an allowlist naming only the installation's Code Interpreter plugin | Enforced plugin allowlist; the image never installs packages at runtime |
| `invitations.domains` | The customer's email domains only | Invitation admission bound |

### 6.2.2 Installation and host settings

| Setting | CUI profile value | Why |
| ------- | ----------------- | --- |
| Auth Provider (Installation Admin) | The customer's OIDC identity provider; admitted email domains limited to the customer's domains; MFA enforced at the provider | Redirect URI per provider: `https://<hostname>/auth/callback/<providerID>` |
| Login banner (`login_banner` or `LOGIN_BANNER`) | Approved notice, for example: _"You are accessing an information system that processes Controlled Unclassified Information, which may include export-controlled technical data. Access is restricted to authorized persons. Use is monitored."_ | Acknowledged before the identity-provider redirect (SEC-BANNER) |
| `SESSION_IDLE_TIMEOUT`, `SESSION_ABSOLUTE_TIMEOUT` | Defaults of 15 minutes and 12 hours, or shorter | Login Session limits (3.1.10, 3.1.11) (SEC-SESS) |
| `AUDIT_RETENTION_DAYS` | Default 365, or longer per policy | Audit Entry retention in the database |
| `BYMORNING_EVALUATION` | Unset or `false` | Evaluation installations are outside the CUI profile |

The AWS installer passes no session-timeout or audit-retention variables, so
the defaults apply unless the customer extends the module's container
environment. On Azure they can be added as literals in the `bymorning-env`
ConfigMap.

### 6.2.3 Workspace settings (Workspace administrator, per Workspace)

| Setting | CUI profile value | Why |
| ------- | ----------------- | --- |
| `providers.allow` | `["amazon-bedrock"]` only | Any other Provider is outside the CUI boundary (§6.3) |
| Routing rules, model policy | Restricted to Models of allowed Providers | Routing rewrites destination Models, never authentication |
| Share plugin | Not loaded: the CUI profile omits `@bymorning/plugin-share`, so the share Tool does not exist (SEC-CFG) | The default document enables unauthenticated public links |
| WebSearch | Off | Third-party search providers are outside the boundary |
| WebFetch | Permission effect `ask` or `deny` | Indirect prompt-injection vector (§10); the SSRF guard screens destinations (SEC-SSRF) |
| Code Interpreter | AgentCore on AWS; Kubernetes sandbox on Azure | Both run code with no network access (§2.9) |
| Outbound MCP | Admin-approved internal servers only; enablement off by default | Only Workspace administrators can enable it |
| Third-party plugins | None | Plugins run in-process (§12) |
| Permission rules | Add a catch-all `deny` for unmatched sensitive actions such as `webfetch` and shell execution | Unmatched actions are allowed by default |
| Spend Limits | A Workspace limit plus per-User and per-Service-Account limits | Bounds inference cost (§10); admin-only |
| Service Accounts and Keys | Create only for documented integrations; scope Keys to Collections where possible | Admin-only; Keys are stored as SHA-256 hashes |

## 6.3 Admin-enableable integrations and their boundary status

Each of these can be enabled by an administrator. Enabling any of them moves
Workspace data outside the assessed CUI boundary unless the customer
explicitly authorizes it. The software permits the choice; the authorization
and the risk belong to the customer (§5).

| Integration | Why it is outside the CUI boundary | CUI profile |
| ----------- | ---------------------------------- | ----------- |
| OpenRouter or any commercial LLM API provider | Prompts and Tool outputs transit a commercial service; export risk if accessible to unauthorized persons | Denied unless the customer issues a written authorization after export-control review |
| WebSearch providers (Exa, Firecrawl, Parallel, Tavily) | Query text leaves the boundary to a commercial API | Off |
| Third-party MCP servers | Tool calls and results go to an operator the customer has not assessed | Only internal, customer-operated MCP servers |
| Bundled SaaS plugins (Google, Slack, Atlassian, Context7) | OAuth-connected commercial services; content leaves the boundary; plugins execute in-process | None enabled |
| Share plugin | Anonymous readability of Session transcripts | Not loaded |
| Local Login | No external identity verification | Offered only in evaluation and development installations on a loopback origin |

## 6.4 Verification checklist

On AWS, run these from the applied environment directory on an operator
workstation with network access to the load balancer, the AWS CLI, and
Terraform 1.9 or later. Replace `<name>` with the installation's `name`
(default `bymorning`).

```sh
out() { terraform output -raw "$1"; }
task=$(aws ecs describe-services --cluster "$(out cluster)" --services "$(out service)" \
  --query 'services[0].taskDefinition' --output text)

# 1. Both containers run the digest in §15.
aws ecs describe-task-definition --task-definition "$task" \
  --query 'taskDefinition.containerDefinitions[].image' --output text   # both end in @sha256:<digest>

# 2. FIPS endpoints, internal load balancer, FIPS listener policy.
terraform output fips_endpoints                                          # true
lb=$(aws elbv2 describe-load-balancers --names "<name>-alb" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
aws elbv2 describe-load-balancers --load-balancer-arns "$lb" --query 'LoadBalancers[0].Scheme'   # internal
aws elbv2 describe-listeners --load-balancer-arn "$lb" \
  --query 'Listeners[?Port==`443`].SslPolicy' --output text              # ELBSecurityPolicy-TLS13-1-2-FIPS-2023-04

# 3. Health and headers.
curl -fsS "$(out origin)/system/health"                                  # ok
curl -sSI "$(out origin)/" | grep -i -e strict-transport-security -e content-security-policy

# 4. Host resolved line: storage s3, cipher = the KMS key ARN, fips=true, no mode=evaluation.
aws logs filter-log-events --log-group-name "$(out log_group)" \
  --filter-pattern '"Host resolved"' --query 'events[-1].message' --output text

# 5. CUI document selected, no evaluation flag, banner set.
aws ecs describe-task-definition --task-definition "$task" --output table \
  --query 'taskDefinition.containerDefinitions[?name==`gateway`].environment[?name==`BYMORNING_CONFIG` || name==`BYMORNING_EVALUATION` || name==`LOGIN_BANNER`]'
# expect BYMORNING_CONFIG=/app/bymorning.cui.jsonc, LOGIN_BANNER present, no BYMORNING_EVALUATION

# 6. One running task, ECS Exec off.
aws ecs describe-services --cluster "$(out cluster)" --services "$(out service)" \
  --query 'services[0].{running:runningCount,exec:enableExecuteCommand}'   # running=1, exec=false

# 7. Database encrypted, private, deletion-protected, backed up.
aws rds describe-db-instances --db-instance-identifier "$(out database_identifier)" \
  --query 'DBInstances[0].{enc:StorageEncrypted,public:PubliclyAccessible,del:DeletionProtection,multiAZ:MultiAZ,backups:BackupRetentionPeriod}'

# 8. Bucket blocks public access, uses SSE-KMS, and denies non-TLS requests.
bucket=$(aws ecs describe-task-definition --task-definition "$task" --output text \
  --query 'taskDefinition.containerDefinitions[?name==`gateway`].environment[?name==`STORAGE_BUCKET`].value')
aws s3api get-public-access-block --bucket "$bucket"
aws s3api get-bucket-encryption --bucket "$bucket"
aws s3api get-bucket-policy --bucket "$bucket" --query Policy --output text   # DenyInsecureTransport

# 9. Log groups are KMS-encrypted with the intended retention; the key rotates.
aws logs describe-log-groups --log-group-name-prefix "/bymorning/<name>" \
  --query 'logGroups[].{name:logGroupName,kms:kmsKeyId,days:retentionInDays}' --output table
aws logs describe-log-groups --log-group-name-prefix "/aws/rds/instance/<name>-db" \
  --query 'logGroups[].{name:logGroupName,kms:kmsKeyId,days:retentionInDays}' --output table
aws kms get-key-rotation-status --key-id "alias/<name>"                 # KeyRotationEnabled: true

# 10. FIPS runtime, re-verified locally on the mirrored image.
docker run --rm --platform linux/amd64 --entrypoint node <image> -p "require('node:crypto').getFips()"  # 1
```

On Azure, `smoke.sh --origin <origin>` reads the replica count, the `migrate`
init container, the environment, health, and sign-in headers. With `--temp`
it also exercises workload identity, Blob, Key Vault wrapping, and the
sandbox's deny-all egress. Confirm that the gateway log's `Host resolved`
line shows storage `azure-blob`, the versioned Key Vault key URL, and no
`mode=evaluation`.

In the Console, as Installation Admin, confirm the following. The Auth
Provider admits only the customer's domains, and the Installation Policy
admits only `amazon-bedrock` with provisioning `invite-only`. Share and web
search are off, and plugins are off or allowlisted. Confirm that WebFetch is
`ask` or `deny`, Spend Limits are set, Setup is complete, and the login
banner shows the approved text.

Record every failed check against the matching POA&M entry in §12, or open a
new action in the customer's own POA&M.
