import { Schema } from "effect"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { age, isolation, matches, readiness } from "../src/cluster.js"
import { fromKubeconfig, inCluster } from "../src/credentials.js"
import * as Manifest from "../src/manifest.js"
import { deadline, maxLifetime, Options, resolve } from "../src/options.js"
import { exit } from "../src/protocol.js"

const digest = `example.azurecr.us/execution@sha256:${"a".repeat(64)}`
const options = resolve({ image: digest })
const now = new Date("2026-09-29T12:00:00Z")
const build = (overrides = {}) =>
  Manifest.pod(resolve({ image: digest, ...overrides }), { name: "bymorning-exec-1", sessionName: "session one", now })

describe("Pod manifest", () => {
  test("applies every isolation default of the restricted Pod Security Standard", () => {
    const pod = build()
    const container = pod.spec.containers[0]!
    expect(pod.spec).toMatchObject({
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      hostNetwork: false,
      hostPID: false,
      hostIPC: false,
      shareProcessNamespace: false,
      terminationGracePeriodSeconds: 0,
      serviceAccountName: "bymorning-sandbox",
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
        runAsGroup: 1000,
        seccompProfile: { type: "RuntimeDefault" },
      },
    })
    expect(container.securityContext).toMatchObject({
      privileged: false,
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      capabilities: { drop: ["ALL"] },
      seccompProfile: { type: "RuntimeDefault" },
    })
    expect(container.resources).toEqual({
      requests: { cpu: "1", memory: "512Mi", "ephemeral-storage": "256Mi" },
      limits: { cpu: "1", memory: "512Mi", "ephemeral-storage": "256Mi" },
    })
    expect(pod.spec.volumes).toEqual([
      { name: "work", emptyDir: { medium: "Memory", sizeLimit: "64Mi" } },
      { name: "tmp", emptyDir: { medium: "Memory", sizeLimit: "64Mi" } },
    ])
    expect(container.volumeMounts.map((mount) => mount.mountPath)).toEqual(["/work", "/tmp"])
    expect(container).toMatchObject({ image: digest, workingDir: "/work", stdin: false, tty: false })
    // Nothing that could carry a credential or host access.
    expect(JSON.stringify(pod)).not.toMatch(
      /hostPath|secret|configMap|projected|serviceAccountToken"?:\s*true|hostPort|env":\[\{"name":"(?!HOME)/i,
    )
    expect(pod.spec.containers).toHaveLength(1)
  })

  test("idles until the kubelet deadline, which outlives startup and execution", () => {
    const pod = build({ startTimeoutSeconds: 20, timeoutSeconds: 50 })
    expect(deadline(options)).toBe(60 + 120 + 30)
    expect(pod.spec.activeDeadlineSeconds).toBe(100)
    expect(pod.spec.containers[0]!.command).toEqual(["sleep", "100"])
    expect(maxLifetime({ startTimeoutSeconds: 20, timeoutSeconds: 50 })).toBe(160)
  })

  test("adds optional placement and runtime class only when configured", () => {
    const plain = build()
    expect(plain.spec).not.toHaveProperty("runtimeClassName")
    expect(plain.spec).not.toHaveProperty("nodeSelector")
    expect(plain.spec).not.toHaveProperty("tolerations")
    const pod = build({
      runtimeClassName: "kata-vm-isolation",
      nodeSelector: { "kubernetes.azure.com/agentpool": "sandbox" },
      tolerations: [{ key: "sandbox", operator: "Exists", effect: "NoSchedule" }],
      imagePullSecret: "registry",
      runAsUser: 65532,
    })
    expect(pod.spec).toMatchObject({
      runtimeClassName: "kata-vm-isolation",
      nodeSelector: { "kubernetes.azure.com/agentpool": "sandbox" },
      tolerations: [{ key: "sandbox", operator: "Exists", effect: "NoSchedule" }],
      imagePullSecrets: [{ name: "registry" }],
      securityContext: { runAsUser: 65532, runAsGroup: 65532 },
    })
  })

  test("labels the pod for owner, installation and age, and keeps arbitrary session names out of label values", () => {
    const pod = build({ installation: "prod.east" })
    expect(pod.metadata.labels).toMatchObject({
      "app.kubernetes.io/managed-by": "bymorning-code-interpreter",
      "bymorning.io/installation": "prod.east",
      "bymorning.io/created-at": String(now.getTime() / 1000),
    })
    expect(pod.metadata.labels["bymorning.io/session"]).toMatch(/^[0-9a-f]{16}$/)
    expect(pod.metadata.annotations["bymorning.io/session-name"]).toBe("session one")
    const long = Manifest.pod(options, { name: "x", sessionName: "é".repeat(500), now })
    expect(long.metadata.annotations["bymorning.io/session-name"]).toHaveLength(200)
    expect(Manifest.selector(resolve({ image: digest, installation: "prod.east" }))).toBe(
      "app.kubernetes.io/managed-by=bymorning-code-interpreter,bymorning.io/installation=prod.east",
    )
  })
})

describe("Program", () => {
  test("mirrors the Docker implementation for commands and languages", () => {
    expect(Manifest.program({ type: "command", command: "echo hi" })).toEqual({
      argv: ["/bin/sh", "-c", "echo hi"],
      stdin: undefined,
    })
    const python = Manifest.program({ type: "code", language: "python", code: "print('é')" })
    expect(python.argv[2]).toBe("head -c 11 > /work/main.py && exec python3 /work/main.py </dev/null")
    expect(python.stdin).toEqual(new TextEncoder().encode("print('é')"))
    for (const language of ["javascript", "typescript"] as const)
      expect(Manifest.program({ type: "code", language, code: "" }).argv[2]).toBe(
        "head -c 0 > /work/main.ts && exec bun /work/main.ts </dev/null",
      )
  })
})

describe("Options", () => {
  const decode = (input: unknown) => Schema.decodeUnknownSync(Options)(input)
  test("requires an image pinned by digest unless explicitly waived", () => {
    expect(() => resolve(decode({ image: "python:3.12-slim" }))).toThrow(/pinned by digest/)
    expect(() => resolve(decode({ image: "repo/image@sha256:abc" }))).toThrow(/pinned by digest/)
    expect(resolve(decode({ image: "python:3.12-slim", requireImageDigest: false })).image).toBe("python:3.12-slim")
    expect(resolve(decode({ image: digest })).image).toBe(digest)
  })

  test("treats blank form values as unset and applies defaults", () => {
    const resolved = resolve(
      decode({ image: digest, runtimeClassName: "", imagePullSecret: "", kubeconfig: "", nodeSelector: {} }),
    )
    expect(resolved).toMatchObject({
      namespace: "bymorning-sandbox",
      serviceAccountName: "bymorning-sandbox",
      installation: "default",
      requireNetworkPolicy: true,
      verifyEgress: true,
      startTimeoutSeconds: 60,
      timeoutSeconds: 120,
      runtimeClassName: undefined,
      imagePullSecret: undefined,
      kubeconfig: undefined,
      nodeSelector: undefined,
    })
  })

  test("rejects malformed names and quantities before they reach the API server", () => {
    for (const bad of [
      { namespace: "Not_DNS" },
      { cpu: "lots" },
      { installation: "has space" },
      { timeoutSeconds: 0 },
      { imagePullPolicy: "Sometimes" },
      { runAsUser: 0 },
    ])
      expect(() => decode({ image: digest, ...bad })).toThrow()
  })
})

describe("Exec status", () => {
  test("maps the status channel to an exit code or an exec failure", () => {
    expect(exit('{"status":"Success"}')).toEqual({ type: "exit", code: 0 })
    expect(
      exit(
        '{"status":"Failure","reason":"NonZeroExitCode","details":{"causes":[{"reason":"ExitCode","message":"137"}]}}',
      ),
    ).toEqual({ type: "exit", code: 137 })
    expect(exit('{"status":"Failure","reason":"NonZeroExitCode"}')).toMatchObject({ type: "failure" })
    expect(exit('{"status":"Failure","message":"container not found"}')).toEqual({
      type: "failure",
      message: "container not found",
    })
    expect(exit("not json")).toMatchObject({ type: "failure" })
    expect(exit("null")).toMatchObject({ type: "failure" })
  })
})

describe("Pod state", () => {
  const status = (value: object) => ({ metadata: { name: "p" }, status: value })
  test("classifies readiness, permanent failures and scheduling delays", () => {
    expect(readiness(status({ phase: "Running", containerStatuses: [{ name: "sandbox", ready: true }] }))).toEqual({
      type: "ready",
    })
    expect(
      readiness(status({ phase: "Running", containerStatuses: [{ name: "sandbox", ready: false }] })),
    ).toMatchObject({ type: "waiting" })
    expect(
      readiness(
        status({
          phase: "Pending",
          containerStatuses: [
            { name: "sandbox", state: { waiting: { reason: "ImagePullBackOff", message: "denied" } } },
          ],
        }),
      ),
    ).toEqual({ type: "failed", detail: "ImagePullBackOff: denied" })
    expect(readiness(status({ phase: "Failed", reason: "DeadlineExceeded" }))).toMatchObject({ type: "failed" })
    expect(
      readiness(
        status({
          phase: "Pending",
          conditions: [{ type: "PodScheduled", status: "False", message: "0/3 nodes match selector" }],
        }),
      ),
    ).toEqual({ type: "waiting", detail: "0/3 nodes match selector" })
  })

  test("ages a pod from its label, falling back to the API timestamp", () => {
    const at = new Date("2026-09-29T12:10:00Z")
    expect(age({ metadata: { labels: { "bymorning.io/created-at": String(now.getTime() / 1000) } } }, at)).toBe(600)
    expect(age({ metadata: { creationTimestamp: "2026-09-29T12:00:00Z" } }, at)).toBe(600)
    expect(age({ metadata: { labels: { "bymorning.io/created-at": "garbage" } } }, at)).toBeUndefined()
  })
})

describe("NetworkPolicy verification", () => {
  const labels = Manifest.labels(options, "s", now)
  const policy = (spec: object, name = "p") => ({ metadata: { name }, spec })
  test("accepts a deny-all that selects the pods and rejects everything else", () => {
    const denyAll = policy({ podSelector: {}, policyTypes: ["Ingress", "Egress"] })
    expect(isolation([denyAll], labels)).toEqual({ ok: true })
    expect(
      isolation(
        [policy({ podSelector: { matchLabels: Manifest.selecting(options) }, policyTypes: ["Ingress", "Egress"] })],
        labels,
      ),
    ).toEqual({ ok: true })
    expect(isolation([], labels)).toMatchObject({ ok: false, message: expect.stringContaining("no NetworkPolicy") })
    expect(
      isolation(
        [policy({ podSelector: { matchLabels: { app: "other" } }, policyTypes: ["Ingress", "Egress"] })],
        labels,
      ),
    ).toMatchObject({ ok: false })
    expect(isolation([policy({ podSelector: {}, policyTypes: ["Ingress"] })], labels)).toMatchObject({
      ok: false,
      message: expect.stringContaining("both ingress and egress"),
    })
    // Omitted policyTypes means ingress only.
    expect(isolation([policy({ podSelector: {} })], labels)).toMatchObject({ ok: false })
  })

  test("refuses when any policy selecting the pods allows traffic, because policies are additive", () => {
    const denyAll = policy({ podSelector: {}, policyTypes: ["Ingress", "Egress"] }, "deny")
    expect(
      isolation([denyAll, policy({ podSelector: {}, policyTypes: ["Egress"], egress: [{}] }, "allow-dns")], labels),
    ).toEqual({
      ok: false,
      message: "NetworkPolicy allow-dns allows traffic to or from the sandbox pods",
    })
    expect(
      isolation([denyAll, policy({ podSelector: {}, ingress: [{ from: [{ podSelector: {} }] }] }, "allow-in")], labels),
    ).toMatchObject({ ok: false })
    // An allow policy for other pods is irrelevant.
    expect(
      isolation([denyAll, policy({ podSelector: { matchLabels: { app: "web" } }, egress: [{}] })], labels),
    ).toEqual({ ok: true })
  })

  test("evaluates label selector expressions", () => {
    const l = { a: "1", b: "2" }
    expect(matches({ matchExpressions: [{ key: "a", operator: "In", values: ["1", "9"] }] }, l)).toBe(true)
    expect(matches({ matchExpressions: [{ key: "a", operator: "NotIn", values: ["1"] }] }, l)).toBe(false)
    expect(matches({ matchExpressions: [{ key: "c", operator: "DoesNotExist" }] }, l)).toBe(true)
    expect(matches({ matchExpressions: [{ key: "c", operator: "Exists" }] }, l)).toBe(false)
    expect(matches({ matchLabels: { a: "1" } }, l)).toBe(true)
    expect(matches(undefined, l)).toBe(true)
  })
})

describe("Credentials", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "k8s-credentials-"))
  test("in-cluster reads the projected token per request and the CA once", () => {
    writeFileSync(path.join(directory, "token"), "one\n")
    writeFileSync(path.join(directory, "ca.crt"), "CA")
    const credentials = inCluster({ KUBERNETES_SERVICE_HOST: "10.0.0.1", KUBERNETES_SERVICE_PORT: "6443" }, directory)
    expect(credentials.server.href).toBe("https://10.0.0.1:6443/")
    expect(String(credentials.ca)).toBe("CA")
    expect(credentials.token()).toBe("one")
    writeFileSync(path.join(directory, "token"), "two\n")
    expect(credentials.token()).toBe("two")
    expect(inCluster({ KUBERNETES_SERVICE_HOST: "fd00::1" }, directory).server.href).toBe("https://[fd00::1]/")
  })

  test("in-cluster refuses outside a pod or without a token", () => {
    expect(() => inCluster({}, directory)).toThrow(/KUBERNETES_SERVICE_HOST/)
    expect(() => inCluster({ KUBERNETES_SERVICE_HOST: "h" }, path.join(directory, "missing"))).toThrow()
  })

  test("kubeconfig reads server, CA and token, and refuses credential plugins", () => {
    const file = path.join(directory, "config")
    const config = (user: string) =>
      `apiVersion: v1\nkind: Config\ncurrent-context: c\ncontexts:\n- name: c\n  context: {cluster: k, user: u}\nclusters:\n- name: k\n  cluster: {server: "https://api.example:6443", certificate-authority-data: ${Buffer.from("PEM").toString("base64")}}\nusers:\n- name: u\n  user: ${user}\n`
    writeFileSync(file, config("{token: abc}"))
    const credentials = fromKubeconfig(file)
    expect(credentials.server.href).toBe("https://api.example:6443/")
    expect(String(credentials.ca)).toBe("PEM")
    expect(credentials.token()).toBe("abc")
    expect(credentials.insecure).toBe(false)
    writeFileSync(file, config("{exec: {command: aws}}"))
    expect(() => fromKubeconfig(file)).toThrow(/credential plugins/)
    expect(() => fromKubeconfig(file, "missing")).toThrow(/context missing not found/)
  })
})
