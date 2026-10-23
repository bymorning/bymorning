import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocketServer, type WebSocket } from "ws"
import type { Credentials } from "../src/credentials.js"
import type { PodStatus } from "../src/cluster.js"

export interface Call {
  readonly method: string
  readonly path: string
  readonly body: unknown
  readonly authorization: string | undefined
}
export interface Behavior {
  /** Reply to pod creation; default 201. */
  create?: (body: { metadata: { name: string } }) => { status: number; body: unknown } | undefined
  /** Status of a pod on GET; default Running and ready. */
  status?: (name: string, reads: number) => PodStatus["status"]
  pods?: () => ReadonlyArray<PodStatus>
  policies?: () => ReadonlyArray<unknown>
  /** Serve one exec WebSocket. Default: exit 0 with no output. */
  exec?: (socket: WebSocket, request: IncomingMessage) => void
  /** Subprotocol the server accepts, in its preference order. Default v5 then v4. */
  protocols?: ReadonlyArray<string>
  /** Fail pod deletion. */
  remove?: { status: number; message: string }
  /** Refuse the exec upgrade with this HTTP status. */
  refuse?: { status: number; message: string }
}

export const frame = (channel: number, payload: string | Uint8Array) =>
  Buffer.concat([Buffer.from([channel]), typeof payload === "string" ? Buffer.from(payload) : Buffer.from(payload)])
export const success = JSON.stringify({ status: "Success", metadata: {} })
export const exitStatus = (code: number) =>
  JSON.stringify({
    status: "Failure",
    reason: "NonZeroExitCode",
    message: `command terminated with non-zero exit code: exit status ${code}`,
    details: { causes: [{ reason: "ExitCode", message: String(code) }] },
  })

/** A plain-HTTP fake API server with a WebSocket exec endpoint. Records every call for assertions. */
export const start = async (behavior: Behavior = {}) => {
  const calls: Call[] = []
  const reads = new Map<string, number>()
  const created = new Set<string>()
  const sockets = new Set<WebSocket>()
  const websockets = new WebSocketServer({
    noServer: true,
    handleProtocols: (offered) =>
      (behavior.protocols ?? ["v5.channel.k8s.io", "v4.channel.k8s.io"]).find((entry) => offered.has(entry)) ?? false,
  })
  const server: Server = createServer((request, response) => {
    const parts: Buffer[] = []
    request.on("data", (part: Buffer) => parts.push(part))
    request.on("end", () => {
      const raw = Buffer.concat(parts).toString("utf8")
      const path = request.url ?? ""
      calls.push({
        method: request.method ?? "",
        path,
        body: raw === "" ? undefined : JSON.parse(raw),
        authorization: request.headers.authorization,
      })
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" })
        response.end(JSON.stringify(body))
      }
      const name = /\/pods\/([^/?]+)/.exec(path)?.[1]
      if (request.method === "POST" && path.endsWith("/pods")) {
        const body = JSON.parse(raw) as { metadata: { name: string } }
        const override = behavior.create?.(body)
        if (override !== undefined) return reply(override.status, override.body)
        created.add(body.metadata.name)
        return reply(201, body)
      }
      if (request.method === "GET" && name !== undefined) {
        const count = (reads.get(name) ?? 0) + 1
        reads.set(name, count)
        return reply(200, {
          metadata: { name },
          status: behavior.status?.(name, count) ?? {
            phase: "Running",
            containerStatuses: [{ name: "sandbox", ready: true, state: { running: {} } }],
          },
        })
      }
      if (request.method === "DELETE" && name !== undefined) {
        if (behavior.remove !== undefined)
          return reply(behavior.remove.status, { status: "Failure", message: behavior.remove.message })
        const existed = created.delete(name)
        return existed
          ? reply(200, { status: "Success" })
          : reply(404, { status: "Failure", reason: "NotFound", message: "gone" })
      }
      if (request.method === "GET" && path.includes("/networkpolicies"))
        return reply(200, { items: behavior.policies?.() ?? [] })
      if (request.method === "GET" && path.includes("/pods")) return reply(200, { items: behavior.pods?.() ?? [] })
      return reply(404, { status: "Failure", reason: "NotFound", message: `unhandled ${request.method} ${path}` })
    })
  })
  server.on("upgrade", (request, socket, head) => {
    calls.push({
      method: "UPGRADE",
      path: request.url ?? "",
      body: undefined,
      authorization: request.headers.authorization,
    })
    if (behavior.refuse !== undefined) {
      const body = JSON.stringify({ status: "Failure", message: behavior.refuse.message })
      socket.end(
        `HTTP/1.1 ${behavior.refuse.status} Refused\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      )
      return
    }
    websockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.add(websocket)
      websocket.on("close", () => sockets.delete(websocket))
      if (behavior.exec === undefined) {
        websocket.send(frame(3, success))
        websocket.close()
      } else behavior.exec(websocket, request)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  const credentials: Credentials = {
    server: new URL(`http://127.0.0.1:${port}`),
    ca: undefined,
    cert: undefined,
    key: undefined,
    insecure: false,
    token: () => "test-token",
  }
  return {
    calls,
    credentials,
    created,
    open: () => sockets.size,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.terminate()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
export type Fake = Awaited<ReturnType<typeof start>>
