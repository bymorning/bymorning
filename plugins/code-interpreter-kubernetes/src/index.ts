import { Plugin } from "@bymorning/plugin/effect"
import { Effect, Schema } from "effect"
import { make as makeCluster } from "./cluster.js"
import { fromKubeconfig, inCluster } from "./credentials.js"
import { make, startup, type Runtime } from "./execution.js"
import { Options, resolve } from "./options.js"

export default Plugin.define({
  id: "kubernetes",
  configuration: {
    title: "Kubernetes Code Interpreter",
    description:
      "Runs each execution in a fresh pod of a dedicated namespace. Network isolation comes from the deny-all NetworkPolicy in deploy/, which the cluster's CNI must enforce.",
    fields: [
      { key: "image", type: "string", title: "Execution image (digest-pinned)", required: true },
      { key: "namespace", type: "string", title: "Sandbox namespace", default: "bymorning-sandbox" },
      { key: "runtimeClassName", type: "string", title: "RuntimeClass (for example kata-vm-isolation)" },
      { key: "serviceAccountName", type: "string", title: "Sandbox service account", default: "bymorning-sandbox" },
      { key: "installation", type: "string", title: "Installation label for orphan recovery", default: "default" },
      {
        key: "requireNetworkPolicy",
        type: "boolean",
        title: "Refuse to run without a deny-all NetworkPolicy",
        default: true,
      },
      {
        key: "verifyEgress",
        type: "boolean",
        title: "Confirm egress is blocked inside each pod before running code",
        default: true,
      },
      { key: "requireImageDigest", type: "boolean", title: "Require a digest-pinned image", default: true },
      { key: "runAsUser", type: "integer", title: "Numeric user of the execution image", default: 1000, minimum: 1 },
      { key: "cpu", type: "string", title: "CPU request and limit", default: "1" },
      { key: "memory", type: "string", title: "Memory request and limit", default: "512Mi" },
      { key: "ephemeralStorage", type: "string", title: "Ephemeral storage request and limit", default: "256Mi" },
      { key: "scratchSize", type: "string", title: "Size of /work and /tmp", default: "64Mi" },
      {
        key: "startTimeoutSeconds",
        type: "integer",
        title: "Seconds to wait for the pod to run",
        default: 60,
        minimum: 5,
        maximum: 600,
      },
      {
        key: "timeoutSeconds",
        type: "integer",
        title: "Seconds a program may run",
        default: 120,
        minimum: 1,
        maximum: 3600,
      },
      {
        key: "imagePullPolicy",
        type: "string",
        title: "Image pull policy",
        options: [
          { value: "IfNotPresent", label: "IfNotPresent" },
          { value: "Always", label: "Always" },
          { value: "Never", label: "Never" },
        ],
      },
      { key: "imagePullSecret", type: "string", title: "Image pull Secret name" },
      { key: "kubeconfig", type: "string", title: "kubeconfig path (local testing; default is in-cluster)" },
      { key: "kubeContext", type: "string", title: "kubeconfig context" },
    ],
  },
  effect: (context) =>
    Effect.gen(function* () {
      const options = resolve(yield* Schema.decodeUnknownEffect(Options)(context.options).pipe(Effect.orDie))
      const credentials =
        options.kubeconfig === undefined ? inCluster() : fromKubeconfig(options.kubeconfig, options.kubeContext)
      const runtime: Runtime = { cluster: makeCluster(credentials, options), options, now: () => new Date() }
      const executor = yield* make(runtime)
      yield* Effect.forkScoped(startup(runtime))
      yield* context.codeInterpreter.transform((draft) => {
        draft.add({ id: "kubernetes", name: "Kubernetes", open: Effect.succeed(executor) })
      })
    }),
})
