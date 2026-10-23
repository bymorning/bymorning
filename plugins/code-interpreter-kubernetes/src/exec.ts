import { CodeInterpreter } from "@bymorning/schema/code-interpreter"
import { Effect } from "effect"
import { WebSocket } from "ws"
import type { Credentials } from "./credentials.js"
import { Channel, exit, subprotocols } from "./protocol.js"

export const outputLimit = 100_000
const chunk = 64 * 1024

export interface Request {
  readonly credentials: Credentials
  readonly namespace: string
  readonly pod: string
  readonly container: string
  readonly argv: ReadonlyArray<string>
  readonly stdin: Uint8Array | undefined
  /** Offered subprotocols, most preferred first. Defaults to v5 with a v4 fallback. */
  readonly protocols?: ReadonlyArray<string>
}

const fail = (operation: CodeInterpreter.ExecutionError["operation"], message: string, cause?: unknown) =>
  new CodeInterpreter.ExecutionError({ operation, message, ...(cause === undefined ? {} : { cause }) })

/** Wire location of the exec sub-resource. Exported for tests. */
export const url = (request: Pick<Request, "credentials" | "namespace" | "pod" | "container" | "argv" | "stdin">) => {
  const target = new URL(request.credentials.server)
  target.protocol = target.protocol === "http:" ? "ws:" : "wss:"
  target.pathname = `${target.pathname.replace(/\/$/, "")}/api/v1/namespaces/${encodeURIComponent(request.namespace)}/pods/${encodeURIComponent(request.pod)}/exec`
  const query = new URLSearchParams({
    container: request.container,
    stdin: String(request.stdin !== undefined),
    stdout: "true",
    stderr: "true",
    tty: "false",
  })
  for (const argument of request.argv) query.append("command", argument)
  target.search = query.toString()
  return target
}

/**
 * Run one program in a running pod over the `pods/exec` WebSocket, keeping stdout and stderr separate and taking
 * the exit code from the status channel. Interruption terminates the socket. The combined output is capped at
 * `outputLimit` characters while streaming, so a runaway program cannot exhaust Gateway memory.
 */
export const run = (request: Request): Effect.Effect<CodeInterpreter.Output, CodeInterpreter.ExecutionError> =>
  Effect.callback<CodeInterpreter.Output, CodeInterpreter.ExecutionError>((resume) => {
    const token = request.credentials.token()
    const socket = new WebSocket(url(request), [...(request.protocols ?? subprotocols)], {
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
      ...(request.credentials.ca === undefined ? {} : { ca: request.credentials.ca }),
      ...(request.credentials.cert === undefined ? {} : { cert: request.credentials.cert }),
      ...(request.credentials.key === undefined ? {} : { key: request.credentials.key }),
      rejectUnauthorized: !request.credentials.insecure,
      perMessageDeflate: false,
      maxPayload: 1024 * 1024,
      handshakeTimeout: 30_000,
    })
    const decoders = { [Channel.stdout]: new TextDecoder(), [Channel.stderr]: new TextDecoder() }
    const text = { [Channel.stdout]: "", [Channel.stderr]: "" }
    const statuses: string[] = []
    let settled = false
    const settle = (effect: Effect.Effect<CodeInterpreter.Output, CodeInterpreter.ExecutionError>) => {
      if (settled) return
      settled = true
      resume(effect)
      socket.terminate()
    }

    socket.on("unexpected-response", (_, response) => {
      const parts: Buffer[] = []
      response.on("data", (part: Buffer) => parts.length < 8 && parts.push(part))
      response.on("end", () => {
        let message = `HTTP ${response.statusCode}`
        try {
          const body = JSON.parse(Buffer.concat(parts).toString("utf8")) as { message?: unknown }
          if (typeof body.message === "string") message += `: ${body.message}`
        } catch {}
        settle(Effect.fail(fail("invoke", `Kubernetes refused the exec request (${message})`)))
      })
      response.on("error", () => settle(Effect.fail(fail("invoke", "Kubernetes refused the exec request"))))
    })
    socket.on("error", (cause) => settle(Effect.fail(fail("invoke", "Kubernetes exec connection failed", cause))))
    socket.on("open", () => {
      if (!(request.protocols ?? subprotocols).some((protocol) => protocol === socket.protocol))
        return settle(
          Effect.fail(fail("stream", `Kubernetes exec negotiated unsupported protocol "${socket.protocol}"`)),
        )
      if (request.stdin === undefined) return
      const stdin = request.stdin
      const send = (offset: number) => {
        if (settled || offset >= stdin.length) return
        const end = Math.min(offset + chunk, stdin.length)
        const frame = new Uint8Array(end - offset + 1)
        frame[0] = Channel.stdin
        frame.set(stdin.subarray(offset, end), 1)
        // Sequential sends honor socket backpressure instead of buffering a large program twice.
        socket.send(frame, { binary: true }, (cause) => {
          // After the process exits the server closes the socket; leftover stdin is discarded, not an error.
          if (cause && socket.readyState === WebSocket.OPEN)
            settle(Effect.fail(fail("stream", "Failed to send code to Kubernetes exec", cause)))
          else if (!cause) send(end)
        })
      }
      send(0)
    })
    socket.on("message", (data: Buffer, isBinary) => {
      if (settled) return
      if (!isBinary || data.length === 0) return settle(Effect.fail(fail("stream", "Malformed Kubernetes exec frame")))
      const channel = data[0]
      const payload = data.subarray(1)
      if (channel === Channel.stdout || channel === Channel.stderr) {
        text[channel] += decoders[channel].decode(payload, { stream: true })
        if (text[Channel.stdout].length + text[Channel.stderr].length > outputLimit)
          settle(Effect.fail(fail("output", `Code Interpreter output exceeded ${outputLimit} characters`)))
      } else if (channel === Channel.status) statuses.push(payload.toString("utf8"))
      // Other channels (resize, v5 close, unknown) carry nothing we use.
    })
    socket.on("close", () => {
      if (settled) return
      const status = statuses.join("")
      if (status === "")
        return settle(Effect.fail(fail("stream", "Kubernetes exec closed without reporting an exit status")))
      const result = exit(status)
      if (result.type === "failure")
        return settle(Effect.fail(fail("invoke", `Kubernetes exec failed: ${result.message}`)))
      const stdout = text[Channel.stdout] + decoders[Channel.stdout].decode()
      const stderr = text[Channel.stderr] + decoders[Channel.stderr].decode()
      if (stdout.length + stderr.length > outputLimit)
        return settle(Effect.fail(fail("output", `Code Interpreter output exceeded ${outputLimit} characters`)))
      settle(Effect.succeed({ stdout, stderr, exitCode: result.code }))
    })
    return Effect.sync(() => {
      settled = true
      socket.terminate()
    })
  })
