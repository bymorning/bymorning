import type { Executor } from "@bymorning/plugin/effect/code-interpreter"
import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { Effect, Ref } from "effect"
import { randomUUID } from "node:crypto"
import { age, isolation, readiness, type Cluster } from "./cluster.js"
import * as Exec from "./exec.js"
import * as Manifest from "./manifest.js"
import { maxLifetime, type Resolved } from "./options.js"

const { ExecutionError } = CodeInterpreter
type Failure = InstanceType<typeof ExecutionError>

/** Poll cadence while a pod starts; the Role deliberately has no `watch` verb. */
const poll = "250 millis"
/** How long a successful network-isolation check is trusted. */
const verified = 60_000
/** Minimum spacing of opportunistic orphan sweeps triggered by executions. */
const interval = 300_000

export interface Runtime {
  readonly cluster: Cluster
  readonly options: Resolved
  readonly now: () => Date
}

const started = (message: string, cause?: unknown) =>
  new ExecutionError({ operation: "start", message, ...(cause === undefined ? {} : { cause }) })

/** Delete every pod of this installation older than the maximum lifetime (restart recovery). Returns the names removed. */
export const sweep = (runtime: Runtime): Effect.Effect<ReadonlyArray<string>, Failure> =>
  Effect.gen(function* () {
    const limit = maxLifetime(runtime.options)
    const pods = yield* runtime.cluster.list()
    const now = runtime.now()
    const expired = pods.flatMap((pod) => {
      const seconds = age(pod, now)
      return pod.metadata?.name !== undefined && seconds !== undefined && seconds > limit ? [pod.metadata.name] : []
    })
    yield* Effect.forEach(expired, (name) => runtime.cluster.remove(name), { concurrency: 4, discard: true })
    return expired
  }).pipe(Effect.mapError((cause) => started(`Failed to sweep orphaned sandbox pods: ${cause.message}`, cause)))

/** Check that a deny-all NetworkPolicy selects the sandbox pods. Refuses execution when required and absent. */
export const verify = (runtime: Runtime): Effect.Effect<void, Failure> =>
  runtime.cluster.policies().pipe(
    Effect.mapError((cause) => started(`Unable to verify the sandbox NetworkPolicy: ${cause.message}`, cause)),
    Effect.flatMap((policies) => {
      const result = isolation(policies, Manifest.labels(runtime.options, "verify", runtime.now()))
      return result.ok
        ? Effect.void
        : Effect.fail(
            started(`Sandbox network isolation is required but ${result.message}; apply deploy/network-policy.yaml`),
          )
    }),
  )

/**
 * The executor for one installation. One pod per execution, never reused; the pod is deleted in a finalizer on
 * success, failure, timeout and interruption.
 */
export const make = Effect.fn("Kubernetes.make")(function* (runtime: Runtime) {
  const { cluster, options } = runtime
  const checked = yield* Ref.make(0)
  const swept = yield* Ref.make(0)

  const network = Effect.gen(function* () {
    if (!options.requireNetworkPolicy) return
    const now = runtime.now().getTime()
    if (now - (yield* Ref.get(checked)) < verified) return
    yield* verify(runtime)
    yield* Ref.set(checked, now)
  })
  const opportunistic = Effect.gen(function* () {
    const now = runtime.now().getTime()
    if (now - (yield* Ref.get(swept)) < interval) return
    yield* Ref.set(swept, now)
    yield* sweep(runtime)
  }).pipe(Effect.ignore)

  const ready = (name: string): Effect.Effect<void, Failure> =>
    Effect.gen(function* () {
      const detail = yield* Ref.make("Pending")
      const wait = Effect.gen(function* () {
        while (true) {
          const pod = yield* cluster
            .get(name)
            .pipe(Effect.mapError((cause) => started(`Failed to read sandbox pod: ${cause.message}`, cause)))
          const state = readiness(pod)
          if (state.type === "ready") return
          if (state.type === "failed") return yield* started(`Sandbox pod failed to start: ${state.detail}`)
          yield* Ref.set(detail, state.detail)
          yield* Effect.sleep(poll)
        }
      })
      return yield* wait.pipe(
        Effect.timeoutOrElse({
          duration: `${options.startTimeoutSeconds} seconds`,
          orElse: () =>
            Ref.get(detail).pipe(
              Effect.flatMap((reason) =>
                Effect.fail(
                  started(`Sandbox pod was not running within ${options.startTimeoutSeconds} seconds: ${reason}`),
                ),
              ),
            ),
        }),
      )
    })

  /** Wait, within the start budget, until the CNI actually blocks the pod's egress. Fails closed. */
  const isolated = (name: string): Effect.Effect<void, Failure> => {
    const attempt = Exec.run({
      credentials: cluster.credentials,
      namespace: options.namespace,
      pod: name,
      container: Manifest.container,
      argv: Manifest.canary,
      stdin: undefined,
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) =>
        cause instanceof ExecutionError ? cause : started("Timed out verifying sandbox network isolation", cause),
      ),
    )
    return Effect.gen(function* () {
      while (true) {
        const result = yield* attempt
        if (result.exitCode === 0) return
        if (result.exitCode === 2) {
          yield* Effect.logWarning("Sandbox egress canary has no address to test; isolation was not verified")
          return
        }
        yield* Effect.sleep(poll)
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: `${options.startTimeoutSeconds} seconds`,
        orElse: () =>
          Effect.fail(
            started(
              "Sandbox pod could reach the network; the cluster's NetworkPolicy was not enforced for it. Check that the CNI enforces NetworkPolicy",
            ),
          ),
      }),
    )
  }

  const executor: Executor = {
    execute: Effect.fn("Kubernetes.execute")(function* (input) {
      yield* network
      yield* opportunistic
      const name = `bymorning-exec-${randomUUID()}`
      // Registered before create so an interrupted create request cannot leave an unowned pod behind.
      yield* Effect.addFinalizer(() =>
        cluster.remove(name).pipe(
          Effect.timeout("15 seconds"),
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to delete Kubernetes Code Interpreter pod").pipe(
              Effect.annotateLogs({ pod: name, namespace: options.namespace, cause }),
            ),
          ),
        ),
      )
      yield* cluster
        .create(Manifest.pod(options, { name, sessionName: input.sessionName, now: runtime.now() }))
        .pipe(
          Effect.mapError((cause) => started(`Kubernetes refused to create the sandbox pod: ${cause.message}`, cause)),
        )
      yield* ready(name)
      if (options.verifyEgress) yield* isolated(name)
      const program = Manifest.program(input)
      return yield* Exec.run({
        credentials: cluster.credentials,
        namespace: options.namespace,
        pod: name,
        container: Manifest.container,
        argv: program.argv,
        stdin: program.stdin,
      }).pipe(
        Effect.timeoutOrElse({
          duration: `${options.timeoutSeconds} seconds`,
          orElse: () =>
            Effect.fail(
              new ExecutionError({
                operation: "invoke",
                message: `Code Interpreter execution timed out after ${options.timeoutSeconds} seconds`,
              }),
            ),
        }),
      )
    }),
  }
  return executor
})

/** Startup work done once per plugin activation: recover from a previous run and report a missing NetworkPolicy. */
export const startup = (runtime: Runtime): Effect.Effect<void> =>
  Effect.gen(function* () {
    const removed = yield* sweep(runtime)
    if (removed.length > 0)
      yield* Effect.logInfo("Removed orphaned Kubernetes Code Interpreter pods").pipe(
        Effect.annotateLogs({ pods: removed }),
      )
    if (runtime.options.requireNetworkPolicy) yield* verify(runtime)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Kubernetes Code Interpreter startup check failed").pipe(Effect.annotateLogs({ cause })),
    ),
  )
