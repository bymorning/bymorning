/** Declares the Project contract owned by this module. */
export * as Project from "./project.js"
export * as ProjectSchema from "./project.js"

import { Schema } from "effect"
import { define, inventory } from "./event.js"
import * as ProjectDirectorySchema from "./project-directory.js"
import { ProjectID } from "./project-id.js"
import { AbsolutePath, NonNegativeInt, optional, Timestamp } from "./schema.js"

const Name = Schema.String.check(Schema.isMaxLength(255))

/** Canonical identity of a Workspace-owned Project. */
export const ID = ProjectID

/** Canonical identity of a Workspace-owned Project. */
export type ID = typeof ID.Type

/** Filesystem context associated with a current Project selection. */
export const Current = Schema.Struct({ id: ID, directory: AbsolutePath, canonical: AbsolutePath })

/** Filesystem context associated with a current Project selection. */
export interface Current extends Schema.Schema.Type<typeof Current> {}

/** Optional Project display icon metadata. */
export const Icon = Schema.Struct({
  url: optional(Schema.URLFromString),
  override: optional(Schema.URLFromString),
  color: optional(Schema.String),
})

/** Optional Project display icon metadata. */
export interface Icon extends Schema.Schema.Type<typeof Icon> {}

/** Public Project identity and optional display metadata. */
export const Info = Schema.Struct({
  id: ID,
  name: optional(Name),
  icon: optional(Icon),
  /** When the Project was archived; absent while it is active. */
  archivedAt: Schema.optionalKey(Timestamp),
  time_created: NonNegativeInt,
  time_updated: NonNegativeInt,
})

/** Public Project identity and optional display metadata. */
export interface Info extends Schema.Schema.Type<typeof Info> {}

/** Input for creating a Project. */
export const CreateInput = Schema.Struct({ name: optional(Name), icon: optional(Icon) })

/** Input for creating a Project. */
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

/** Input for patching Project display metadata or archiving and restoring it. */
export const UpdateInput = Schema.Struct({
  projectID: ID,
  name: Schema.optionalKey(Schema.NullOr(Name)),
  icon: Schema.optionalKey(Schema.NullOr(Icon)),
  archived: Schema.optionalKey(Schema.Boolean),
})

/** Input for patching Project display metadata or archiving and restoring it. */
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

/** Options for listing Projects: active Projects by default, archived Projects only with `archived: true`. */
export const ListInput = Schema.Struct({ archived: Schema.optionalKey(Schema.Boolean) })

/** Options for listing Projects: active Projects by default, archived Projects only with `archived: true`. */
export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}

/** Project metadata was created or updated. */
export const Updated = define("project.updated", { project: Info })

/** Internal invalidation emitted after a Project is successfully deleted. */
export const Deleted = define("project.deleted", { projectID: ID })

/** A Project File was successfully written. */
export const FileChanged = define("project.file.changed", {
  projectID: ID,
  path: ProjectDirectorySchema.Path,
})

/** Current Project Event definition inventory. */
export const Definitions = inventory(Updated, Deleted, FileChanged)
