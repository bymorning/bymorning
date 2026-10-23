import type { ReferenceApi } from "@bymorning/client/promise/api"
import type { Reference } from "@bymorning/schema/reference"
import type { Transform } from "./registration.js"

export interface ReferenceEditor {
  add(name: string, source: Reference.LocalSource | Reference.GitSource): void
  remove(name: string): void
  list(): readonly (readonly [string, Reference.LocalSource | Reference.GitSource])[]
  get(name: string): Reference.LocalSource | Reference.GitSource | undefined
}

export interface ReferenceDomain extends ReferenceApi {
  readonly transform: Transform<ReferenceEditor>
  readonly reload: () => Promise<void>
}
