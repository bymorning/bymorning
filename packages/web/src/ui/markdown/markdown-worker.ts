/* oxlint-disable unicorn/prefer-add-event-listener, unicorn/require-post-message-target-origin -- Worker messaging has no target origin. */
import type { Projection } from "./markdown-stream"
import { createWorkerTransport } from "./markdown-worker-transport"
import {
  applyMarkdownWorkerResponse,
  shouldReleaseMarkdownWorkerState,
  type MarkdownWorkerRequest,
  type MarkdownWorkerResponse,
  type MarkdownWorkerState,
} from "./markdown-worker-protocol"

type HighlightPending = {
  readonly key: string
  readonly complete: boolean
  readonly resolve: (state: MarkdownWorkerState) => void
  readonly reject: (error: Error) => void
}
type ProjectPending = {
  readonly key: string
  readonly resolve: (projection: Projection) => void
  readonly reject: (error: Error) => void
}
type ParsePending = { readonly resolve: (html: string) => void; readonly reject: (error: Error) => void }

type MarkdownWorkerInstance = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror"
>

let worker: MarkdownWorkerInstance | undefined
let disabled: Error | undefined
let nextID = 0
const pending = new Map<number, HighlightPending>()
const projects = new Map<number, ProjectPending>()
const parses = new Map<number, ParsePending>()
const states = new Map<string, MarkdownWorkerState>()
const keys = new Set<string>()
const latest = new Map<string, number>()
// Tests inject an in-process fake via injectMarkdownWorkerFactory instead of a real module Worker.
let createWorker: () => MarkdownWorkerInstance = () =>
  new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" })
const transport = createWorkerTransport<Extract<MarkdownWorkerRequest, { type: "highlight" }>>({
  post: (request) => worker!.postMessage(request),
  supersede: (request) => rejectPending(pending, request.id, new MarkdownWorkerSupersededError()),
})
const projectTransport = createWorkerTransport<Extract<MarkdownWorkerRequest, { type: "project" }>>({
  post: (request) => worker!.postMessage(request),
  supersede: (request) => rejectPending(projects, request.id, new MarkdownWorkerSupersededError()),
})

export function parseMarkdown(text: string) {
  const instance = getWorker()
  const id = ++nextID
  return new Promise<string>((resolve, reject) => {
    parses.set(id, { resolve, reject })
    instance.postMessage({ type: "parse", id, text } satisfies MarkdownWorkerRequest)
  })
}

export function projectMarkdown(key: string, text: string, live: boolean) {
  getWorker()
  const id = ++nextID
  return new Promise<Projection>((resolve, reject) => {
    projects.set(id, { key, resolve, reject })
    projectTransport.send({ type: "project", id, key, text, live })
  })
}

export function disposeMarkdownProjection(key: string) {
  projectTransport.dispose(key)
  projects.forEach((request, id) => {
    if (request.key === key) rejectPending(projects, id, new MarkdownWorkerDisposedError())
  })
  worker?.postMessage({ type: "dispose", key } satisfies MarkdownWorkerRequest)
}

export function highlightStreamingCode(key: string, text: string, language: string, complete = false) {
  getWorker()
  const id = ++nextID
  latest.set(key, id)
  keys.delete(key)
  keys.add(key)
  if (keys.size > 200) disposeStreamingCode(keys.values().next().value!)
  return new Promise<MarkdownWorkerState>((resolve, reject) => {
    pending.set(id, { key, complete, resolve, reject })
    transport.send({ type: "highlight", id, key, text, language, complete })
  })
}

export function disposeStreamingCode(key: string) {
  keys.delete(key)
  latest.delete(key)
  states.delete(key)
  transport.dispose(key)
  pending.forEach((request, id) => {
    if (request.key === key) rejectPending(pending, id, new MarkdownWorkerDisposedError())
  })
  worker?.postMessage({ type: "dispose", key } satisfies MarkdownWorkerRequest)
}

export class MarkdownWorkerDisposedError extends Error {}
export class MarkdownWorkerSupersededError extends Error {}
export class MarkdownWorkerUnavailableError extends Error {}

export function injectMarkdownWorkerFactory(create: () => MarkdownWorkerInstance) {
  createWorker = create
}

function getWorker() {
  if (worker) return worker
  if (disabled) throw new MarkdownWorkerUnavailableError(disabled.message)
  try {
    worker = createWorker()
  } catch (error) {
    disabled = error instanceof Error ? error : new Error(String(error))
    throw new MarkdownWorkerUnavailableError(disabled.message)
  }
  worker.onmessage = handleMessage
  const fail = (message: string) => {
    const error = new Error(message)
    disabled = error
    transport.reset()
    projectTransport.reset()
    pending.forEach((request) => request.reject(error))
    projects.forEach((request) => request.reject(error))
    parses.forEach((request) => request.reject(error))
    pending.clear()
    projects.clear()
    parses.clear()
    states.clear()
    keys.clear()
    latest.clear()
    worker?.terminate()
    worker = undefined
  }
  worker.onerror = (event) => fail(event.message || "Markdown worker failed")
  worker.onmessageerror = () => fail("Markdown worker response failed")
  return worker
}

function handleMessage(event: MessageEvent<MarkdownWorkerResponse>) {
  const response = event.data
  if (response.type === "parse") {
    const result = parses.get(response.id)
    if (!result) return
    parses.delete(response.id)
    result.resolve(response.html)
    return
  }
  if (response.type === "project") {
    const result = projects.get(response.id)
    if (result) {
      projects.delete(response.id)
      result.resolve(response.projection)
    }
    projectTransport.complete(response.key, response.id)
    return
  }
  if (response.type === "error") {
    const parsed = parses.get(response.id)
    if (parsed) {
      parses.delete(response.id)
      parsed.reject(new Error(response.message))
      return
    }
    const projected = projects.get(response.id)
    if (projected) {
      projects.delete(response.id)
      projected.reject(new Error(response.message))
      projectTransport.complete(projected.key, response.id)
      return
    }
  }
  if (response.type === "superseded") {
    const projected = projects.get(response.id)
    if (projected) {
      projects.delete(response.id)
      projected.reject(new MarkdownWorkerSupersededError())
      projectTransport.complete(projected.key, response.id)
      return
    }
  }
  if (!("key" in response) || !response.key) return
  const result = pending.get(response.id)
  if (!result) {
    transport.complete(response.key, response.id)
    return
  }
  pending.delete(response.id)
  if (!keys.has(response.key)) result.reject(new MarkdownWorkerDisposedError())
  else if (response.type === "superseded") result.reject(new MarkdownWorkerSupersededError())
  else if (response.type === "error") result.reject(new Error(response.message))
  else {
    const state = applyMarkdownWorkerResponse(states.get(response.key), response)
    if (shouldReleaseMarkdownWorkerState(result.complete, latest.get(response.key), response.id)) {
      states.delete(response.key)
      keys.delete(response.key)
      latest.delete(response.key)
    } else states.set(response.key, state)
    result.resolve(state)
  }
  transport.complete(response.key, response.id)
}

function rejectPending<T extends { reject: (error: Error) => void }>(items: Map<number, T>, id: number, error: Error) {
  const item = items.get(id)
  if (!item) return
  items.delete(id)
  item.reject(error)
}
