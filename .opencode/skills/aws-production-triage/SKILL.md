---
name: AWS Production Triage
description: Diagnose production failures in AWS-hosted applications using read-only infrastructure, runtime, deployment, network, and dependency evidence. Use for incidents involving CloudFront, ECS, Lambda, RDS, load balancers, CloudWatch, SST, authentication callbacks, timeouts, retries, or behavior that differs from local development.
---

# AWS Production Triage

Find the **first failure**, not merely the final error shown to the user. Retries, redirects, consumed credentials, client disconnects, and fallback responses often hide the initiating defect.

## Safety Contract

Begin in read-only mode unless the user explicitly authorizes changes.

- Inspect the repository and deployed resources without editing either.
- Use AWS commands whose operation names begin with `get`, `describe`, `list`, `filter`, or `lookup`.
- Treat `curl` requests as probes: prefer `GET`, `HEAD`, and deliberately invalid non-mutating requests.
- Query environment variable and secret **names**, never values. Task definitions and stack outputs may contain plaintext secrets.
- Redact cookies, authorization codes, tokens, credentials, signed URLs, database connection strings, and request bodies.
- Do not reproduce a flow with another person's identity or consume a live one-time credential.

The safety contract is satisfied when every planned command is read-only and its output projection excludes secret values.

## Workflow

### 1. Establish The Incident Window

Record:

- user-visible symptom and URL;
- approximate timestamp and timezone;
- last known working environment;
- affected AWS account, region, stage, and deployment;
- whether retries, refreshes, or multiple tabs occurred.

If the timestamp is unknown, start with the latest relevant logs and expand backward. Never assume the last logged error initiated the incident.

This step is complete when there is a UTC search window and a concrete failing operation.

### 2. Map The Runtime Topology

Read infrastructure and request-path code before forming a root-cause conclusion. Trace:

```text
browser or caller
  -> DNS / CDN / CloudFront
  -> router / load balancer / API gateway
  -> ECS task / Lambda / service
  -> database, queue, identity provider, or external API
```

For each hop, identify:

- runtime and region;
- timeout and retry boundary;
- state written or consumed;
- relevant log source;
- deployment version;
- external network transition.

Use repository configuration as intent and AWS APIs as evidence of what is actually deployed. Read project instructions and architecture documentation when the behavior is domain-sensitive.

This step is complete when every hop from the public request to the terminal dependency has an owner, runtime, and evidence source.

### 3. Verify Identity And Deployment

Confirm the AWS caller before querying resources:

```sh
aws sts get-caller-identity --profile <profile>
```

Then identify the live distribution, service, task definition, image digest, deployment events, and log groups. Compare desired and running revisions. A failed rollout or rollback can make repository code newer than production.

Use the safe command patterns in `references/AWS.md`.

This step is complete when the exact running artifact and its deployment history are known.

### 4. Reproduce Each Boundary

Probe the public endpoint without automatically following redirects. Capture status, location, cache headers, timing, and CDN identifiers while redacting cookies:

```sh
curl -sS -D /tmp/headers -o /tmp/body --max-time 30 '<url>'
```

Probe external dependencies independently from an equivalent network location when possible. Repeat timing-sensitive probes several times; one successful request does not disprove tail-latency failures.

Distinguish:

- request rejected before reaching the application;
- application returned a controlled failure;
- upstream timed out;
- caller disconnected (`499` or interruption);
- dependency completed after the caller was gone.

This step is complete when each boundary is classified by status, latency, and responder.

### 5. Build A Request Timeline

Query a wider window than the visible failure. Include preceding logins, redirects, callbacks, retries, health checks, deployment events, and dependency events.

Order evidence by millisecond timestamp and annotate the operation stage. Look specifically for:

- a slow or interrupted request immediately before a fast failure;
- one-time codes, idempotency keys, or tokens consumed by the first request;
- retries that begin before the first request finishes;
- infrastructure state changes during the request;
- a timeout duration matching a configured boundary;
- a dependency becoming healthy immediately after the request aborts.

For RDS and Aurora, correlate application logs with cluster pause, resume, failover, maintenance, and connection events. For ECS, correlate with task starts, health failures, draining, and rollback events.

This step is complete when the initiating request and every consequential retry have separate entries in one UTC timeline.

### 6. Compare Working Topologies

When localhost, staging, or another application works, compare topology rather than only configuration.

Check differences in:

- ingress timeout;
- database lifecycle and warm state;
- region and network path;
- server-side verification versus decoding;
- cache lifetime and process reuse;
- callback host and forwarded headers;
- state-store consistency;
- client and server dependency versions;
- retry behavior.

A working path disproves a hypothesis only when it exercises the same code, infrastructure, state, and timing boundaries.

This step is complete when each working path has at least one explicit difference that could discriminate among hypotheses.

### 7. Challenge The Leading Theory

For non-trivial incidents, delegate independent investigations in parallel:

- one agent attempts to falsify the leading hypothesis;
- one traces the working and failing topologies;
- one ranks competing infrastructure and application causes;
- one deeply inspects the external dependency or protocol implementation.

Give agents exact repository paths, account/profile details, log groups, incident window, and the read-only constraint. Validate important subagent claims directly with primary evidence.

This step is complete when the leading theory has survived an explicit falsification attempt and conflicting findings are reconciled.

### 8. State Root Cause At The Right Layer

Separate:

- **initiating defect**: the first operation that became incorrect or too slow;
- **amplifier**: timeout, retry, race, cold start, or eventual consistency;
- **visible failure**: the final redirect, status, or generic error;
- **latent risk**: a real flaw not demonstrated in this incident.

Use confidence levels and name missing evidence. Do not promote a plausible architectural risk to root cause when the timeline demonstrates another initiating defect.

This step is complete when the conclusion explains the symptom, timing, environment specificity, and retry behavior without contradiction.

## Final Report

Report in this order:

1. Root cause, in one direct paragraph.
2. UTC timeline with durations and service events.
3. Why the failure is environment-specific.
4. Initiating defect, amplifiers, and visible failure.
5. Recommended fix ordered from causal fix to resilience improvements.
6. Evidence references: AWS resource names, log timestamps, and code locations.
7. Confidence and remaining uncertainty.
8. Explicit confirmation that no changes were made when operating read-only.

Never include secret values or raw authentication artifacts in the report.
