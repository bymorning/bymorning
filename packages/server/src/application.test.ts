import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http"
import { afterEach, describe, expect, it } from "vitest"
import { connect } from "node:tls"
import { request } from "node:https"
import { Application } from "./application.js"
import { cert, key } from "../test/fixtures/tls.js"

const runtimes = Array<ManagedRuntime.ManagedRuntime<HttpServer.HttpServer, unknown>>()

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

const listen = async (tls?: Application.TLS) => {
  const health = HttpRouter.add("GET", "/system/health", Effect.succeed(HttpServerResponse.text("ok")))
  const runtime = ManagedRuntime.make(
    HttpRouter.serve(health, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => Application.listener(tls), { host: "127.0.0.1", port: 0 })),
    ),
  )
  runtimes.push(runtime)
  const server = await runtime.runPromise(HttpServer.HttpServer)
  const address = server.address
  if (address._tag !== "TcpAddress") throw new Error("expected a TCP listener")
  return address.port
}

const get = (port: number) =>
  new Promise<{ status: number; body: string; protocol: string | null; cipher: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/system/health", rejectUnauthorized: false }, (res) => {
      const socket = res.socket as import("node:tls").TLSSocket
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => (body += chunk))
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher().standardName,
        }),
      )
    })
    req.on("error", reject)
    req.end()
  })

const handshake = (port: number, options: import("node:tls").ConnectionOptions) =>
  new Promise<string>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ...options })
    socket.once("secureConnect", () => {
      socket.destroy()
      resolve("connected")
    })
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message))
  })

describe("Application.listener", () => {
  it("serves plain HTTP without TLS settings", async () => {
    const port = await listen()
    const response = await fetch(`http://127.0.0.1:${port}/system/health`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("ok")
  })

  it("serves HTTPS with the configured certificate using approved suites", async () => {
    const port = await listen({ key: Redacted.make(key), cert })
    const response = await get(port)
    expect(response.status).toBe(200)
    expect(response.body).toBe("ok")
    expect(response.protocol).toBe("TLSv1.3")
    expect(Application.ciphers.split(":")).toContain(response.cipher)
  })

  it("rejects TLS 1.1 and non-approved TLS 1.2 suites", async () => {
    const port = await listen({ key: Redacted.make(key), cert })
    expect(await handshake(port, { minVersion: "TLSv1.1", maxVersion: "TLSv1.1" })).not.toBe("connected")
    expect(
      await handshake(port, { maxVersion: "TLSv1.2", ciphers: "ECDHE-ECDSA-CHACHA20-POLY1305:AES128-SHA256" }),
    ).not.toBe("connected")
    expect(await handshake(port, { maxVersion: "TLSv1.2", ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256" })).toBe("connected")
  })
})
