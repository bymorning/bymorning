/** Keyed, serial cache synchronization. Invalidation never starts a read. */
export const createSync = () => {
  type Pending = { promise: Promise<void>; invalidated: boolean; started: boolean }
  const state = new Map<string, true | Pending>()
  const start = (key: string, load: () => Promise<void>, wait?: Promise<void>) => {
    const entry: Pending = { promise: Promise.resolve(), invalidated: false, started: false }
    state.set(key, entry)
    const begin = () => {
      entry.started = true
      entry.invalidated = false
      return load()
    }
    const promise = (wait ? wait.catch(() => undefined).then(begin) : begin())
      .then(() => {
        if (state.get(key) === entry && !entry.invalidated) state.set(key, true)
      })
      .finally(() => {
        if (state.get(key) === entry) state.delete(key)
      })
    entry.promise = promise
    return promise
  }
  return {
    forget(key: string) {
      state.delete(key)
    },
    run(key: string, load: () => Promise<void>) {
      const active = state.get(key)
      if (active === true) return Promise.resolve()
      if (!active) return start(key, load)
      return active.invalidated && active.started ? start(key, load, active.promise) : active.promise
    },
    invalidate(key?: string) {
      if (key) {
        const active = state.get(key)
        if (active === true) state.delete(key)
        else if (active) active.invalidated = true
        return
      }
      for (const [current, active] of state) {
        if (active === true) state.delete(current)
        else active.invalidated = true
      }
    },
  }
}
