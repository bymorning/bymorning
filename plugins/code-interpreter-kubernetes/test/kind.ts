import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Credentials } from "../src/credentials.js"
import { fromKubeconfig } from "../src/credentials.js"

/** Pinned: kind v0.33.0's default node image (Kubernetes 1.37.0). kindnet in this release enforces NetworkPolicy. */
export const nodeImage = "kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
export const cluster = process.env.KIND_CLUSTER ?? "bymorning-k8s-test"
export const image = "bymorning-code-interpreter:kind"
export const namespace = "bymorning-sandbox"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const deploy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../deploy")

const has = (command: string, args: string[]) => spawnSync(command, args, { stdio: "ignore" }).status === 0

/** Opt in with KIND_INTEGRATION=1; also needs docker, kind and kubectl on PATH. */
export const enabled =
  process.env.KIND_INTEGRATION === "1" &&
  has("docker", ["info"]) &&
  has("kind", ["version"]) &&
  has("kubectl", ["version", "--client"])

const run = (command: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  })

let kubeconfig = ""
export const kubectl = (args: string[], input?: string) =>
  run("kubectl", args, { input, env: { KUBECONFIG: kubeconfig } })

/** Try a kubectl command whose failure is the expected result. */
export const kubectlFails = (args: string[], input?: string) => {
  try {
    kubectl(args, input)
    return undefined
  } catch (error) {
    return String((error as { stderr?: unknown }).stderr)
  }
}

/** kubectl output even when it exits non-zero (`auth can-i` exits 1 for "no"). */
export const kubectlOutput = (args: string[]) => {
  try {
    return kubectl(args)
  } catch (error) {
    return String((error as { stdout?: unknown }).stdout)
  }
}

let created = false

/** Create (or reuse) the kind cluster, load the execution image, and apply the plugin manifests plus test fixtures. */
export const setup = () => {
  const clusters = run("kind", ["get", "clusters"]).split("\n")
  if (!clusters.includes(cluster)) {
    run("kind", ["create", "cluster", "--name", cluster, "--image", nodeImage, "--wait", "180s"])
    created = true
  }
  const directory = mkdtempSync(path.join(tmpdir(), "bymorning-kind-"))
  kubeconfig = path.join(directory, "admin.kubeconfig")
  writeFileSync(kubeconfig, run("kind", ["get", "kubeconfig", "--name", cluster]))
  run("docker", ["build", "--quiet", "-t", image, "-f", path.join(root, "app/host/Dockerfile.execution"), root])
  run("kind", ["load", "docker-image", image, "--name", cluster])
  // The Gateway's namespace and service account stand in for the real Gateway workload.
  kubectl(
    ["apply", "-f", "-"],
    `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: bymorning\n---\napiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: bymorning-gateway\n  namespace: bymorning\n`,
  )
  kubectl(["apply", "-k", deploy])
  // Wait for the API server to serve the policy (kindnet programs it asynchronously after the pod exists).
  return directory
}

export const teardown = () => {
  if (created && process.env.KIND_KEEP !== "1") run("kind", ["delete", "cluster", "--name", cluster])
}

/** Credentials of the Gateway service account only: proves the shipped Role is sufficient. */
export const gateway = (directory: string): Credentials => {
  const view = JSON.parse(kubectl(["config", "view", "--raw", "--minify", "-o", "json"])) as {
    clusters: [{ cluster: { server: string; "certificate-authority-data": string } }]
  }
  const token = kubectl(["-n", "bymorning", "create", "token", "bymorning-gateway", "--duration=1h"]).trim()
  const file = path.join(directory, "gateway.kubeconfig")
  const entry = view.clusters[0].cluster
  writeFileSync(
    file,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: "kind", cluster: entry }],
      users: [{ name: "gateway", user: { token } }],
      contexts: [{ name: "gateway", context: { cluster: "kind", user: "gateway" } }],
      "current-context": "gateway",
    }),
  )
  return fromKubeconfig(file)
}

export const pods = (namespaceName = namespace, selector = "app.kubernetes.io/managed-by=bymorning-code-interpreter") =>
  kubectl(["-n", namespaceName, "get", "pods", "-l", selector, "-o", "jsonpath={.items[*].metadata.name}"])
    .split(" ")
    .filter((name) => name !== "")
