import {
  makePersisted,
  type AsyncStorage,
  type PersistenceOptions,
  type SyncStorage,
} from "@solid-primitives/storage"
import type * as Workspace from "@bymorning/schema/workspace"
import type { Signal } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"

export type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"

export type PersistedStorage = AsyncStorage | SyncStorage

export interface PersistTarget {
  readonly key: string
}

const emptyStorage: SyncStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

const browserStorage = (): SyncStorage => {
  try {
    return globalThis.localStorage ?? emptyStorage
  } catch {
    return emptyStorage
  }
}

const catchPromise = <A>(value: A | Promise<A>, fallback: A): A | Promise<A> =>
  value instanceof Promise ? value.catch(() => fallback) : value

export const safePersistedStorage = (storage: PersistedStorage = browserStorage()): PersistedStorage =>
  // The primitive models synchronous and asynchronous storage as a union; this wrapper preserves both APIs.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  ({
    getItem: (key) => {
      try {
        return catchPromise(storage.getItem(key), null)
      } catch {
        return null
      }
    },
    setItem: (key, value) => {
      try {
        return catchPromise(storage.setItem(key, value), undefined)
      } catch {
        return undefined
      }
    },
    removeItem: (key) => {
      try {
        return Promise.resolve(storage.removeItem(key)).catch(() => undefined)
      } catch {
        return undefined
      }
    },
  }) as PersistedStorage

export const safeSyncStorage = (storage: SyncStorage = browserStorage()): SyncStorage => ({
  getItem: (key) => {
    try {
      return storage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      storage.setItem(key, value)
    } catch {
      return
    }
  },
  removeItem: (key) => {
    try {
      storage.removeItem(key)
    } catch {
      return
    }
  },
})

export const Persist = {
  global: (key: string): PersistTarget => ({ key: `bymorning.${key}` }),
  workspace: (workspaceID: Workspace.ID, key: string): PersistTarget => ({
    key: `bymorning.workspace:${workspaceID}:${key}`,
  }),
  project: (workspaceID: Workspace.ID, projectID: string, key: string): PersistTarget => ({
    key: `bymorning.workspace:${workspaceID}:project:${projectID}:${key}`,
  }),
  session: (workspaceID: Workspace.ID, projectID: string, sessionID: string, key: string): PersistTarget => ({
    key: `bymorning.workspace:${workspaceID}:project:${projectID}:session:${sessionID}:${key}`,
  }),
  draft: (draftID: string, key: string): PersistTarget => ({ key: `bymorning.draft:${draftID}:${key}` }),
}

type PersistOptions<T> = Omit<PersistenceOptions<T, undefined>, "name" | "storage"> & {
  readonly storage?: PersistedStorage | undefined
}

export function persisted<T, S extends Signal<T> | [Store<T>, SetStoreFunction<T>]>(
  target: PersistTarget,
  state: S,
  options: PersistOptions<T> = {},
) {
  const { storage, ...config } = options
  return makePersisted<T, S>(state, {
    ...config,
    name: target.key,
    storage: safePersistedStorage(storage),
  })
}

export function removePersisted(target: PersistTarget, storage?: PersistedStorage) {
  void safePersistedStorage(storage).removeItem(target.key)
}
