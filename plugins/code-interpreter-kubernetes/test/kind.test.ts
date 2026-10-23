import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { Effect, Fiber } from "effect"
import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { make as makeCluster } from "../src/cluster.js"
import type { Credentials } from "../src/credentials.js"
import * as Exec from "../src/exec.js"
import { make, startup, sweep, type Runtime } from "../src/execution.js"
import * as Manifest from "../src/manifest.js"
import { resolve, type Options } from "../src/options.js"
import {
  enabled,
  gateway,
  image,
  kubectl,
  kubectlFails,
  kubectlOutput,
  namespace,
  pods,
  setup,
  teardown,
} from "./kind.js"

// Real cluster: these run only with KIND_INTEGRATION=1 and docker, kind and kubectl on PATH.
describe.runIf(enabled)("Kubernetes Code Interpreter against a kind cluster", () => {
  let credentials: Credentials
  let directory: string
  beforeAll(() => {
    directory = setup()
    credentials = gateway(directory)
  }, 600_000)
  afterAll(() => teardown(), 120_000)

  const runtime = (overrides: Partial<Options> = {}, environment: Credentials = credentials): Runtime => {
    const options = resolve({ image, requireImageDigest: false, imagePullPolicy: "Never", ...overrides })
    return { cluster: makeCluster(environment, options), options, now: () => new Date() }
  }
  const execute = (input: CodeInterpreter.ExecuteInput, overrides: Partial<Options> = {}, signal?: AbortSignal) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* make(runtime(overrides))
          return yield* executor.execute(input)
        }),
      ),
      { signal },
    )
  const command = (text: string, overrides: Partial<Options> = {}) =>
    execute({ type: "command", sessionName: "kind-test", command: text }, overrides)

  test("runs Python, JavaScript, TypeScript and shell, with separate streams and exit codes", async () => {
    for (const [language, code] of [
      ["python", "print(6 * 7)"],
      ["javascript", "console.log(6 * 7)"],
      ["typescript", "const value: number = 6 * 7; console.log(value)"],
    ] as const)
      expect(await execute({ type: "code", sessionName: "kind-test", language, code })).toEqual({
        stdout: "42\n",
        stderr: "",
        exitCode: 0,
      })
    expect(await command("echo out; echo err >&2; exit 7")).toEqual({ stdout: "out\n", stderr: "err\n", exitCode: 7 })
    expect(
      await execute({
        type: "code",
        sessionName: "kind-test",
        language: "python",
        code: 'import sys\nprint("before failure", flush=True)\nprint("intentional stderr", file=sys.stderr)\nsys.exit(7)',
      }),
    ).toEqual({ stdout: "before failure\n", stderr: "intentional stderr\n", exitCode: 7 })
    expect(pods()).toEqual([])
  }, 180_000)

  test("each execution is a fresh, credential-free, restricted pod", async () => {
    expect(await command("echo isolated > /work/probe; cat /work/probe")).toMatchObject({ stdout: "isolated\n" })
    const result = await command(
      [
        "test ! -e /work/probe && echo fresh",
        'test "$(id -u)" = 1000 && echo uid',
        'test "$(pwd)" = /work && echo cwd',
        "test ! -e /var/run/secrets/kubernetes.io/serviceaccount && echo no-token",
        "(touch /root-file 2>/dev/null || echo readonly-root)",
        "grep -q '^CapEff:\\s*0000000000000000' /proc/self/status && echo no-capabilities",
        "grep -q '^NoNewPrivs:\\s*1' /proc/self/status && echo no-new-privs",
        "grep -q '^Seccomp:\\s*2' /proc/self/status && echo seccomp",
        "(ls /work >/dev/null && ls /tmp >/dev/null) && echo scratch",
      ].join("; "),
    )
    expect(result.stdout.split("\n").filter(Boolean)).toEqual([
      "fresh",
      "uid",
      "cwd",
      "no-token",
      "readonly-root",
      "no-capabilities",
      "no-new-privs",
      "seccomp",
      "scratch",
    ])
  }, 120_000)

  test("accepts source code larger than 1 MiB and multi-byte text, exactly", async () => {
    const padding = "# ".concat("α".repeat(600_000), "\n")
    const code = `${padding}${padding}import sys\nprint("ok", len(open(__file__, "rb").read()))\n`
    const size = new TextEncoder().encode(code).length
    expect(size).toBeGreaterThan(1024 * 1024)
    expect(await execute({ type: "code", sessionName: "kind-test", language: "python", code })).toEqual({
      stdout: `ok ${size}\n`,
      stderr: "",
      exitCode: 0,
    })
  }, 120_000)

  test("reports output over the limit as an output error and removes the pod", async () => {
    await expect(
      execute({ type: "code", sessionName: "kind-test", language: "python", code: "print('x' * 100001)" }),
    ).rejects.toMatchObject({ operation: "output" })
    expect(pods()).toEqual([])
    expect(await command("python3 -c \"print('y' * 99990)\"")).toMatchObject({ exitCode: 0 })
  }, 120_000)

  test("a timed-out execution fails with a typed error and the pod is deleted", async () => {
    await expect(command("sleep 60", { timeoutSeconds: 3 })).rejects.toMatchObject({
      operation: "invoke",
      message: expect.stringContaining("timed out after 3 seconds"),
    })
    expect(pods()).toEqual([])
  }, 120_000)

  test("cancelling removes the running pod", async () => {
    const sessionName = randomUUID()
    const hash = Manifest.labels(resolve({ image, requireImageDigest: false }), sessionName, new Date())[
      Manifest.sessionLabel
    ]
    const running = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* make(runtime({ imagePullPolicy: "Never" }))
          return yield* executor.execute({ type: "command", sessionName, command: "sleep 60" })
        }),
      ),
    )
    try {
      await expect.poll(() => pods(namespace, `bymorning.io/session=${hash}`).length, { timeout: 30_000 }).toBe(1)
      await Effect.runPromise(Fiber.interrupt(running))
      expect(pods(namespace, `bymorning.io/session=${hash}`)).toEqual([])
    } finally {
      await Effect.runPromise(Fiber.interrupt(running))
    }
  }, 120_000)

  test("network egress and ingress are denied (kindnet enforces NetworkPolicy)", async () => {
    const dns = kubectl([
      "-n",
      "kube-system",
      "get",
      "pod",
      "-l",
      "k8s-app=kube-dns",
      "-o",
      "jsonpath={.items[0].status.podIP}",
    ])
    const probe = [
      "import socket",
      "def reach(host, port):",
      "    try:",
      "        socket.create_connection((host, port), timeout=3).close(); return 'connected'",
      "    except Exception: return 'blocked'",
      `print('pod-network', reach('${dns}', 53))`,
      "print('api-server', reach('10.96.0.1', 443))",
      "print('metadata', reach('169.254.169.254', 80))",
      "print('wireserver', reach('168.63.129.16', 80))",
      "try:",
      "    socket.gethostbyname('kubernetes.default.svc'); print('dns connected')",
      "except Exception: print('dns blocked')",
    ].join("\n")
    // Control: the same code from an unrestricted namespace reaches the pod network and the API server.
    kubectl(["delete", "pod", "control", "-n", "default", "--ignore-not-found", "--wait=true"])
    kubectl([
      "run",
      "control",
      "-n",
      "default",
      "--image",
      image,
      "--image-pull-policy=Never",
      "--restart=Never",
      "--command",
      "--",
      "sleep",
      "300",
    ])
    try {
      kubectl(["wait", "-n", "default", "--for=condition=Ready", "pod/control", "--timeout=60s"])
      const control = kubectl(["exec", "-n", "default", "-i", "control", "--", "python3", "-"], probe)
      expect(control).toContain("pod-network connected")
      expect(control).toContain("api-server connected")
      expect(control).toContain("dns connected")
    } finally {
      kubectl(["delete", "pod", "control", "-n", "default", "--ignore-not-found", "--wait=false"])
    }
    const denied = await execute(
      { type: "code", sessionName: "kind-test", language: "python", code: probe },
      { timeoutSeconds: 60 },
    )
    expect(denied.stdout).toBe(
      "pod-network blocked\napi-server blocked\nmetadata blocked\nwireserver blocked\ndns blocked\n",
    )
  }, 180_000)

  test("the shipped Role is sufficient and no broader", () => {
    const can = (verb: string, resource: string, scope = namespace, subresource?: string) =>
      kubectlOutput([
        "auth",
        "can-i",
        verb,
        resource,
        "-n",
        scope,
        ...(subresource === undefined ? [] : [`--subresource=${subresource}`]),
        "--as=system:serviceaccount:bymorning:bymorning-gateway",
      ]).trim()
    expect([
      can("create", "pods"),
      can("get", "pods"),
      can("list", "pods"),
      can("delete", "pods"),
      can("create", "pods", namespace, "exec"),
      can("get", "pods", namespace, "exec"),
      can("list", "networkpolicies.networking.k8s.io"),
    ]).toEqual(Array(7).fill("yes"))
    expect([
      can("watch", "pods"),
      can("update", "pods"),
      can("patch", "pods"),
      can("get", "pods", namespace, "log"),
      can("create", "pods", namespace, "attach"),
      can("get", "secrets"),
      can("create", "configmaps"),
      can("create", "pods", "default"),
      can("get", "pods", "kube-system"),
      can("create", "pods", "default", "exec"),
    ]).toEqual(Array(10).fill("no"))
  })

  test("pods/exec needs both get and create for the WebSocket exec", async () => {
    const patch = (verbs: string[]) =>
      kubectl([
        "-n",
        namespace,
        "patch",
        "role",
        "bymorning-code-interpreter",
        "--type=json",
        "-p",
        JSON.stringify([{ op: "replace", path: "/rules/1/verbs", value: verbs }]),
      ])
    const outcome = (verbs: string[]) => {
      patch(verbs)
      return command("echo ok").then(
        () => "works",
        (error: CodeInterpreter.ExecutionError) => `${error.operation}: ${error.message}`,
      )
    }
    try {
      // Observed on Kubernetes 1.37: the WebSocket upgrade is a GET but the API server also authorizes `create`, so
      // neither verb alone suffices. The shipped Role lists both, and each removal is refused as a typed exec error.
      for (const verbs of [["get"], ["create"], ["list"]])
        expect(await outcome(verbs)).toMatch(/^invoke: Kubernetes refused the exec request \(HTTP 403: .*forbidden/i)
      expect(await outcome(["get", "create"])).toBe("works")
    } finally {
      patch(["get", "create"])
    }
  }, 120_000)

  test("Pod Security Admission rejects a privileged pod in the sandbox namespace", () => {
    const stderr = kubectlFails(
      ["apply", "-n", namespace, "-f", "-"],
      `apiVersion: v1\nkind: Pod\nmetadata:\n  name: privileged\nspec:\n  containers:\n    - name: c\n      image: ${image}\n      securityContext:\n        privileged: true\n`,
    )
    expect(stderr).toContain("violates PodSecurity")
  })

  test("exec negotiates v5 and works with a v4-only offer", async () => {
    const options = runtime().options
    const name = `bymorning-exec-${randomUUID()}`
    const cluster = makeCluster(credentials, options)
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* cluster.create(Manifest.pod(options, { name, sessionName: "protocol", now: new Date() }))
        while (true) {
          const state = yield* cluster.get(name)
          if (state.status?.containerStatuses?.[0]?.ready === true) break
          yield* Effect.sleep("200 millis")
        }
        const request = { credentials, namespace, pod: name, container: Manifest.container, stdin: undefined }
        const negotiated = yield* Effect.callback<string, Error>((resume) => {
          const socket = new WebSocket(
            Exec.url({ ...request, argv: ["/bin/true"] }),
            ["v5.channel.k8s.io", "v4.channel.k8s.io"],
            {
              headers: { Authorization: `Bearer ${credentials.token()}` },
              ca: credentials.ca,
            },
          )
          socket.on("open", () => {
            resume(Effect.succeed(socket.protocol))
            socket.close()
          })
          socket.on("error", (error) => resume(Effect.fail(error)))
        })
        expect(negotiated).toBe("v5.channel.k8s.io")
        for (const protocols of [["v4.channel.k8s.io"], ["v5.channel.k8s.io"]])
          expect(yield* Exec.run({ ...request, argv: ["/bin/sh", "-c", "echo $0; exit 3", "x"], protocols })).toEqual({
            stdout: "x\n",
            stderr: "",
            exitCode: 3,
          })
        // Kubernetes reports a signal death as exit code 128+n, a program exit as Docker would.
        expect(yield* Exec.run({ ...request, argv: ["/bin/sh", "-c", "kill -9 $$"] })).toMatchObject({ exitCode: 137 })
        // A command that cannot start is a failure of the exec, not a program exit.
        yield* Exec.run({ ...request, argv: ["/no/such/binary"] }).pipe(
          Effect.flip,
          Effect.tap((error) => Effect.sync(() => expect(error.operation).toBe("invoke"))),
        )
      }).pipe(Effect.ensuring(cluster.remove(name).pipe(Effect.ignore))),
    )
  }, 120_000)

  test("sweeps only expired pods of this installation on startup", async () => {
    const options = runtime().options
    const stale = (name: string, installation: string, age: number) =>
      `apiVersion: v1\nkind: Pod\nmetadata:\n  name: ${name}\n  namespace: ${namespace}\n  labels:\n    app.kubernetes.io/managed-by: bymorning-code-interpreter\n    bymorning.io/installation: ${installation}\n    bymorning.io/created-at: "${Math.floor(Date.now() / 1000) - age}"\nspec:\n  terminationGracePeriodSeconds: 0\n  automountServiceAccountToken: false\n  securityContext:\n    runAsNonRoot: true\n    runAsUser: 1000\n    seccompProfile:\n      type: RuntimeDefault\n  containers:\n    - name: sandbox\n      image: ${image}\n      imagePullPolicy: Never\n      command: ["sleep", "600"]\n      resources:\n        requests: {cpu: 10m, memory: 16Mi, ephemeral-storage: 8Mi}\n        limits: {cpu: 100m, memory: 64Mi, ephemeral-storage: 8Mi}\n      securityContext:\n        allowPrivilegeEscalation: false\n        capabilities:\n          drop: [ALL]\n`
    for (const [name, installation, age] of [
      ["orphan-old", "default", 3_600],
      ["orphan-young", "default", 5],
      ["other-old", "another", 3_600],
    ] as const)
      kubectl(["apply", "-f", "-"], stale(name, installation, age))
    try {
      await Effect.runPromise(startup({ ...runtime(), options: { ...options, requireNetworkPolicy: true } }))
      await expect.poll(() => pods(namespace, "").sort(), { timeout: 30_000 }).toEqual(["orphan-young", "other-old"])
      expect(await Effect.runPromise(sweep(runtime()))).toEqual([])
    } finally {
      kubectl([
        "delete",
        "pod",
        "orphan-old",
        "orphan-young",
        "other-old",
        "-n",
        namespace,
        "--ignore-not-found",
        "--wait=false",
        "--grace-period=0",
        "--force",
      ])
    }
  }, 120_000)

  test("refuses to run without a deny-all NetworkPolicy and creates no pod", async () => {
    kubectl(
      ["apply", "-f", "-"],
      [
        "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: bymorning-bare\n  labels:\n    pod-security.kubernetes.io/enforce: restricted",
        "apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: bymorning-sandbox\n  namespace: bymorning-bare\nautomountServiceAccountToken: false",
        "apiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: bymorning-code-interpreter\n  namespace: bymorning-bare\nrules:\n  - apiGroups: ['']\n    resources: [pods]\n    verbs: [create, get, list, delete]\n  - apiGroups: ['']\n    resources: [pods/exec]\n    verbs: [get, create]\n  - apiGroups: [networking.k8s.io]\n    resources: [networkpolicies]\n    verbs: [get, list]",
        "apiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata:\n  name: bymorning-code-interpreter\n  namespace: bymorning-bare\nsubjects:\n  - kind: ServiceAccount\n    name: bymorning-gateway\n    namespace: bymorning\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: Role\n  name: bymorning-code-interpreter",
      ].join("\n---\n"),
    )
    try {
      await expect(command("echo hi", { namespace: "bymorning-bare" })).rejects.toMatchObject({
        operation: "start",
        message: expect.stringContaining("no NetworkPolicy"),
      })
      expect(pods("bymorning-bare")).toEqual([])
      // The egress canary independently catches the absent policy: the pod can reach the API server.
      await expect(
        command("echo hi", { namespace: "bymorning-bare", requireNetworkPolicy: false, startTimeoutSeconds: 8 }),
      ).rejects.toMatchObject({ operation: "start", message: expect.stringContaining("could reach the network") })
      expect(pods("bymorning-bare")).toEqual([])
      // With both checks explicitly off the same namespace runs, so the refusals were the checks and not RBAC or PSA.
      expect(
        await command("echo hi", { namespace: "bymorning-bare", requireNetworkPolicy: false, verifyEgress: false }),
      ).toMatchObject({ stdout: "hi\n" })
    } finally {
      kubectl(["delete", "namespace", "bymorning-bare", "--ignore-not-found", "--wait=false"])
    }
  }, 180_000)

  test("pod creation failures surface as start errors", async () => {
    await expect(command("true", { runtimeClassName: "does-not-exist" })).rejects.toMatchObject({ operation: "start" })
    await expect(command("true", { serviceAccountName: "missing" })).rejects.toMatchObject({ operation: "start" })
    // A missing image with pull policy Never fails fast instead of waiting for the start timeout.
    const started = Date.now()
    await expect(
      execute(
        { type: "command", sessionName: "kind-test", command: "true" },
        { image: "example.invalid/missing:1", imagePullPolicy: "Never" },
      ),
    ).rejects.toMatchObject({ operation: "start" })
    expect(Date.now() - started).toBeLessThan(30_000)
    expect(pods()).toEqual([])
  }, 120_000)
})
