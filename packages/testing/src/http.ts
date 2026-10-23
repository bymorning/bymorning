/** Scoped external HTTP endpoint; records actual requests, never Application responses. */
export * as TestHTTP from "./http.js"

import { Effect } from "effect"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

export interface Request {
  readonly method: string
  readonly url: string
  readonly authorization: string | undefined
}

/** Supply the external protocol behavior; the scope owns the listener and sockets. */
export const make = (respond: (request: IncomingMessage, response: ServerResponse) => void) =>
  Effect.gen(function* () {
    const requests: Request[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => createServer((request, response) => {
        requests.push({ method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization })
        respond(request, response)
      })),
      (server) => Effect.promise(() => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
        server.closeAllConnections()
      })),
    )
    yield* Effect.tryPromise(() => new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject)
        resolve()
      })
    }))
    const origin = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    return { origin, requests: () => [...requests] }
  })
