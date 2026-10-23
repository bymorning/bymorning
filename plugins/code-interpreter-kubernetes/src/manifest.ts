import { createHash } from "node:crypto"
import { deadline, type Resolved } from "./options.js"

export const managedBy = "app.kubernetes.io/managed-by"
export const owner = "bymorning-code-interpreter"
export const installationLabel = "bymorning.io/installation"
export const createdLabel = "bymorning.io/created-at"
export const sessionLabel = "bymorning.io/session"
export const container = "sandbox"
export const workDirectory = "/work"

/** Selector for every pod this installation's plugin may have created. */
export const selector = (options: Pick<Resolved, "installation">) =>
  `${managedBy}=${owner},${installationLabel}=${options.installation}`

/** Labels applied to every sandbox pod; a NetworkPolicy podSelector must match them. */
export const labels = (
  options: Pick<Resolved, "installation">,
  sessionName: string,
  now: Date,
): Record<string, string> => ({
  [managedBy]: owner,
  [installationLabel]: options.installation,
  [createdLabel]: String(Math.floor(now.getTime() / 1000)),
  // Label values cannot hold arbitrary text; the raw name is an annotation.
  [sessionLabel]: createHash("sha256").update(sessionName).digest("hex").slice(0, 16),
})

/** The stable subset of labels that an operator's NetworkPolicy should select (excludes the per-pod timestamp and session). */
export const selecting = (options: Pick<Resolved, "installation">) => ({
  [managedBy]: owner,
  [installationLabel]: options.installation,
})

/**
 * The complete Pod for one execution. Pure: every isolation field is decided here, and nothing else in the
 * plugin may add capabilities to a sandbox pod.
 */
export const pod = (
  options: Resolved,
  input: { readonly name: string; readonly sessionName: string; readonly now: Date },
) => {
  const seconds = deadline(options)
  const securityContext = {
    runAsNonRoot: true,
    runAsUser: options.runAsUser,
    runAsGroup: options.runAsUser,
    seccompProfile: { type: "RuntimeDefault" },
  }
  const resources = { cpu: options.cpu, memory: options.memory, "ephemeral-storage": options.ephemeralStorage }
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: input.name,
      namespace: options.namespace,
      labels: labels(options, input.sessionName, input.now),
      annotations: { "bymorning.io/session-name": input.sessionName.slice(0, 200) },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: seconds,
      terminationGracePeriodSeconds: 0,
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      hostNetwork: false,
      hostPID: false,
      hostIPC: false,
      shareProcessNamespace: false,
      ...(options.serviceAccountName === undefined ? {} : { serviceAccountName: options.serviceAccountName }),
      ...(options.runtimeClassName === undefined ? {} : { runtimeClassName: options.runtimeClassName }),
      ...(options.nodeSelector === undefined ? {} : { nodeSelector: options.nodeSelector }),
      ...(options.tolerations === undefined ? {} : { tolerations: options.tolerations }),
      ...(options.imagePullSecret === undefined ? {} : { imagePullSecrets: [{ name: options.imagePullSecret }] }),
      securityContext,
      containers: [
        {
          name: container,
          image: options.image,
          imagePullPolicy: options.imagePullPolicy,
          // Idle until exec; the kubelet deadline above is the backstop if the Gateway disappears.
          command: ["sleep", String(seconds)],
          workingDir: workDirectory,
          env: [{ name: "HOME", value: "/tmp" }],
          stdin: false,
          tty: false,
          securityContext: {
            ...securityContext,
            privileged: false,
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ["ALL"] },
          },
          resources: { requests: resources, limits: resources },
          volumeMounts: [
            { name: "work", mountPath: workDirectory },
            { name: "tmp", mountPath: "/tmp" },
          ],
        },
      ],
      volumes: [
        { name: "work", emptyDir: { medium: "Memory", sizeLimit: options.scratchSize } },
        { name: "tmp", emptyDir: { medium: "Memory", sizeLimit: options.scratchSize } },
      ],
    },
  }
}
export type Pod = ReturnType<typeof pod>

/**
 * The program `exec` runs. Code arrives on the exec stdin stream so its size is never bounded by argv, environment
 * or a Secret. `head -c` consumes exactly the announced byte count, so no stdin half-close is required, and the
 * interpreter's own stdin is /dev/null (EOF, as in the Docker implementation).
 */
export const program = (
  input:
    | { readonly type: "command"; readonly command: string }
    | { readonly type: "code"; readonly code: string; readonly language: "python" | "javascript" | "typescript" },
): { readonly argv: ReadonlyArray<string>; readonly stdin: Uint8Array | undefined } => {
  if (input.type === "command") return { argv: ["/bin/sh", "-c", input.command], stdin: undefined }
  const bytes = new TextEncoder().encode(input.code)
  // Same mapping as the Docker implementation: Python runs under python3, everything else under Bun as TypeScript.
  const run =
    input.language === "python" ? "exec python3 /work/main.py </dev/null" : "exec bun /work/main.ts </dev/null"
  const file = input.language === "python" ? "/work/main.py" : "/work/main.ts"
  return { argv: ["/bin/sh", "-c", `head -c ${bytes.length} > ${file} && ${run}`], stdin: bytes }
}

/**
 * Egress canary. A CNI may report a pod Ready before it has programmed the NetworkPolicy for it (observed on kind's
 * kindnet: the first seconds of a pod's life are unrestricted). Inside the pod, try the API server address that
 * Kubernetes injects into every pod. Exit 0: connection failed (isolated). 1: connected (not yet isolated).
 * 2: no address to test, which is inconclusive.
 */
export const canary = [
  "python3",
  "-c",
  [
    "import os, socket, sys",
    "host = os.environ.get('KUBERNETES_SERVICE_HOST')",
    "port = int(os.environ.get('KUBERNETES_SERVICE_PORT') or 443)",
    "if not host: sys.exit(2)",
    "try:",
    "    socket.create_connection((host, port), timeout=1).close()",
    "except OSError:",
    "    sys.exit(0)",
    "sys.exit(1)",
  ].join("\n"),
] as const
