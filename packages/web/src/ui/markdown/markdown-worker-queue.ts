export function createLatestWorkerQueue<T extends { key: string }>(input: {
  readonly run: (request: T) => Promise<void>
  readonly supersede: (request: T) => void
  readonly dispose: (key: string) => void
}) {
  type Slot = { type: "request"; key: string; request: T | undefined }
  const jobs: Array<Slot | { type: "dispose"; key: string }> = []
  const slots = new Map<string, Slot>()
  let running: Promise<void> | undefined
  let cursor = 0
  const schedule = () => {
    if (running) return
    running = Promise.resolve()
      .then(async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++]!
          if (job.type === "dispose") {
            input.dispose(job.key)
            continue
          }
          if (slots.get(job.key) === job) slots.delete(job.key)
          const request = job.request
          job.request = undefined
          if (request) await input.run(request)
        }
      })
      .finally(() => {
        jobs.splice(0, cursor)
        cursor = 0
        running = undefined
        if (jobs.length > 0) schedule()
      })
  }
  return {
    enqueue(request: T) {
      const slot = slots.get(request.key)
      if (slot) {
        if (slot.request) input.supersede(slot.request)
        slot.request = request
        return
      }
      const next: Slot = { type: "request", key: request.key, request }
      slots.set(request.key, next)
      jobs.push(next)
      schedule()
    },
    dispose(key: string) {
      const slot = slots.get(key)
      if (slot?.request) input.supersede(slot.request)
      slots.delete(key)
      jobs.push({ type: "dispose", key })
      schedule()
    },
  }
}
