import { ByMorning } from "@bymorning/client"
import type * as SDK from "@bymorning/client"
import { createEffect, createRoot, type Accessor } from "solid-js"
import type { EventSource } from "@bymorning/client/solid"

/** A controllable HTTP/SSE boundary around the real generated client. */
export class Gate<T> {
  #resolve!: (value: T) => void
  #reject!: (cause: unknown) => void
  readonly promise = new Promise<T>((resolve, reject) => {
    this.#resolve = resolve
    this.#reject = reject
  })
  resolve(value: T) { this.#resolve(value) }
  reject(cause: unknown) { this.#reject(cause) }
}

export type Request = { readonly url: URL; readonly init: RequestInit }

export const ids = {
  workspace: "wrk_solid_contract" as SDK.WorkspaceListOutput[number]["id"],
  session: "00000000-0000-4000-8000-000000000002" as SDK.SessionInfo["id"],
  other: "00000000-0000-4000-8000-000000000003" as SDK.SessionInfo["id"],
  message: "00000000-0000-4000-8000-000000000004" as SDK.MessageListOutput["data"][number]["id"],
}

const now = "2025-01-01T00:00:00.000Z"
export const session = (id = ids.session) => ({
  id, projectID: "prj_00000000000000000000000000", title: "Test", agent: "agent", model: { id: "model", provider: "provider" }, createdAt: now, updatedAt: now,
})
export const detail = (id = ids.session) => ({
  ...session(id), usage: { cost: 0, costComplete: true, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
})
export const message = (id = ids.message, sequence = 1) => ({
  id, sessionID: ids.session, sequence, createdAt: now, type: "user", text: "hello", admittedSequence: sequence,
})
export const admission = (id = ids.message) => ({
  id, sessionID: ids.session, text: "hello", admittedSequence: 1, createdAt: now,
})

export class TestTransport {
  readonly requests: Request[] = []
  readonly aborts: AbortSignal[] = []
  #handlers: Array<(request: Request) => Response | Promise<Response> | undefined> = []
  #receipts: Array<{ readonly match: (request: Request) => boolean; readonly gate: Gate<Request> }> = []
  #finishes: Array<{ readonly match: (request: Request) => boolean; readonly gate: Gate<Request> }> = []
  #sse?: ReadableStreamDefaultController<Uint8Array>

  readonly api: SDK.ByMorningClient

  constructor() {
    this.api = ByMorning.make({ baseUrl: "http://solid.test", fetch: this.fetch })
  }

  fetch: typeof fetch = async (input, init = {}) => {
    const request = { url: new URL(input.toString()), init }
    this.requests.push(request)
    for (const receipt of this.#receipts.splice(0)) {
      if (receipt.match(request)) receipt.gate.resolve(request)
      else this.#receipts.push(receipt)
    }
    if (init.signal) {
      this.aborts.push(init.signal)
      if (init.signal.aborted) throw new DOMException("Aborted", "AbortError")
    }
    for (const handler of this.#handlers) {
      const response = handler(request)
      if (response !== undefined) {
        const value = await response
        this.finished(request)
        return value
      }
    }
    const value = this.default(request)
    this.finished(request)
    return value
  }

  when(match: (request: Request) => boolean, response: Response | Promise<Response> | ((request: Request) => Response | Promise<Response>)) {
    this.#handlers.unshift((request) => {
      if (!match(request)) return undefined
      const value = typeof response === "function" ? response(request) : response
      return Promise.resolve(value).then((result) => result.clone())
    })
  }

  count(path: string) { return this.requests.filter((request) => request.url.pathname === path).length }

  /** Resolves at the physical generated-SDK request boundary; never polls. */
  receipt(match: string | ((request: Request) => boolean)) {
    const matches = typeof match === "string" ? (request: Request) => request.url.pathname === match : match
    const existing = this.requests.find(matches)
    if (existing) return Promise.resolve(existing)
    const gate = new Gate<Request>()
    this.#receipts.push({ match: matches, gate })
    return gate.promise
  }

  receiptAfter(index: number, match: string | ((request: Request) => boolean)) {
    const matches = typeof match === "string" ? (request: Request) => request.url.pathname === match : match
    const existing = this.requests.slice(index).find(matches)
    if (existing) return Promise.resolve(existing)
    const gate = new Gate<Request>()
    this.#receipts.push({ match: (request) => this.requests.indexOf(request) >= index && matches(request), gate })
    return gate.promise
  }

  finishAfter(index: number, match: string | ((request: Request) => boolean)) {
    const matches = typeof match === "string" ? (request: Request) => request.url.pathname === match : match
    const gate = new Gate<Request>()
    this.#finishes.push({ match: (request) => this.requests.indexOf(request) >= index && matches(request), gate })
    return gate.promise
  }

  private finished(request: Request) {
    for (const finish of this.#finishes.splice(0)) {
      if (finish.match(request)) finish.gate.resolve(request)
      else this.#finishes.push(finish)
    }
  }

  event(event: SDK.WorkspaceEventItem) {
    this.#sse?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  }

  close() { this.#sse?.close() }

  private default(request: Request): Response {
    const { pathname } = request.url
    if (pathname === "/api/event") {
      return new Response(new ReadableStream({ start: (controller) => { this.#sse = controller } }), {
        headers: { "content-type": "text/event-stream" },
      })
    }
    if (pathname === "/api/project") return json([])
    if (pathname === "/api/agent" || pathname === "/api/model") return json([])
    if (pathname === "/api/session") return json({ data: [] })
    if (pathname === "/api/session/active") return json({})
    if (pathname.endsWith("/message")) return json({ data: [], cursor: {} })
    if (pathname.endsWith("/inbox")) return json({ data: [] })
    if (/^\/api\/session\/[^/]+$/.test(pathname)) return json(detail(pathname.endsWith(ids.other) ? ids.other : ids.session))
    if (pathname.endsWith("/permission") || pathname.endsWith("/form")) return json([])
    throw new Error(`Unhandled generated SDK request: ${request.init.method} ${pathname}`)
  }
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export function owner<T>(make: () => T) {
  let value!: T
  let dispose!: () => void
  createRoot((cleanup) => { dispose = cleanup; value = make() })
  return { value, dispose: () => dispose() }
}

export const turn = () => Promise.resolve().then(() => Promise.resolve())

/** An ordered, application-controlled event source for Data tests. */
export class TestEvents implements EventSource {
  #listeners: Array<(event: SDK.WorkspaceEventItem) => void> = []

  on<T extends SDK.WorkspaceEventItem["type"]>(type: T, listener: (event: Extract<SDK.WorkspaceEventItem, { type: T }>) => void) {
    return this.listen((event) => {
      if (event.type === type) listener(event as Extract<SDK.WorkspaceEventItem, { type: T }>)
    })
  }

  listen(listener: (event: SDK.WorkspaceEventItem) => void) {
    this.#listeners.push(listener)
    return () => { this.#listeners = this.#listeners.filter((entry) => entry !== listener) }
  }

  emit(event: SDK.WorkspaceEventItem) {
    for (const listener of this.#listeners) listener(event)
  }
}

/** Resolves from Solid's reactive graph, rather than a scheduler delay. */
export function until<T>(read: Accessor<T>, matches: (value: T) => boolean) {
  const gate = new Gate<T>()
  let dispose: () => void = () => {}
  createRoot((cleanup) => {
    dispose = cleanup
    createEffect(() => {
      const value = read()
      if (matches(value)) {
        gate.resolve(value)
        dispose()
      }
    })
  })
  return gate.promise
}
