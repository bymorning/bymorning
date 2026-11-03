---
title: Operations Runbooks
---

# Operations Runbooks

The installer READMEs are the operational source of truth; this chapter
records the security-relevant steps and points at them. AWS commands assume
the applied Terraform environment of the AWS installer as the working
directory and an authenticated AWS CLI in the deployment account and Region.
Azure commands assume the Azure installer's environment and `kubectl` access
to the cluster.

## 14.1 Install

Follow the installer README with the secure configuration values in §6, and
leave `BYMORNING_EVALUATION` unset. Verify the image before it is used
(§8.4) and set the installer's image to the verified digest; the AWS
installer refuses a reference that is not pinned by digest. On AWS, set
`cui_profile = true` (which requires `code_interpreter = true`) for CUI
workloads. On both installers the `migrate` container applies packaged
migrations before the Gateway starts. Confirm `/system/health` returns `ok`,
then complete first sign-in (§14.2).

## 14.2 First sign-in and Auth Provider configuration

1. Read the Setup token. On AWS, the module generates it (or takes
   `setup_token`) and delivers it to the task as a container secret; read it
   with `terraform output -raw setup_token`. On Azure, either supply
   `SETUP_TOKEN` when creating the secret, or read the generated token from
   the owner-read-only file the `Auth Provider setup pending` log line names.
   Treat the token as a credential; it is the recovery path for a broken Auth
   Provider.
2. Open the application origin, go to Setup, and enter the token.
3. Register the application in the customer's identity provider with the
   redirect URI Setup shows (`https://<hostname>/auth/callback/<providerID>`),
   and enforce MFA there. In Setup, enter the issuer, client ID, client
   secret, and the admitted email domains.
4. Sign in with a test account. The first login after Setup becomes the
   Installation Admin. Grant the role to further named Accounts only as
   needed, and set the Installation Policy and Workspace settings per §6.

## 14.3 Upgrade and rollback

Verify the new release before it enters the account (§8.4) and review its
SBOM, vulnerability summary, and OpenVEX statement. Then follow the
installer's upgrade steps:

| Step | AWS installer | Azure installer |
| ---- | ------------- | --------------- |
| Back up | `aws rds create-db-snapshot --db-instance-identifier "$(terraform output -raw database_identifier)" --db-snapshot-identifier bymorning-before-<version>` | A database backup per the README's Rollback section |
| Deliver | Set `image` to the new digest | Push with the release's mirror script, then re-run the overlay script with the new digest |
| Apply | `terraform apply` with the installer from the same release | `kubectl apply -k` on the overlay |
| Behavior | The task is replaced; a task that never becomes healthy is rolled back by the deployment circuit breaker | The pod is replaced (`Recreate`); migrations run in the `migrate` init container |

Expect a short interruption, because one task or replica runs at a time
(POA&M-19). Confirm `/system/health` and spot-check sign-in.

Migrations only move forward, so an older image against a migrated database is
unsupported. To roll back a release that ran no migrations, set the previous
digest and apply. To roll back past a migration, restore the pre-upgrade
snapshot (AWS) or point-in-time backup (Azure) first, then deploy the previous
digest.

## 14.4 Backup and restore

On AWS, RDS takes automated backups with `backup_retention_days` (default 7),
copies tags to snapshots, and keeps a final snapshot when the instance is
destroyed. The storage bucket is versioned; noncurrent versions expire after
30 days and `tool-output/` objects after 7 days by design. On Azure, the
Flexible Server keeps point-in-time backups (14 days by default). Longer
retention, cross-account copies, and restore rehearsals are the customer's
responsibility (§5). The customer rehearses a restore in a non-production
installation and records the timings for its RTO and RPO statement.

Deleting a Project writes a durable purge intent in the same transaction. The
application drains intents at boot and every five minutes, deleting every
object under the Project's storage prefix; on AWS, prior versions then expire
under the 30-day lifecycle. Backup copies outside this path persist until
their own rotation, so purged Projects belong in the customer's backup-review
cadence (3.8.3).

## 14.5 Key rotation

| Key | Procedure | Effect |
| --- | --------- | ------ |
| `WEB_COOKIE_KEY` (session encryption) | AWS: `terraform apply -replace=module.bymorning.random_bytes.cookie`, then force a new deployment of the service. Azure: `terraform apply -replace=module.bymorning.random_id.cookie_key`, re-run the secret-creation script, and restart the Gateway | Invalidates every Login Session and signs out all users. Break-glass only; routine revocation uses the durable Login Session record (§14.8) |
| Database password | AWS: `terraform apply -replace=module.bymorning.random_password.database`, then force a new deployment. Azure: `terraform apply -replace=module.bymorning.random_password.postgres`, re-run the secret-creation script, and restart the Gateway | Brief interruption while the task restarts |
| `TLS_KEY` (AWS load balancer to task) | Automatic: the self-signed certificate is valid for a year and renews on any `terraform apply` within its last 30 days | The task definition change rolls the service |
| Public TLS certificate | ACM managed renewal (AWS); renew the ingress certificate Secret (Azure) | None if renewed in place |
| AWS installation KMS key | Automatic annual rotation is enabled; do not replace the key | Every earlier backing key stays under the same ARN, so the database, bucket, logs, secret, and Credential envelopes stay readable with no re-encryption |
| Azure Key Vault key | Automatic rotation policy; restart the Gateway after a rotation so it resolves the latest version. Never disable or delete old versions | Old versions keep unwrapping existing envelopes |
| Identity provider client secret | Rotate at the identity provider, then update the Auth Provider in the application | No downtime; in-flight sign-ins may fail once |

Every Credential envelope names the key that wrapped it, and the key backend
refuses any other key identity before calling the key service (SEC-CRYPT).
Replacing the key rather than rotating it therefore makes stored Credentials
unreadable. Such a Credential answers 503 (`Credential key is unavailable`)
rather than exposing or corrupting data, and the Gateway logs
`Credential key unavailable`.

## 14.6 Log review

Application logs are one event per line on standard error, in logfmt with
`timestamp=`, `level=`, and `run=` always present, followed by the message and
flattened annotation fields. On AWS they go to the KMS-encrypted log group
named by `terraform output -raw log_group`, with streams prefixed
`ecs/gateway/` and `ecs/migrate/`; the PostgreSQL log goes to its own
encrypted log group. On Azure, they are container logs, collected by Container
Insights when Log Analytics is enabled.

The Audit trail is reviewed in the application by Workspace administrators for
their own Workspace and installation-wide by the Installation Admin
(SEC-AUDIT). Every committed Entry is also written as one JSON line with
`"type":"audit.entry"`, so SIEM ingestion needs no database access. CloudWatch
Logs Insights examples against the application log group:

```text
# All Audit Entries, newest first
fields @timestamp, action, actor.type, actor.accountID, workspaceID, target, outcome
| filter type = "audit.entry"
| sort @timestamp desc | limit 100

# Failed security events and installation-scope changes
fields @timestamp, action, actor.accountID, target, outcome
| filter type = "audit.entry" and (outcome = "failure" or action like /^(installation|account)\./)

# Startup refusals and the resolved backends (storage, key, Region, FIPS flag)
fields @timestamp, @logStream, @message
| filter @message like /Startup failed|Host resolved/
| sort @timestamp desc

# Conditions to alarm on
fields @timestamp, @message
| filter @message like /Project.purge failed|Cipher migration failed|Credential key unavailable|Cipher refused/
```

Each alarm condition is retried or fails closed, and each indicates a storage
or key-service problem to investigate. The installers configure no alarms,
load balancer access logs, or CloudTrail data events; the customer adds them
with its account standards and reviews them alongside these logs (§5).

## 14.7 Account offboarding

Disable the person at the customer's identity provider, which blocks new
logins immediately; existing sessions end at the absolute bound (12 hours by
default) or can be revoked now (§14.8). In the application, a Workspace admin
removes the Workspace membership, which deletes the member's Workspace OAuth
grants, retains their Sessions, and pauses their Scheduled Tasks. For a full
departure the Installation Admin suspends the Account, which revokes all Login
Sessions and OAuth grants installation-wide immediately (SEC-INST). Restore
reverses suspension, and removed memberships stay as the record. Reassign
member-owned Scheduled Tasks and Sessions where needed, delete Service
Accounts and Keys that are no longer required, review the logs for activity
after the termination time (§14.6), and record the action in the customer's
account-lifecycle system (3.5.6, 3.9.2).

## 14.8 Emergency procedures

Revoke sessions targeted first, globally only as break-glass. A user revokes
one session from the account menu's Login sessions list, and sign-out revokes
the current session. The Installation Admin suspends an Account to revoke
every Login Session and OAuth grant of that Account in one pass (SEC-SESS).
As a global break-glass, rotate `WEB_COOKIE_KEY` (§14.5): every cookie becomes
undecryptable and all users re-authenticate. Idle sessions are refused after
`SESSION_IDLE_TIMEOUT` (default 15 minutes), and all sessions end at
`SESSION_ABSOLUTE_TIMEOUT` (default 12 hours).

To disable integrations, set `providers.allow` to the approved providers, or
to `[]` to halt all inference. Turn off Outbound MCP Enablement per server,
which prevents connection and Tool discovery. Disable the Share plugin after
reviewing and unsharing active links. As network-level kill switches, restrict
the task's egress, suspend sign-ins at the identity provider, or stop the
Gateway (`aws ecs update-service --desired-count 0` on AWS; scale the
deployment to zero replicas on Azure).

To preserve incident evidence, do not redeploy or destroy the installation. If
a redeploy is unavoidable, first export the application and database logs to
a dedicated encrypted, versioned evidence store. Snapshot the database,
preserve storage object versions (suspending lifecycle expiry on the affected
prefixes if needed), and record the running image digest, task or pod IDs,
`run` IDs from the logs, and the cloud audit-trail event IDs. Where DFARS
252.204-7012 applies, the customer owns the 72-hour report and 90-day media
preservation. Report a suspected ByMorning vulnerability or compromised
release through the private channel in §13.3.

If a migration fails, the new task or pod does not become healthy; on AWS the
deployment circuit breaker rolls back. Read the `migrate` container's log
(stream prefix `ecs/migrate/` on AWS), fix the cause, and re-deploy the
previous known-good digest per §14.3.

## 14.9 Uninstall

Export anything the customer must keep first. On AWS, set
`database.deletion_protection = false` and apply, empty the storage bucket
including every object version, then run `terraform destroy`. RDS keeps a final
snapshot, and the KMS key enters a 30-day deletion window; keep the key for as
long as that snapshot is needed. On Azure, delete the overlay with
`kubectl delete -k`, then run `terraform destroy`. Key Vault keeps the vault
and key in soft delete for 90 days with purge protection.
