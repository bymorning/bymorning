# Kubernetes Code Interpreter

`@bymorning/plugin-code-interpreter-kubernetes` registers the `kubernetes` implementation of Code Interpreter. Like the
Docker and AgentCore implementations, it runs one command or source program per call in a fresh environment and keeps no
state between calls. Here the environment is one pod in a dedicated namespace. It is created for the call and deleted when
the call ends, however it ends.

The plugin is packaged in the Gateway image (`app/host`) but not enabled by any shipped installation document. A
deployment opts in through its `BYMORNING_CONFIG` document (see "Enabling it" below).

## Contract (identical to the Docker plugin)

| Aspect            | Behavior                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input             | `ExecuteInput`: `command` runs `/bin/sh -c`; `code` runs Python under `python3`, JavaScript and TypeScript under `bun` (the Docker mapping)                                                  |
| Output            | `{ stdout, stderr, exitCode }`. A non-zero exit is output, not an error. Streams are kept separate                                                                                           |
| Output limit      | 100,000 characters combined, enforced while streaming. Over the limit: `ExecutionError{output}` and the pod is deleted                                                                       |
| Project files     | None staged. Like Docker, the Tool sends file contents as `code`; nothing persists between calls                                                                                             |
| Working directory | `/work` (memory-backed, 64 MiB), plus `/tmp` (64 MiB). The root filesystem is read-only                                                                                                      |
| Code size         | Unbounded: code travels on the exec stdin stream (`head -c <bytes> > /work/main.py && exec python3 ...`), not argv, environment, a Secret or a ConfigMap                                     |
| Timeouts          | The program is limited to `timeoutSeconds` (default 120, the Tool's own limit). The kubelet also kills the pod after `startTimeoutSeconds + timeoutSeconds + 30` even if the Gateway is gone |

## Error mapping

| Situation                                                                                                                                   | `ExecutionError.operation`                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| No implementation selected                                                                                                                  | `CodeInterpreter.UnavailableError` (Core, unchanged)                          |
| API refuses pod creation (RBAC, quota, Pod Security, missing RuntimeClass or service account), API unreachable                              | `start`                                                                       |
| Image pull failure, bad image, pod failed, not running within `startTimeoutSeconds` (reason from the pod is included)                       | `start`                                                                       |
| NetworkPolicy required but absent or permissive; pod can still reach the network at the start deadline                                      | `start`                                                                       |
| Exec refused (403, missing `pods/exec` verbs) or the connection failed; program exceeded `timeoutSeconds`; exec could not start the command | `invoke`                                                                      |
| Exec closed with no status, malformed frame, unsupported subprotocol                                                                        | `stream`                                                                      |
| More than 100,000 characters                                                                                                                | `output`                                                                      |
| Cancellation                                                                                                                                | fiber interruption; pod deleted; no error value                               |
| Pod deletion failure                                                                                                                        | logged warning only; the kubelet deadline and the orphan sweep remove the pod |

## Pod lifecycle

1. Verify (cached for 60 s) that a deny-all NetworkPolicy selects the sandbox pods, when `requireNetworkPolicy` is on.
2. Register a deletion finalizer, then create the pod `bymorning-exec-<uuid>` (before create, so an interrupted request cannot
   leak a pod). The main process is `sleep`, so the pod idles.
3. Poll until the container is ready (`watch` is not granted). Permanent failures (`ErrImagePull`, `ErrImageNeverPull`,
   `InvalidImageName`, ...) fail immediately with the reason.
4. Egress canary (`verifyEgress`, default on): inside the pod, try to connect to the API server address Kubernetes injects.
   Retry until the connection fails, then run the program. See "Network isolation".
5. Exec the program over the `pods/exec` WebSocket (`v5.channel.k8s.io`, falling back to `v4.channel.k8s.io`), channels
   stdout 1, stderr 2, status 3. The exit code comes from the status channel.
6. Delete the pod with grace period 0 (success, failure, timeout, interruption).

Pods carry labels `app.kubernetes.io/managed-by=bymorning-code-interpreter`, `bymorning.io/installation=<installation>`,
`bymorning.io/created-at=<epoch seconds>` and `bymorning.io/session=<hash of the session name>`, and the annotation
`bymorning.io/session-name`.

**Restart recovery.** At plugin activation, and at most every 5 minutes afterwards on an execution, the plugin lists pods with
its managed-by and installation labels and deletes those older than `startTimeoutSeconds + timeoutSeconds + 90`. Give every
Gateway installation that shares a namespace a different `installation`. Replicas of one installation may share one value.

## Isolation: what each layer actually gives

| Layer                                                                              | Provides                                                                                                                                                                                                                                                                                                         | Does not provide                                                                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Pod spec (this plugin)                                                             | Non-root numeric UID, read-only root, all capabilities dropped, no privilege escalation, seccomp `RuntimeDefault`, no service account token, no service links, no host namespaces or paths, no Secrets or ConfigMaps mounted, CPU, memory and ephemeral-storage requests equal to limits, `emptyDir` size limits | A PID limit (kubelet `podMaxPids`, node-pool level). Any protection against a kernel or runtime escape                                   |
| Namespace Pod Security Admission `restricted` (`deploy/namespace.yaml`)            | The API server rejects any pod that is not restricted, whatever the plugin sends                                                                                                                                                                                                                                 | Anything beyond pod-spec policy                                                                                                          |
| Deny-all NetworkPolicy (`deploy/network-policy.yaml`)                              | Blocks ingress and egress: DNS, the pod network, the API server, cloud metadata endpoints                                                                                                                                                                                                                        | Enforcement is done by the cluster's CNI, not by this plugin. If the CNI does not enforce NetworkPolicy, the pod has full network access |
| Plugin checks (`requireNetworkPolicy`, `verifyEgress`)                             | Refuse to run when no deny-all policy selects the pods, when another policy allows traffic, or when a pod can reach the API server address                                                                                                                                                                       | Proof of enforcement for every destination. The canary tests one destination                                                             |
| `runtimeClassName` (for example AKS pod sandboxing `kata-vm-isolation`, or gVisor) | A VM or user-space-kernel boundary per pod, when the runtime is installed                                                                                                                                                                                                                                        | Availability in your cloud and region is the operator's to confirm. It is not enabled by default                                         |
| Ordinary containers (`runtimeClassName` unset)                                     | Namespace, cgroup, seccomp and capability isolation of a hardened `runc` container                                                                                                                                                                                                                               | VM-grade isolation. All sandbox pods share the node kernel                                                                               |

Findings that shaped the design (kind v0.33.0, Kubernetes 1.37.0, kindnet):

- **A pod can be Ready before its NetworkPolicy is enforced.** In the first seconds of a pod's life the sandbox reached the
  pod network and the API server; a few seconds later the same probe was blocked. That is why the egress canary exists and
  why it fails closed at the start deadline. It costs about one second per call on CNIs that drop packets, less where they
  reject. Kubernetes injects `KUBERNETES_SERVICE_HOST` even when `enableServiceLinks` is false, which the canary uses.
- kindnet in kind v0.33.0 enforces NetworkPolicy (via `kube-network-policies`). Older kind releases did not.
- `pods/exec` over WebSocket needed both `get` and `create` (each alone was refused with 403).

The execution image contains no ByMorning secrets or credentials. **No FIPS or other compliance claim is made for code
that runs inside it.** The default image is `python:3.12-slim` plus Bun. A FIPS-enabled node pool covers node kernel
cryptography only, not container userland. The plugin itself uses `ws` for the exec WebSocket; it was not tested under an
OpenSSL FIPS provider.

## Access to the cluster

- **In-cluster (default).** `KUBERNETES_SERVICE_HOST`/`PORT`, the projected service account token (re-read on every request,
  since it rotates) and `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`. Activation fails if they are absent.
- **kubeconfig (local testing).** `kubeconfig` names a file on the Gateway host; `kubeContext` picks a context. Server, CA
  (inline or file), bearer token or client certificate are supported. `exec` and `auth-provider` credential plugins are not
  supported and are refused.

## Options

Non-secret only. Blank form values count as unset. Structured options (`nodeSelector`, `tolerations`) are set in JSONC
configuration and do not appear in the form.

| Option                              | Default               | Meaning                                                                              |
| ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `image`                             | required              | Execution image. Must be `name@sha256:<64 hex>` unless `requireImageDigest` is false |
| `requireImageDigest`                | `true`                | Set `false` only for local testing with a tag                                        |
| `imagePullPolicy`                   | `IfNotPresent`        | `IfNotPresent`, `Always` or `Never`                                                  |
| `imagePullSecret`                   | none                  | Name of an image pull Secret in the sandbox namespace                                |
| `namespace`                         | `bymorning-sandbox`   | Dedicated sandbox namespace (never the Gateway's)                                    |
| `serviceAccountName`                | `bymorning-sandbox`   | Unbound service account for sandbox pods. Its token is never mounted                 |
| `runtimeClassName`                  | none                  | For example `kata-vm-isolation`                                                      |
| `nodeSelector`                      | none                  | Map of node labels                                                                   |
| `tolerations`                       | none                  | Kubernetes tolerations                                                               |
| `installation`                      | `default`             | Label scoping the orphan sweep (label-value syntax)                                  |
| `runAsUser`                         | `1000`                | Numeric user; must match the image (`Dockerfile.execution` uses 1000)                |
| `cpu`, `memory`, `ephemeralStorage` | `1`, `512Mi`, `256Mi` | Requests and limits (equal)                                                          |
| `scratchSize`                       | `64Mi`                | Size of the memory-backed `/work` and `/tmp`. They count toward the memory limit     |
| `startTimeoutSeconds`               | `60` (5 to 600)       | Wait for the pod to run and for the egress canary                                    |
| `timeoutSeconds`                    | `120` (1 to 3600)     | Program run time                                                                     |
| `requireNetworkPolicy`              | `true`                | Refuse to run unless a deny-all NetworkPolicy selects the pods                       |
| `verifyEgress`                      | `true`                | Confirm egress is blocked inside each pod before running code                        |
| `kubeconfig`, `kubeContext`         | none                  | Local testing (see above)                                                            |

## Kubernetes objects (`deploy/`)

Apply with `kubectl apply -k plugins/code-interpreter-kubernetes/deploy` after editing the RoleBinding subject to the
Gateway's service account and namespace.

| File                  | Purpose                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `namespace.yaml`      | `bymorning-sandbox` with Pod Security Admission `restricted` (enforce, audit, warn)                      |
| `serviceaccount.yaml` | Unbound `bymorning-sandbox` service account with token automount off                                     |
| `rbac.yaml`           | Namespaced Role and RoleBinding for the Gateway's service account                                        |
| `network-policy.yaml` | Deny all ingress and egress for every pod in the namespace                                               |
| `resource-quota.yaml` | Optional ResourceQuota (10 pods) and LimitRange; listed in `kustomization.yaml`, remove it there to omit |

Role (verified against a live API server, including that each rule is necessary and nothing broader is granted):

```yaml
rules:
  - { apiGroups: [""], resources: ["pods"], verbs: ["create", "get", "list", "delete"] }
  - { apiGroups: [""], resources: ["pods/exec"], verbs: ["get", "create"] }
  - { apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["get", "list"] } # only for requireNetworkPolicy
```

No `watch`, `pods/log`, `pods/attach`, Secrets, ConfigMaps, Jobs, update or patch, and no ClusterRole. The Gateway identity can
exec into any pod in the sandbox namespace, so the namespace must hold nothing else.

## Enabling it

The image already packages the plugin (`app/host/package.json` lists it; `packages/server/script/build.mjs` bundles
every `@bymorning/plugin-*` dependency of the host). Name it in the installation document `BYMORNING_CONFIG` points at
and select it; the host refuses to start when `kubernetes` is selected without a digest-pinned `image`:

```jsonc
{
  "plugins": [
    {
      "package": "@bymorning/plugin-code-interpreter-kubernetes",
      "options": {
        "image": "<registry>/bymorning-code-interpreter@sha256:<digest>",
        "runtimeClassName": "kata-vm-isolation", // omit for ordinary containers
        "nodeSelector": { "kubernetes.azure.com/agentpool": "sandbox" },
        "tolerations": [{ "key": "sandbox", "operator": "Exists", "effect": "NoSchedule" }],
        "installation": "prod",
      },
    },
  ],
  "code_interpreter": { "implementation": "kubernetes" },
}
```

If the host enforces a plugin allowlist (`plugins.allow`), add the package to it.

## Tests

From this directory:

- `bun run test` runs the unit tests: pod spec, options, program construction, NetworkPolicy evaluation, credentials, and
  the exec transport, execution, sweep and error mapping against an in-process fake API server. The integration tests
  are skipped.
- `KIND_INTEGRATION=1 bun run test` also runs `test/kind.test.ts` against a real cluster. It needs Docker, `kind` and `kubectl`
  on `PATH`. It creates the cluster `bymorning-k8s-test` from the pinned node image
  `kindest/node:v1.37.0@sha256:a1ed56cf...` (kind v0.33.0), builds `app/host/Dockerfile.execution`, loads it, applies
  `deploy/`, and connects as the Gateway service account only. It deletes a cluster it created unless `KIND_KEEP=1`. Set
  `KIND_CLUSTER` to reuse a named cluster. It covers: python, javascript, typescript and shell, split streams, exit codes,
  restricted pod attributes (uid, read-only root, no capabilities, no new privileges, seccomp, no token), code over 1 MiB,
  output limit, timeout, cancellation, egress denial with a control pod, Role sufficiency and minimality, Pod Security
  Admission rejection, exec subprotocols and exit shapes, orphan sweep, NetworkPolicy refusal, and start failures.
- `packages/testing/test/code-interpreter-kubernetes.test.ts` loads the package through the real Workspace plugin loader.

Not covered by any test: AKS, Kata, gVisor, Azure Network Policy Manager, Calico or Cilium, FIPS mode, and other Kubernetes
versions.
