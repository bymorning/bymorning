import { Effect, Schema } from "effect"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import type { Credentials } from "./credentials.js"
import { container, createdLabel, selector, type Pod } from "./manifest.js"
import type { Resolved } from "./options.js"

/** A Kubernetes API failure. `status` is the HTTP status, or 0 when the server was unreachable. */
export class ClusterError extends Schema.TaggedError<ClusterError>()("KubernetesCodeInterpreter.ClusterError", {
  status: Schema.Number,
  reason: Schema.String,
  message: Schema.String,
}) {}

interface Reply {
  readonly status: number
  readonly body: unknown
}

const requestTimeout = 30_000

/** Minimal Kubernetes REST client: only the calls the Role in deploy/ permits. */
export const make = (credentials: Credentials, options: Pick<Resolved, "namespace" | "installation">) => {
  const call = (method: string, path: string, body?: unknown, query?: Record<string, string>) =>
    Effect.callback<Reply, ClusterError>((resume, signal) => {
      const target = new URL(credentials.server)
      target.pathname = `${target.pathname.replace(/\/$/, "")}${path}`
      if (query !== undefined) target.search = new URLSearchParams(query).toString()
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const token = credentials.token()
      const send = target.protocol === "http:" ? httpRequest : httpsRequest
      const outgoing = send(
        target,
        {
          method,
          signal,
          timeout: requestTimeout,
          headers: {
            Accept: "application/json",
            ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
            ...(payload === undefined ? {} : { "Content-Type": "application/json", "Content-Length": payload.length }),
          },
          ...(credentials.ca === undefined ? {} : { ca: credentials.ca }),
          ...(credentials.cert === undefined ? {} : { cert: credentials.cert }),
          ...(credentials.key === undefined ? {} : { key: credentials.key }),
          rejectUnauthorized: !credentials.insecure,
        },
        (response) => {
          const parts: Buffer[] = []
          response.on("data", (part: Buffer) => parts.push(part))
          response.on("error", (cause) =>
            resume(Effect.fail(new ClusterError({ status: 0, reason: "Unreachable", message: cause.message }))),
          )
          response.on("end", () => {
            const raw = Buffer.concat(parts).toString("utf8")
            let parsed: unknown = undefined
            try {
              parsed = raw === "" ? undefined : JSON.parse(raw)
            } catch {}
            resume(Effect.succeed({ status: response.statusCode ?? 0, body: parsed }))
          })
        },
      )
      outgoing.on("timeout", () => outgoing.destroy(new Error("Kubernetes API request timed out")))
      outgoing.on("error", (cause) =>
        resume(Effect.fail(new ClusterError({ status: 0, reason: "Unreachable", message: cause.message }))),
      )
      outgoing.end(payload)
    })

  const ok = (reply: Reply) => {
    if (reply.status >= 200 && reply.status < 300) return Effect.succeed(reply.body)
    const status = (typeof reply.body === "object" && reply.body !== null ? reply.body : {}) as {
      reason?: unknown
      message?: unknown
    }
    return Effect.fail(
      new ClusterError({
        status: reply.status,
        reason: typeof status.reason === "string" ? status.reason : `HTTP ${reply.status}`,
        message: typeof status.message === "string" ? status.message : `Kubernetes API returned HTTP ${reply.status}`,
      }),
    )
  }
  const base = `/api/v1/namespaces/${encodeURIComponent(options.namespace)}`

  return {
    credentials,
    create: (manifest: Pod) => call("POST", `${base}/pods`, manifest).pipe(Effect.flatMap(ok)),
    get: (name: string) =>
      call("GET", `${base}/pods/${encodeURIComponent(name)}`).pipe(
        Effect.flatMap(ok),
        Effect.map((body) => body as PodStatus),
      ),
    /** Not found is success: the pod may already be gone. Grace period 0 kills the pod immediately. */
    remove: (name: string) =>
      call("DELETE", `${base}/pods/${encodeURIComponent(name)}`, {
        gracePeriodSeconds: 0,
        propagationPolicy: "Background",
      }).pipe(Effect.flatMap((reply) => (reply.status === 404 ? Effect.void : ok(reply).pipe(Effect.asVoid)))),
    list: () =>
      call("GET", `${base}/pods`, undefined, { labelSelector: selector(options) }).pipe(
        Effect.flatMap(ok),
        Effect.map((body) => ((body as { items?: ReadonlyArray<PodStatus> }).items ?? []) as ReadonlyArray<PodStatus>),
      ),
    policies: () =>
      call(
        "GET",
        `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(options.namespace)}/networkpolicies`,
      ).pipe(
        Effect.flatMap(ok),
        Effect.map(
          (body) => ((body as { items?: ReadonlyArray<NetworkPolicy> }).items ?? []) as ReadonlyArray<NetworkPolicy>,
        ),
      ),
  }
}
export type Cluster = ReturnType<typeof make>

/** The parts of a Pod read back from the API server. */
export interface PodStatus {
  readonly metadata?: {
    readonly name?: string
    readonly labels?: Readonly<Record<string, string>>
    readonly creationTimestamp?: string
  }
  readonly status?: {
    readonly phase?: string
    readonly reason?: string
    readonly message?: string
    readonly conditions?: ReadonlyArray<{ type?: string; status?: string; reason?: string; message?: string }>
    readonly containerStatuses?: ReadonlyArray<{
      name?: string
      ready?: boolean
      state?: { waiting?: { reason?: string; message?: string }; terminated?: { reason?: string; exitCode?: number } }
    }>
  }
}

export interface Selector {
  readonly matchLabels?: Readonly<Record<string, string>>
  readonly matchExpressions?: ReadonlyArray<{ key: string; operator: string; values?: ReadonlyArray<string> }>
}
export interface NetworkPolicy {
  readonly metadata?: { readonly name?: string }
  readonly spec?: {
    readonly podSelector?: Selector
    readonly policyTypes?: ReadonlyArray<string>
    readonly ingress?: ReadonlyArray<unknown>
    readonly egress?: ReadonlyArray<unknown>
  }
}

/** Progress of a pod towards running its container: ready, still waiting, or failed with a reason. */
export type Readiness =
  | { readonly type: "ready" }
  | { readonly type: "waiting"; readonly detail: string }
  | { readonly type: "failed"; readonly detail: string }

const fatalWaiting = new Set([
  "ErrImagePull",
  "ErrImageNeverPull",
  "ImagePullBackOff",
  "InvalidImageName",
  "CreateContainerConfigError",
  "CreateContainerError",
  "RunContainerError",
])

export const readiness = (pod: PodStatus): Readiness => {
  const status = pod.status
  if (status?.phase === "Failed" || status?.phase === "Succeeded")
    return {
      type: "failed",
      detail: `pod ${status.phase}${status.reason ? ` (${status.reason})` : ""}${status.message ? `: ${status.message}` : ""}`,
    }
  const main = status?.containerStatuses?.find((entry) => entry.name === container)
  const waiting = main?.state?.waiting
  if (waiting?.reason !== undefined && fatalWaiting.has(waiting.reason))
    return { type: "failed", detail: `${waiting.reason}${waiting.message ? `: ${waiting.message}` : ""}` }
  if (status?.phase === "Running" && main?.ready === true) return { type: "ready" }
  const scheduled = status?.conditions?.find((entry) => entry.type === "PodScheduled" && entry.status === "False")
  return {
    type: "waiting",
    detail: scheduled?.message ?? waiting?.reason ?? status?.phase ?? "Pending",
  }
}

/** Seconds since the pod was created, from our label (or the API timestamp when absent), or undefined if unknowable. */
export const age = (pod: PodStatus, now: Date): number | undefined => {
  const label = Number(pod.metadata?.labels?.[createdLabel])
  if (Number.isInteger(label) && label > 0) return now.getTime() / 1000 - label
  const created =
    pod.metadata?.creationTimestamp === undefined ? Number.NaN : Date.parse(pod.metadata.creationTimestamp)
  return Number.isNaN(created) ? undefined : (now.getTime() - created) / 1000
}

/** Kubernetes label-selector semantics for a NetworkPolicy podSelector. An empty selector selects every pod. */
export const matches = (selector: Selector | undefined, labels: Readonly<Record<string, string>>) => {
  for (const [key, value] of Object.entries(selector?.matchLabels ?? {})) if (labels[key] !== value) return false
  for (const expression of selector?.matchExpressions ?? []) {
    const value = labels[expression.key]
    const values = expression.values ?? []
    if (expression.operator === "In" && (value === undefined || !values.includes(value))) return false
    if (expression.operator === "NotIn" && value !== undefined && values.includes(value)) return false
    if (expression.operator === "Exists" && value === undefined) return false
    if (expression.operator === "DoesNotExist" && value !== undefined) return false
  }
  return true
}

/**
 * Whether the namespace's policies contain a deny-all for the plugin's pods. NetworkPolicies are additive, so
 * every policy selecting the pods must be free of ingress and egress allow rules, and at least one must cover
 * both directions. This proves configuration, not enforcement: the CNI must still enforce NetworkPolicy.
 */
export const isolation = (
  policies: ReadonlyArray<NetworkPolicy>,
  labels: Readonly<Record<string, string>>,
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  const selecting = policies.filter((policy) => matches(policy.spec?.podSelector, labels))
  if (selecting.length === 0)
    return { ok: false, message: "no NetworkPolicy in the sandbox namespace selects the sandbox pods" }
  const open = selecting.find(
    (policy) => (policy.spec?.ingress?.length ?? 0) > 0 || (policy.spec?.egress?.length ?? 0) > 0,
  )
  if (open !== undefined)
    return {
      ok: false,
      message: `NetworkPolicy ${open.metadata?.name ?? "(unnamed)"} allows traffic to or from the sandbox pods`,
    }
  const directions = new Set(
    selecting.flatMap(
      (policy) => policy.spec?.policyTypes ?? ["Ingress", ...(policy.spec?.egress === undefined ? [] : ["Egress"])],
    ),
  )
  if (!directions.has("Egress") || !directions.has("Ingress"))
    return { ok: false, message: "no NetworkPolicy denies both ingress and egress for the sandbox pods" }
  return { ok: true }
}
