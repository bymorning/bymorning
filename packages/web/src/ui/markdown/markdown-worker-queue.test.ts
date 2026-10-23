import { describe, expect, it } from "vitest"

import { createLatestWorkerQueue } from "./markdown-worker-queue"

type Request = { key: string; label: string }

// Lets every pending microtask (the queue's scheduler loop) settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createLatestWorkerQueue", () => {
  it("runs queued requests serially in arrival order", async () => {
    const ran: string[] = []
    const release = Promise.withResolvers<void>()
    let firstRun = false
    const queue = createLatestWorkerQueue<Request>({
      run: async (request) => {
        ran.push(request.label)
        if (!firstRun) {
          firstRun = true
          await release.promise
        }
      },
      supersede: () => {},
      dispose: () => {},
    })

    queue.enqueue({ key: "a", label: "a1" })
    queue.enqueue({ key: "b", label: "b1" })
    await flush()
    expect(ran).toEqual(["a1"])

    release.resolve()
    await flush()
    expect(ran).toEqual(["a1", "b1"])
  })

  it("coalesces queued requests per key and only runs the latest", async () => {
    const ran: string[] = []
    const superseded: string[] = []
    const queue = createLatestWorkerQueue<Request>({
      run: async (request) => {
        ran.push(request.label)
      },
      supersede: (request) => {
        superseded.push(request.label)
      },
      dispose: () => {},
    })

    queue.enqueue({ key: "a", label: "a1" })
    queue.enqueue({ key: "a", label: "a2" })
    queue.enqueue({ key: "a", label: "a3" })
    await flush()

    expect(ran).toEqual(["a3"])
    expect(superseded).toEqual(["a1", "a2"])
  })

  it("keeps key arrival order while collapsing repeated enqueues onto the latest payload", async () => {
    const ran: string[] = []
    const superseded: string[] = []
    const queue = createLatestWorkerQueue<Request>({
      run: async (request) => {
        ran.push(request.label)
      },
      supersede: (request) => {
        superseded.push(request.label)
      },
      dispose: () => {},
    })

    queue.enqueue({ key: "k", label: "k1" })
    queue.enqueue({ key: "m", label: "m1" })
    queue.enqueue({ key: "k", label: "k2" })
    queue.enqueue({ key: "k", label: "k3" })
    await flush()

    expect(ran).toEqual(["k3", "m1"])
    expect(superseded).toEqual(["k1", "k2"])
  })

  it("queues requests that arrive while another run is in flight and coalesces them", async () => {
    const ran: string[] = []
    const superseded: string[] = []
    const release = Promise.withResolvers<void>()
    const queue = createLatestWorkerQueue<Request>({
      run: async (request) => {
        ran.push(request.label)
        if (request.label === "a1") await release.promise
      },
      supersede: (request) => {
        superseded.push(request.label)
      },
      dispose: () => {},
    })

    queue.enqueue({ key: "a", label: "a1" })
    await flush()
    queue.enqueue({ key: "b", label: "b1" })
    queue.enqueue({ key: "b", label: "b2" })
    release.resolve()
    await flush()

    expect(ran).toEqual(["a1", "b2"])
    expect(superseded).toEqual(["b1"])
  })

  it("supersedes a pending request when its key is disposed and disposes unknown keys too", async () => {
    const superseded: string[] = []
    const disposed: string[] = []
    const queue = createLatestWorkerQueue<Request>({
      run: async () => {},
      supersede: (request) => {
        superseded.push(request.label)
      },
      dispose: (key) => {
        disposed.push(key)
      },
    })

    queue.enqueue({ key: "a", label: "a1" })
    queue.dispose("a")
    queue.dispose("missing")
    await flush()

    expect(superseded).toEqual(["a1"])
    expect(disposed).toEqual(["a", "missing"])
  })

  it("restarts the queue when requests arrive after a drain", async () => {
    const ran: string[] = []
    const queue = createLatestWorkerQueue<Request>({
      run: async (request) => {
        ran.push(request.label)
      },
      supersede: () => {},
      dispose: () => {},
    })

    queue.enqueue({ key: "a", label: "a1" })
    await flush()
    queue.enqueue({ key: "a", label: "a2" })
    await flush()

    expect(ran).toEqual(["a1", "a2"])
  })
})
