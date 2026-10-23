import type { Storage } from "@bymorning/schema/storage"

/** Compatibility alias for one namespace-relative JSON value. */
export type StorageEntry = Storage.KVEntry

/** Compatibility alias for prefix and exclusive-cursor scan inputs. */
export type StorageScanOptions = Storage.ScanInput

/** Compatibility alias for a page of namespace-relative JSON values. */
export type StorageScanResult = Storage.ScanResult
