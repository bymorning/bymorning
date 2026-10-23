type Pending = { promise: Promise<void>; invalidated: boolean }

export function createDataSync() {
  const state = new Map<string, true | Pending>()
  const start = (key: string, load: () => Promise<void>, wait?: Promise<void>) => {
    const entry: Pending = { promise: Promise.resolve(), invalidated: false }
    state.set(key, entry)
    entry.promise = (wait ? wait.catch(() => undefined).then(load) : load())
      .then(() => {
        if (state.get(key) !== entry) return
        if (entry.invalidated) {
          state.delete(key)
          return
        }
        state.set(key, true)
      })
      .finally(() => {
        if (state.get(key) === entry) state.delete(key)
      })
    return entry.promise
  }
  return {
    run(key: string, load: () => Promise<void>) {
      const active = state.get(key)
      if (active === true) return Promise.resolve()
      if (!active) return start(key, load)
      if (!active.invalidated) return active.promise
      return start(key, load, active.promise)
    },
    invalidate(key?: string) {
      if (key) {
        const active = state.get(key)
        if (active === true) state.delete(key)
        if (active !== undefined && active !== true) active.invalidated = true
        return
      }
      state.forEach((active, current) => {
        if (active === true) state.delete(current)
        if (active !== true) active.invalidated = true
      })
    },
  }
}

export type DataSync = ReturnType<typeof createDataSync>
