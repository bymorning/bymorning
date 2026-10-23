import { batch, getOwner, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import * as SDK from "../promise/index.js"

export type ConnectionError = SDK.ClientError | SDK.ServiceUnavailableError | SDK.UnauthorizedError | SDK.ForbiddenError
export type ConnectionState =
  | { readonly state: "connecting" }
  | { readonly state: "connected" }
  | { readonly state: "reconnecting"; readonly attempt: number; readonly error: ConnectionError }
  | { readonly state: "blocked"; readonly error: ConnectionError }
  | { readonly state: "disposed" }
export interface EventSource {
  readonly on: <T extends SDK.WorkspaceEventItem["type"]>(
    type: T,
    listener: (event: Extract<SDK.WorkspaceEventItem, { type: T }>) => void,
  ) => VoidFunction
  readonly listen: (listener: (event: SDK.WorkspaceEventItem) => void) => VoidFunction
}
export interface Connection extends EventSource {
  readonly state: () => ConnectionState
  readonly retry: () => void
  readonly dispose: () => void
}
export interface ConnectionInput {
  readonly api: Pick<SDK.ByMorningClient, "event">
  readonly workspace: SDK.WorkspaceListOutput[number]["id"]
  readonly report?: (cause: unknown) => void
}

const terminal = (event: SDK.WorkspaceEventItem) =>
  event.type === "session.execution.succeeded" ||
  event.type === "session.execution.failed" ||
  event.type === "session.execution.interrupted" ||
  event.type === "session.compaction.ended" ||
  event.type === "session.compaction.failed" ||
  event.type === "session.run.succeeded" ||
  event.type === "session.run.failed" ||
  event.type === "session.run.interrupted"
const clientError = (cause?: unknown) =>
  new SDK.ClientError("Transport", { cause: cause instanceof Error ? cause : undefined })

export const createConnection = (input: ConnectionInput): Connection => {
  if (getOwner() === null) throw new Error("createConnection must run under a Solid owner")
  const report = input.report ?? console.error
  const [store, setStore] = createStore<{ state: ConnectionState }>({ state: { state: "connecting" } })
  const listeners = new Set<(event: SDK.WorkspaceEventItem) => void>()
  let disposed = false,
    connecting = false,
    attempt = 0
  let controller: AbortController | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let queued: SDK.WorkspaceEventItem[] = []
  const deliver = (event: SDK.WorkspaceEventItem) => {
    for (const listener of [...listeners]) {
      if (disposed) break
      try {
        listener(event)
      } catch (cause) {
        report(cause)
      }
    }
  }
  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = undefined
    const events = queued
    queued = []
    batch(() => {
      for (const event of events) {
        if (disposed) break
        deliver(event)
      }
    })
  }
  const publish = (event: SDK.WorkspaceEventItem) => {
    if (terminal(event)) {
      flush()
      deliver(event)
      return
    }
    queued.push(event)
    flushTimer ??= setTimeout(flush, 16)
  }
  const reconnect = (error: ConnectionError) => {
    if (disposed) return
    if (SDK.isUnauthorizedError(error) || SDK.isForbiddenError(error)) {
      setStore("state", reconcile({ state: "blocked", error }))
      return
    }
    attempt += 1
    setStore("state", reconcile({ state: "reconnecting", attempt, error }))
    const delay = Math.max(
      1_000,
      Math.round(Math.min(1_000 * 2 ** (attempt - 1), 10_000) * (0.5 + Math.random() * 0.5)),
    )
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect()
    }, delay)
  }
  const connect = async (): Promise<void> => {
    if (disposed || connecting) return
    connecting = true
    if (!attempt) setStore("state", reconcile({ state: "connecting" }))
    const current = (controller = new AbortController())
    let iterator: AsyncIterator<SDK.WorkspaceEventItem> | undefined
    try {
      iterator = input.api.event
        .subscribe({ workspace: input.workspace }, { signal: current.signal })
        [Symbol.asyncIterator]()
      const first = await iterator.next()
      if (current.signal.aborted || disposed) return
      if (first.done || first.value.type !== "server.connected") {
        reconnect(clientError())
        return
      }
      attempt = 0
      setStore("state", reconcile({ state: "connected" }))
      publish(first.value)
      for (;;) {
        const next = await iterator.next()
        if (current.signal.aborted || disposed) return
        if (next.done) {
          reconnect(clientError())
          return
        }
        publish(next.value)
      }
    } catch (cause) {
      if (current.signal.aborted || disposed) return
      if (
        cause instanceof SDK.ClientError ||
        SDK.isServiceUnavailableError(cause) ||
        SDK.isUnauthorizedError(cause) ||
        SDK.isForbiddenError(cause)
      )
        reconnect(cause)
      else {
        report(cause)
        reconnect(clientError(cause))
      }
    } finally {
      current.abort()
      try {
        void Promise.resolve(iterator?.return?.()).catch(report)
      } catch (cause) {
        report(cause)
      }
      if (controller === current) {
        controller = undefined
        connecting = false
      }
    }
  }
  void connect()
  const dispose = () => {
    if (disposed) return
    disposed = true
    controller?.abort()
    if (flushTimer) clearTimeout(flushTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    flushTimer = reconnectTimer = undefined
    queued = []
    setStore("state", reconcile({ state: "disposed" }))
    listeners.clear()
  }
  onCleanup(dispose)
  const listen = (listener: (event: SDK.WorkspaceEventItem) => void) => {
    if (disposed) return () => undefined
    listeners.add(listener)
    let active = true
    const off = () => {
      if (active) {
        active = false
        listeners.delete(listener)
      }
    }
    if (getOwner()) onCleanup(off)
    return off
  }
  return {
    state: () => store.state,
    listen,
    on: (type, listener) =>
      listen((event) => {
        if (event.type === type) listener(event as Extract<SDK.WorkspaceEventItem, { type: typeof type }>)
      }),
    retry: () => {
      if (disposed || connecting) return
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      controller?.abort()
      attempt = 0
      void connect()
    },
    dispose,
  }
}
