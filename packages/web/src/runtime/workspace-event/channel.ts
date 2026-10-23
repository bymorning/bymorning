export function createChannel<A>(capacity: number) {
  const values: A[] = []
  let waiting: ((result: IteratorResult<A>) => void) | undefined
  let closed = false
  return {
    send(value: A) {
      if (closed) return
      if (waiting !== undefined) {
        const resolve = waiting
        waiting = undefined
        resolve({ done: false, value })
        return
      }
      if (values.length >= capacity) throw new Error("Workspace event virtual channel overflow")
      values.push(value)
    },
    close() {
      closed = true
      values.splice(0)
      waiting?.({ done: true, value: undefined })
      waiting = undefined
    },
    async *read(signal: AbortSignal): AsyncIterable<A> {
      while (!signal.aborted) {
        if (closed) return
        if (values.length > 0) {
          yield values.shift()!
          continue
        }
        const result = await new Promise<IteratorResult<A>>((resolve) => {
          const abort = () => {
            waiting = undefined
            resolve({ done: true, value: undefined })
          }
          waiting = (result) => {
            signal.removeEventListener("abort", abort)
            resolve(result)
          }
          signal.addEventListener("abort", abort, { once: true })
        })
        if (result.done) return
        yield result.value
      }
    },
  }
}

export function createMulticast<A>(capacity: number) {
  const subscribers = new Set<{ readonly send: (value: A) => void; readonly close: () => void }>()
  let closed = false
  return {
    send(value: A) {
      if (closed) return
      for (const subscriber of subscribers) subscriber.send(value)
    },
    close() {
      closed = true
      for (const subscriber of subscribers) subscriber.close()
    },
    read(signal: AbortSignal): AsyncIterable<A> {
      if (closed) return (async function* () {})()
      const queue = createChannel<A>(capacity)
      const unsubscribe = () => {
        signal.removeEventListener("abort", unsubscribe)
        subscribers.delete(subscriber)
        queue.close()
      }
      const subscriber = { send: queue.send, close: unsubscribe }
      signal.addEventListener("abort", unsubscribe, { once: true })
      if (signal.aborted) unsubscribe()
      if (!signal.aborted) subscribers.add(subscriber)
      return (async function* () {
        try {
          yield* queue.read(signal)
        } finally {
          unsubscribe()
        }
      })()
    },
  }
}

export function createSingleConsumerJournal<A>(input: {
  readonly capacity: number
  readonly reconnect: () => void
  readonly owner: AbortSignal
}) {
  const retained: A[] = []
  const pending: A[] = []
  let waiting: ((result: IteratorResult<A>) => void) | undefined
  let consumer: AbortSignal | undefined
  let pendingBoundary = false
  let valid = false
  let closed = false
  let reconnectRequested = false

  const invalidate = (reconnect = false) => {
    if (closed) return
    const shouldReconnect = reconnect && valid && !reconnectRequested
    valid = false
    reconnectRequested = reconnectRequested || shouldReconnect
    retained.splice(0)
    pending.splice(0)
    pendingBoundary = false
    if (shouldReconnect) input.reconnect()
  }
  const release = (signal: AbortSignal, reconnect = true) => {
    if (consumer !== signal) return
    signal.removeEventListener("abort", abort)
    consumer = undefined
    waiting?.({ done: true, value: undefined })
    waiting = undefined
    invalidate(reconnect)
  }
  function abort(this: AbortSignal) {
    release(this)
  }
  const close = () => {
    if (closed) return
    closed = true
    valid = false
    retained.splice(0)
    pending.splice(0)
    pendingBoundary = false
    if (consumer !== undefined) {
      consumer.removeEventListener("abort", abort)
      consumer = undefined
    }
    waiting?.({ done: true, value: undefined })
    waiting = undefined
  }
  input.owner.addEventListener("abort", close, { once: true })
  if (input.owner.aborted) close()

  return {
    begin(boundary: A) {
      if (closed) return
      valid = true
      reconnectRequested = false
      retained.splice(0)
      pending.splice(0)
      pendingBoundary = false
      if (consumer === undefined) retained.push(boundary)
      else if (waiting !== undefined) {
        const resolve = waiting
        waiting = undefined
        resolve({ done: false, value: boundary })
      } else {
        pending.push(boundary)
        pendingBoundary = true
      }
    },
    send(item: A) {
      if (closed || !valid) return
      if (consumer === undefined) {
        if (retained.length > input.capacity) {
          invalidate(true)
          return
        }
        retained.push(item)
        return
      }
      if (waiting !== undefined) {
        const resolve = waiting
        waiting = undefined
        resolve({ done: false, value: item })
        return
      }
      if (pending.length - (pendingBoundary ? 1 : 0) >= input.capacity) {
        invalidate(true)
        return
      }
      pending.push(item)
    },
    read(signal: AbortSignal): AsyncIterable<A> {
      if (consumer !== undefined) throw new Error("Session synchronization consumer already active")
      if (closed || signal.aborted) return (async function* () {})()
      consumer = signal
      pendingBoundary = retained.length > 0
      pending.push(...retained.splice(0))
      signal.addEventListener("abort", abort, { once: true })
      const iterator: AsyncIterator<A> & AsyncIterable<A> = {
        next() {
          if (signal.aborted || closed) {
            release(signal)
            return Promise.resolve({ done: true, value: undefined })
          }
          if (pending.length > 0) {
            const value = pending.shift()!
            pendingBoundary = false
            return Promise.resolve({ done: false, value })
          }
          return new Promise<IteratorResult<A>>((resolve) => (waiting = resolve))
        },
        return() {
          release(signal)
          return Promise.resolve({ done: true, value: undefined })
        },
        [Symbol.asyncIterator]() {
          return iterator
        },
      }
      return iterator
    },
    invalidate: () => invalidate(false),
    close,
  }
}
