# AWS Read-Only Query Patterns

Project-specific names should be discovered rather than guessed. Keep `--profile` and `--region` explicit.

## Identity And CloudFront

```sh
aws sts get-caller-identity --profile <profile>

aws cloudfront list-distributions \
  --profile <profile> \
  --query "DistributionList.Items[?DomainName=='<domain>'].{Id:Id,Domain:DomainName,Status:Status,Origins:Origins.Items[*].DomainName}"

aws cloudfront get-distribution-config \
  --profile <profile> \
  --id <distribution-id> \
  --query '{Default:DistributionConfig.DefaultCacheBehavior,Ordered:DistributionConfig.CacheBehaviors.Items,Origins:DistributionConfig.Origins.Items}'
```

Inspect origin read timeouts, cache policies, origin request policies, functions, and forwarded cookies/query strings.

## ECS

```sh
aws ecs list-clusters --profile <profile> --region <region>

aws ecs list-services \
  --profile <profile> \
  --region <region> \
  --cluster <cluster>

aws ecs describe-services \
  --profile <profile> \
  --region <region> \
  --cluster <cluster> \
  --services <service> \
  --query 'services[0].{taskDefinition:taskDefinition,deployments:deployments,events:events[0:20]}'

aws ecs list-tasks \
  --profile <profile> \
  --region <region> \
  --cluster <cluster> \
  --service-name <service> \
  --desired-status RUNNING

aws ecs describe-tasks \
  --profile <profile> \
  --region <region> \
  --cluster <cluster> \
  --tasks <task-arn> \
  --query 'tasks[*].{startedAt:startedAt,taskDefinition:taskDefinitionArn,health:healthStatus,lastStatus:lastStatus,containers:containers[*].{image:image,imageDigest:imageDigest}}'
```

When inspecting a task definition, project only safe metadata. Environment values can contain plaintext secrets:

```sh
aws ecs describe-task-definition \
  --profile <profile> \
  --region <region> \
  --task-definition <task-definition> \
  --query 'taskDefinition.containerDefinitions[*].{name:name,image:image,environmentNames:environment[*].name,secretNames:secrets[*].name,log:logConfiguration.options}'
```

## CloudWatch Logs

Find log groups and streams:

```sh
aws logs describe-log-groups \
  --profile <profile> \
  --region <region> \
  --log-group-name-pattern <pattern> \
  --query 'logGroups[*].{name:logGroupName,retention:retentionInDays,stored:storedBytes}'

aws logs describe-log-streams \
  --profile <profile> \
  --region <region> \
  --log-group-name <group> \
  --order-by LastEventTime \
  --descending \
  --max-items 20
```

Query an exact UTC window. Epoch values are milliseconds:

```sh
aws logs filter-log-events \
  --profile <profile> \
  --region <region> \
  --log-group-name <group> \
  --start-time <epoch-ms> \
  --end-time <epoch-ms> \
  --query 'events[*].{time:timestamp,message:message,stream:logStreamName}'
```

Start broad enough to capture the initiating request. Narrow to a stream only after identifying it.

## RDS And Aurora

```sh
aws rds describe-db-clusters \
  --profile <profile> \
  --region <region> \
  --query 'DBClusters[*].{id:DBClusterIdentifier,status:Status,engine:Engine,mode:ServerlessV2ScalingConfiguration,members:DBClusterMembers[*].DBInstanceIdentifier}'

aws rds describe-events \
  --profile <profile> \
  --region <region> \
  --source-type db-cluster \
  --source-identifier <cluster-id> \
  --start-time <iso-utc> \
  --end-time <iso-utc> \
  --query 'Events[*].{Date:Date,Message:Message}'
```

Also query `db-instance` events when cluster events do not expose pause, resume, failover, or maintenance details.

## CloudFormation And SST

```sh
aws cloudformation list-stacks \
  --profile <profile> \
  --region <region> \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE
```

Read `.sst/outputs.json`, `sst.config.ts`, and `infra/` files as deployment intent. Treat generated state and task definitions as potentially secret-bearing and project only required fields.

## Timing Probes

Repeat probes to expose tail latency:

```sh
for i in 1 2 3 4 5; do
  curl -sS --max-time 25 -o /dev/null \
    -w "$i status=%{http_code} total=%{time_total} size=%{size_download}\n" \
    '<url>' || true
done
```

Run IPv4 and IPv6 separately only when diagnosing DNS or network-family behavior:

```sh
curl -4 -sS --max-time 25 -o /dev/null -w '%{http_code} %{time_total}\n' '<url>'
curl -6 -sS --max-time 25 -o /dev/null -w '%{http_code} %{time_total}\n' '<url>'
```

## Evidence Discipline

- Convert every source to UTC before correlation.
- Preserve millisecond precision.
- Match observed durations to configured timeout boundaries.
- Search before and after the visible error.
- Treat `499`, interruption, and connection reset as caller-abort evidence, not necessarily application defects.
- Confirm whether a one-time credential was consumed before a retry.
- Validate subagent findings with AWS output or source code before reporting them.
