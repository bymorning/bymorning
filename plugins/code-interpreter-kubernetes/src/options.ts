import { Schema } from "effect"

const label = /^([A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?)?$/
const dns = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/
const quantity = /^[0-9]+(\.[0-9]+)?(m|k|Ki|M|Mi|G|Gi|T|Ti)?$/

/** Blank form values mean "not configured". */
const optionalString = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(Schema.Union([Schema.Literal(""), schema]))
const name = Schema.String.check(Schema.isPattern(dns))
const quantities = Schema.String.check(Schema.isPattern(quantity))
const seconds = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum, maximum }))

export const Toleration = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  operator: Schema.optionalKey(Schema.Literals(["Exists", "Equal"])),
  value: Schema.optionalKey(Schema.String),
  effect: Schema.optionalKey(Schema.Literals(["NoSchedule", "PreferNoSchedule", "NoExecute"])),
  tolerationSeconds: Schema.optionalKey(Schema.Number),
})
export type Toleration = typeof Toleration.Type

/**
 * Non-secret plugin options. Cluster credentials are never options: in-cluster access uses the pod's service
 * account token, and `kubeconfig` names a file on the Gateway host.
 */
export const Options = Schema.Struct({
  namespace: Schema.optionalKey(name),
  image: Schema.NonEmptyString,
  requireImageDigest: Schema.optionalKey(Schema.Boolean),
  imagePullPolicy: optionalString(Schema.Literals(["IfNotPresent", "Always", "Never"])),
  imagePullSecret: optionalString(name),
  serviceAccountName: optionalString(name),
  runtimeClassName: optionalString(name),
  nodeSelector: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  tolerations: Schema.optionalKey(Schema.Array(Toleration)),
  installation: optionalString(Schema.String.check(Schema.isPattern(label))),
  runAsUser: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 })),
  ),
  cpu: optionalString(quantities),
  memory: optionalString(quantities),
  ephemeralStorage: optionalString(quantities),
  scratchSize: optionalString(quantities),
  startTimeoutSeconds: Schema.optionalKey(seconds(5, 600)),
  timeoutSeconds: Schema.optionalKey(seconds(1, 3600)),
  requireNetworkPolicy: Schema.optionalKey(Schema.Boolean),
  verifyEgress: Schema.optionalKey(Schema.Boolean),
  kubeconfig: optionalString(Schema.NonEmptyString),
  kubeContext: optionalString(Schema.NonEmptyString),
})
export type Options = typeof Options.Type

/** Options with every default applied and blank strings removed. */
export interface Resolved {
  readonly namespace: string
  readonly image: string
  readonly requireImageDigest: boolean
  readonly imagePullPolicy: "IfNotPresent" | "Always" | "Never"
  readonly imagePullSecret: string | undefined
  readonly serviceAccountName: string | undefined
  readonly runtimeClassName: string | undefined
  readonly nodeSelector: Readonly<Record<string, string>> | undefined
  readonly tolerations: ReadonlyArray<Toleration> | undefined
  readonly installation: string
  readonly runAsUser: number
  readonly cpu: string
  readonly memory: string
  readonly ephemeralStorage: string
  readonly scratchSize: string
  readonly startTimeoutSeconds: number
  readonly timeoutSeconds: number
  readonly requireNetworkPolicy: boolean
  readonly verifyEgress: boolean
  readonly kubeconfig: string | undefined
  readonly kubeContext: string | undefined
}

const present = <A extends string>(value: A | "" | undefined) => (value === "" ? undefined : value)

/** Refuses an image that is not pinned by digest unless the operator explicitly opted out. */
export const resolve = (options: Options): Resolved => {
  const resolved: Resolved = {
    namespace: options.namespace ?? "bymorning-sandbox",
    image: options.image,
    requireImageDigest: options.requireImageDigest ?? true,
    imagePullPolicy: present(options.imagePullPolicy) ?? "IfNotPresent",
    imagePullSecret: present(options.imagePullSecret),
    serviceAccountName: present(options.serviceAccountName) ?? "bymorning-sandbox",
    runtimeClassName: present(options.runtimeClassName),
    nodeSelector:
      options.nodeSelector === undefined || Object.keys(options.nodeSelector).length === 0
        ? undefined
        : options.nodeSelector,
    tolerations:
      options.tolerations === undefined || options.tolerations.length === 0 ? undefined : options.tolerations,
    installation: present(options.installation) ?? "default",
    runAsUser: options.runAsUser ?? 1000,
    cpu: present(options.cpu) ?? "1",
    memory: present(options.memory) ?? "512Mi",
    ephemeralStorage: present(options.ephemeralStorage) ?? "256Mi",
    scratchSize: present(options.scratchSize) ?? "64Mi",
    startTimeoutSeconds: options.startTimeoutSeconds ?? 60,
    timeoutSeconds: options.timeoutSeconds ?? 120,
    requireNetworkPolicy: options.requireNetworkPolicy ?? true,
    verifyEgress: options.verifyEgress ?? true,
    kubeconfig: present(options.kubeconfig),
    kubeContext: present(options.kubeContext),
  }
  if (resolved.requireImageDigest && !/@sha256:[0-9a-f]{64}$/.test(resolved.image))
    throw new Error(
      "Kubernetes Code Interpreter image must be pinned by digest (name@sha256:...); set requireImageDigest to false only for local testing",
    )
  return resolved
}

/** Kubernetes kills the pod itself after this many seconds, even if the Gateway is gone. */
export const deadline = (options: Pick<Resolved, "startTimeoutSeconds" | "timeoutSeconds">) =>
  options.startTimeoutSeconds + options.timeoutSeconds + 30

/** Pods older than this are orphans; the deadline plus a grace period for clock skew and slow deletion. */
export const maxLifetime = (options: Pick<Resolved, "startTimeoutSeconds" | "timeoutSeconds">) => deadline(options) + 60
