import type { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { Effect, Fiber } from "effect"
import { afterEach, describe, expect, test } from "vitest"
import { make as makeCluster } from "../src/cluster.js"
import * as Exec from "../src/exec.js"
import { make, startup, sweep, verify, type Runtime } from "../src/execution.js"
import * as Manifest from "../src/manifest.js"
import { resolve, type Options } from "../src/options.js"
import { exitStatus, frame, start, success, type Behavior, type Fake } from "./fake.js"

const digest = `example.azurecr.us/execution@sha256:${"a".repeat(64)}`
let fake: Fake | undefined
afterEach(async () => {
  await fake?.stop()
  fake = undefined
})
const serve = async (behavior: Behavior = {}) => (fake = await start(behavior))
const denyAll = { metadata: { name: "deny" }, spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] } }

const runtime = (server: Fake, overrides: Partial<Options> = {}, now = () => new Date()): Runtime => {
  // The canary is exercised by its own tests; here the fake exec answers every program the same way.
  const options = resolve({ image: digest, requireNetworkPolicy: false, verifyEgress: false, ...overrides })
  return { cluster: makeCluster(server.credentials, options), options, now }
}
const run = (server: Fake, input: CodeInterpreter.ExecuteInput, overrides: Partial<Options> = {}) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const executor = yield* make(runtime(server, overrides))
        return yield* executor.execute(input)
      }),
    ),
  )
const shell = (command = "true") => ({ type: "command", sessionName: "s", command }) as const
const exec = (server: Fake, stdin?: Uint8Array, protocols?: string[]) =>
  Effect.runPromise(
    Exec.run({
      credentials: server.credentials,
      namespace: "ns",
      pod: "p",
      container: "sandbox",
      argv: ["/bin/sh", "-c", "x y"],
      stdin,
      ...(protocols === undefined ? {} : { protocols }),
    }),
  )
const failure = (effect: Promise<unknown>) =>
  effect.then(
    () => undefined,
    (error: CodeInterpreter.ExecutionError) => error,
  )

describe("exec transport", () => {
  test("separates stdout and stderr, decodes split multi-byte characters, and reports the exit code", async () => {
    const server = await serve({
      exec: (socket) => {
        const bytes = Buffer.from("é")
        socket.send(frame(1, bytes.subarray(0, 1)))
        socket.send(frame(2, "err\n"))
        socket.send(frame(1, bytes.subarray(1)))
        socket.send(frame(3, exitStatus(7)))
        socket.close()
      },
    })
    expect(await exec(server)).toEqual({ stdout: "é", stderr: "err\n", exitCode: 7 })
  })

  test("requests the exec sub-resource with bearer authentication, unbounded stdin flags and escaped argv", async () => {
    const server = await serve()
    await exec(server, new Uint8Array([1]))
    const upgrade = server.calls.find((call) => call.method === "UPGRADE")!
    const url = new URL(upgrade.path, "http://x")
    expect(url.pathname).toBe("/api/v1/namespaces/ns/pods/p/exec")
    expect(url.searchParams.getAll("command")).toEqual(["/bin/sh", "-c", "x y"])
    expect(Object.fromEntries([...url.searchParams].filter(([key]) => key !== "command"))).toEqual({
      container: "sandbox",
      stdin: "true",
      stdout: "true",
      stderr: "true",
      tty: "false",
    })
    expect(upgrade.authorization).toBe("Bearer test-token")
  })

  test("delivers more than 1 MiB of stdin in order and intact", async () => {
    const received: Buffer[] = []
    const server = await serve({
      exec: (socket) => {
        socket.on("message", (data: Buffer) => {
          expect(data[0]).toBe(0)
          received.push(data.subarray(1))
          if (Buffer.concat(received).length >= size) {
            socket.send(frame(3, success))
            socket.close()
          }
        })
      },
    })
    const size = 3 * 1024 * 1024 + 17
    const stdin = Uint8Array.from({ length: size }, (_, index) => (index * 31) % 251)
    expect(await exec(server, stdin)).toMatchObject({ exitCode: 0 })
    expect(Buffer.concat(received).equals(Buffer.from(stdin))).toBe(true)
    expect(received.length).toBeGreaterThan(40)
  })

  test("falls back to v4 when the server does not offer v5, and refuses an unsupported protocol", async () => {
    const v4 = await serve({ protocols: ["v4.channel.k8s.io"] })
    expect(await exec(v4)).toMatchObject({ exitCode: 0 })
    await v4.stop()
    const v5 = await serve({ protocols: ["v5.channel.k8s.io"] })
    expect(await exec(v5)).toMatchObject({ exitCode: 0 })
    await v5.stop()
    // A server that supports none of the offered protocols cannot be used; this is not silently downgraded.
    const other = await serve({ protocols: ["base64.channel.k8s.io"] })
    expect(await failure(exec(other))).toMatchObject({ operation: "invoke" })
  })

  test("ends over-limit output with an output error while streaming, before the process finishes", async () => {
    let closed = false
    const server = await serve({
      exec: (socket) => {
        socket.on("close", () => (closed = true))
        // 60,000 characters on each stream is 120,000 in total; the limit applies to the combined output.
        socket.send(frame(1, "a".repeat(60_000)))
        socket.send(frame(2, "b".repeat(60_000)))
      },
    })
    expect(await failure(exec(server))).toMatchObject({
      operation: "output",
      message: expect.stringContaining("100000"),
    })
    await expect.poll(() => closed).toBe(true)
  })

  test("accepts exactly the limit", async () => {
    const server = await serve({
      exec: (socket) => {
        socket.send(frame(1, "a".repeat(100_000)))
        socket.send(frame(3, success))
        socket.close()
      },
    })
    expect((await exec(server)).stdout).toHaveLength(100_000)
  })

  test("maps refusal, exec failure and protocol violations to typed errors", async () => {
    const refused = await serve({ refuse: { status: 403, message: 'pods "p" is forbidden: cannot create pods/exec' } })
    expect(await failure(exec(refused))).toMatchObject({
      operation: "invoke",
      message: expect.stringContaining('HTTP 403: pods "p" is forbidden'),
    })
    await refused.stop()
    const failed = await serve({
      exec: (socket) => {
        socket.send(frame(3, JSON.stringify({ status: "Failure", message: "container not found" })))
        socket.close()
      },
    })
    expect(await failure(exec(failed))).toMatchObject({
      operation: "invoke",
      message: expect.stringContaining("container not found"),
    })
    await failed.stop()
    const silent = await serve({ exec: (socket) => socket.close() })
    expect(await failure(exec(silent))).toMatchObject({
      operation: "stream",
      message: expect.stringContaining("without reporting"),
    })
    await silent.stop()
    const malformed = await serve({ exec: (socket) => socket.send("text frame") })
    expect(await failure(exec(malformed))).toMatchObject({ operation: "stream" })
  })

  test("closes the socket when interrupted", async () => {
    const server = await serve({ exec: () => {} })
    const running = Effect.runFork(
      Exec.run({
        credentials: server.credentials,
        namespace: "ns",
        pod: "p",
        container: "sandbox",
        argv: ["x"],
        stdin: undefined,
      }),
    )
    await expect.poll(() => server.open()).toBe(1)
    await Effect.runPromise(Fiber.interrupt(running))
    await expect.poll(() => server.open()).toBe(0)
  })
})

describe("execution", () => {
  test("creates one pod per call, runs the program, and deletes the pod afterwards", async () => {
    const server = await serve({
      exec: (socket) => {
        socket.send(frame(1, "hello\n"))
        socket.send(frame(3, success))
        socket.close()
      },
    })
    expect(await run(server, shell("echo hello"))).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 })
    expect(await run(server, shell("echo hello"))).toMatchObject({ exitCode: 0 })
    const creates = server.calls.filter((call) => call.method === "POST")
    const deletes = server.calls.filter((call) => call.method === "DELETE")
    expect(creates).toHaveLength(2)
    expect(new Set(creates.map((call) => (call.body as { metadata: { name: string } }).metadata.name)).size).toBe(2)
    expect(deletes.map((call) => call.path.split("/").at(-1))).toEqual(
      creates.map((call) => (call.body as { metadata: { name: string } }).metadata.name),
    )
    expect(deletes[0]!.body).toMatchObject({ gracePeriodSeconds: 0 })
    expect(server.created.size).toBe(0)
    // The request that reaches the API server carries the manifest built by Manifest.pod.
    expect(
      (creates[0]!.body as ReturnType<typeof Manifest.pod>).spec.containers[0]!.securityContext.capabilities,
    ).toEqual({ drop: ["ALL"] })
  })

  test("sends only the verbs and paths the shipped Role allows", async () => {
    const server = await serve({ policies: () => [denyAll] })
    const options = resolve({ image: digest, verifyEgress: false })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* make({
            cluster: makeCluster(server.credentials, options),
            options,
            now: () => new Date(),
          })
          yield* executor.execute(shell())
        }),
      ),
    )
    const seen = new Set(
      server.calls.map(
        (call) => `${call.method} ${call.path.replace(/\/pods\/[^/?]+/, "/pods/NAME").replace(/\?.*/, "")}`,
      ),
    )
    expect([...seen].sort()).toEqual(
      [
        "DELETE /api/v1/namespaces/bymorning-sandbox/pods/NAME",
        "GET /api/v1/namespaces/bymorning-sandbox/pods/NAME",
        // The exec WebSocket handshake is an HTTP GET upgrade.
        "UPGRADE /api/v1/namespaces/bymorning-sandbox/pods/NAME/exec",
        "GET /apis/networking.k8s.io/v1/namespaces/bymorning-sandbox/networkpolicies",
        "POST /api/v1/namespaces/bymorning-sandbox/pods",
        // opportunistic orphan sweep on the first execution
        "GET /api/v1/namespaces/bymorning-sandbox/pods",
      ].sort(),
    )
  })

  test("sends code on stdin with its exact byte count in the program", async () => {
    let argv: string[] = []
    let bytes = 0
    const server = await serve({
      exec: (socket, request) => {
        argv = new URL(request.url ?? "", "http://x").searchParams.getAll("command")
        socket.on("message", (data: Buffer) => {
          bytes += data.length - 1
          if (bytes === 6) {
            socket.send(frame(3, success))
            socket.close()
          }
        })
      },
    })
    await run(server, { type: "code", sessionName: "s", language: "python", code: "1 + é" })
    expect(argv[2]).toBe("head -c 6 > /work/main.py && exec python3 /work/main.py </dev/null")
    expect(bytes).toBe(6)
  })

  test("a non-zero exit is output, not an error", async () => {
    const server = await serve({
      exec: (socket) => {
        socket.send(frame(2, "boom\n"))
        socket.send(frame(3, exitStatus(2)))
        socket.close()
      },
    })
    expect(await run(server, shell("false"))).toEqual({ stdout: "", stderr: "boom\n", exitCode: 2 })
  })

  test("maps creation refusals to start errors and still deletes by name", async () => {
    const server = await serve({
      create: () => ({
        status: 403,
        body: {
          status: "Failure",
          reason: "Forbidden",
          message: 'pods "x" is forbidden: violates PodSecurity "restricted:latest"',
        },
      }),
    })
    const error = await failure(run(server, shell()))
    expect(error).toMatchObject({ operation: "start", message: expect.stringContaining("violates PodSecurity") })
    expect(server.calls.some((call) => call.method === "DELETE")).toBe(true)
  })

  test("maps an unreachable API server to a start error", async () => {
    const server = await serve()
    await server.stop()
    expect(await failure(run(server, shell()))).toMatchObject({ operation: "start" })
    fake = undefined
  })

  test("fails fast on a permanent start failure and reports the reason", async () => {
    const server = await serve({
      status: () => ({
        phase: "Pending",
        containerStatuses: [
          { name: "sandbox", state: { waiting: { reason: "ErrImagePull", message: "manifest unknown" } } },
        ],
      }),
    })
    expect(await failure(run(server, shell(), { startTimeoutSeconds: 30 }))).toMatchObject({
      operation: "start",
      message: expect.stringContaining("ErrImagePull: manifest unknown"),
    })
    expect(server.created.size).toBe(0)
  })

  test("times out waiting for the pod and reports the scheduling reason", async () => {
    const server = await serve({
      status: () => ({
        phase: "Pending",
        conditions: [{ type: "PodScheduled", status: "False", message: "0/3 nodes are available" }],
      }),
    })
    const error = await failure(run(server, shell(), { startTimeoutSeconds: 5 }))
    expect(error).toMatchObject({ operation: "start", message: expect.stringContaining("0/3 nodes are available") })
    expect(server.created.size).toBe(0)
  }, 15_000)

  test("polls until the pod is ready", async () => {
    const server = await serve({
      status: (_, reads) =>
        reads < 3 ? { phase: "Pending" } : { phase: "Running", containerStatuses: [{ name: "sandbox", ready: true }] },
    })
    expect(await run(server, shell())).toMatchObject({ exitCode: 0 })
  })

  test("times out a program with a typed invoke error and deletes the pod", async () => {
    const server = await serve({ exec: () => {} })
    const error = await failure(run(server, shell("sleep 60"), { timeoutSeconds: 1 }))
    expect(error).toMatchObject({
      operation: "invoke",
      message: "Code Interpreter execution timed out after 1 seconds",
    })
    expect(server.created.size).toBe(0)
    await expect.poll(() => server.open()).toBe(0)
  })

  test("interruption deletes the pod and closes the exec", async () => {
    const server = await serve({ exec: () => {} })
    const running = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* make(runtime(server))
          return yield* executor.execute(shell("sleep 60"))
        }),
      ),
    )
    await expect.poll(() => server.open()).toBe(1)
    expect(server.created.size).toBe(1)
    await Effect.runPromise(Fiber.interrupt(running))
    expect(server.created.size).toBe(0)
    await expect.poll(() => server.open()).toBe(0)
  })

  test("a failing delete is logged, not raised, and does not change the result", async () => {
    const server = await serve({ remove: { status: 500, message: "etcd unavailable" } })
    expect(await run(server, shell())).toMatchObject({ exitCode: 0 })
    expect(server.calls.filter((call) => call.method === "DELETE")).toHaveLength(1)
  })

  test("refuses to run without a deny-all NetworkPolicy, before creating any pod", async () => {
    const server = await serve({ policies: () => [] })
    const error = await failure(run(server, shell(), { requireNetworkPolicy: true }))
    expect(error).toMatchObject({ operation: "start", message: expect.stringContaining("no NetworkPolicy") })
    expect(server.calls.some((call) => call.method === "POST")).toBe(false)
  })

  test("caches a successful policy check and re-verifies after it expires", async () => {
    const server = await serve({ policies: () => [denyAll] })
    let clock = Date.parse("2026-09-29T12:00:00Z")
    const current = runtime(server, { requireNetworkPolicy: true }, () => new Date(clock))
    const checks = () => server.calls.filter((call) => call.path.includes("networkpolicies")).length
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* make(current)
          yield* executor.execute(shell())
          yield* executor.execute(shell())
          expect(checks()).toBe(1)
          clock += 61_000
          yield* executor.execute(shell())
          expect(checks()).toBe(2)
        }),
      ),
    )
  })

  test("verify reports an API failure as a start error rather than assuming isolation", async () => {
    const server = await serve()
    await server.stop()
    expect(await failure(Effect.runPromise(verify(runtime(server, { requireNetworkPolicy: true }))))).toMatchObject({
      operation: "start",
    })
    fake = undefined
  })
})

describe("egress canary", () => {
  const canaryExec = (results: number[]) => {
    let attempt = 0
    return (socket: import("ws").WebSocket, request: import("node:http").IncomingMessage) => {
      const argv = new URL(request.url ?? "", "http://x").searchParams.getAll("command")
      if (argv[0] === "python3") {
        const code = results[Math.min(attempt++, results.length - 1)]!
        socket.send(frame(3, code === 0 ? success : exitStatus(code)))
      } else socket.send(frame(3, success))
      socket.close()
    }
  }
  const canaries = (server: Fake) =>
    server.calls.filter((call) => call.method === "UPGRADE" && call.path.includes("python3")).length

  test("waits until the CNI blocks egress, then runs the program", async () => {
    const server = await serve({ exec: canaryExec([1, 1, 0]) })
    expect(await run(server, shell(), { verifyEgress: true })).toMatchObject({ exitCode: 0 })
    expect(canaries(server)).toBe(3)
    expect(server.created.size).toBe(0)
  })

  test("fails closed when the pod can still reach the network at the start deadline", async () => {
    const server = await serve({ exec: canaryExec([1]) })
    const error = await failure(run(server, shell("echo secret"), { verifyEgress: true, startTimeoutSeconds: 5 }))
    expect(error).toMatchObject({ operation: "start", message: expect.stringContaining("could reach the network") })
    // The user's program never reached the pod.
    expect(server.calls.filter((call) => call.method === "UPGRADE" && call.path.includes("echo")).length).toBe(0)
    expect(server.created.size).toBe(0)
  }, 15_000)

  test("an inconclusive canary (no address to test) proceeds", async () => {
    const server = await serve({ exec: canaryExec([2]) })
    expect(await run(server, shell(), { verifyEgress: true })).toMatchObject({ exitCode: 0 })
  })

  test("a refused canary exec keeps its authorization message", async () => {
    const server = await serve({ refuse: { status: 403, message: "forbidden" } })
    expect(await failure(run(server, shell(), { verifyEgress: true }))).toMatchObject({
      operation: "invoke",
      message: expect.stringContaining("HTTP 403"),
    })
  })
})

describe("orphan sweep", () => {
  const pod = (name: string, created: string) => ({
    metadata: { name, labels: { "bymorning.io/created-at": created } },
  })
  const at = new Date("2026-09-29T12:00:00Z")
  const seconds = (age: number) => String(at.getTime() / 1000 - age)

  test("deletes only pods older than the maximum lifetime and lists by our labels", async () => {
    const limit = 5 + 10 + 30 + 60
    const server = await serve({
      pods: () => [
        pod("old", seconds(limit + 1)),
        pod("edge", seconds(limit)),
        pod("young", seconds(5)),
        { metadata: { name: "unknown" } },
      ],
    })
    server.created.add("old")
    const removed = await Effect.runPromise(
      sweep(runtime(server, { startTimeoutSeconds: 5, timeoutSeconds: 10 }, () => at)),
    )
    expect(removed).toEqual(["old"])
    const list = server.calls.find((call) => call.method === "GET")!
    expect(decodeURIComponent(list.path)).toContain(
      "labelSelector=app.kubernetes.io/managed-by=bymorning-code-interpreter,bymorning.io/installation=default",
    )
    expect(server.calls.filter((call) => call.method === "DELETE").map((call) => call.path.split("/").at(-1))).toEqual([
      "old",
    ])
  })

  test("startup sweeps and verifies, and never fails activation", async () => {
    const server = await serve({ pods: () => [pod("old", "1")], policies: () => [] })
    await Effect.runPromise(startup(runtime(server, { requireNetworkPolicy: true }, () => at)))
    expect(server.calls.some((call) => call.method === "DELETE")).toBe(true)
    await server.stop()
    await Effect.runPromise(startup(runtime(server, { requireNetworkPolicy: true })))
    fake = undefined
  })
})
