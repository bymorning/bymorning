/** Exposes the Project-relative file namespace owned by this module. */
export * as ProjectDirectory from "./project-directory.js"

import { Project } from "@bymorning/schema/project"
import { ProjectDirectorySchema } from "@bymorning/schema/project-directory"
import { Workspace } from "@bymorning/schema/workspace"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { Bus } from "./bus.js"
import { ProjectStorage } from "./project-storage.js"
import { Storage } from "./storage.js"

/** A validated Project-relative file path. */
export const Path = ProjectDirectorySchema.Path
/** A validated Project-relative file path. */
export type Path = ProjectDirectorySchema.Path

/** A path does not identify a file inside a Project Directory. */
export class InvalidPathError extends Schema.TaggedError<InvalidPathError>()("ProjectDirectory.InvalidPathError", {
  path: Schema.String,
}) {}

/** The requested Project File does not exist. */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("ProjectDirectory.NotFoundError", {
  path: Path,
}) {}

/** Another Project File already occupies the requested path. */
export class ConflictError extends Schema.TaggedError<ConflictError>()("ProjectDirectory.ConflictError", {
  path: Path,
}) {}

/** A Project File storage operation failed. */
export class OperationError extends Schema.TaggedError<OperationError>()("ProjectDirectory.OperationError", {
  operation: Schema.Literals(["list", "read", "write", "delete", "move"]),
  cause: Schema.Defect(),
}) {}

/** One streamed Project File and its stored representation metadata. */
export interface ProjectFile {
  readonly contentType?: string
  readonly contentLength?: number
  readonly content: Stream.Stream<Uint8Array, OperationError>
}

/** Input for replacing one streamed Project File. */
export interface ProjectFileWrite {
  readonly contentType?: string
  readonly contentLength?: number
  readonly content: Stream.Stream<Uint8Array, unknown>
}

/** Project-relative streamed file operations. */
export interface Interface {
  /** Project identity included in every Project File identity. */
  readonly projectID: Project.ID
  /** Recursively list Project Files in stable path order. */
  readonly list: Effect.Effect<ReadonlyArray<Path>, OperationError>
  /** Read one Project File as a byte stream. */
  readonly read: (path: Path) => Effect.Effect<ProjectFile, NotFoundError | OperationError>
  /** Write one Project File as a byte stream, replacing an existing file. */
  readonly write: (path: Path, file: ProjectFileWrite) => Effect.Effect<void, OperationError>
  /** Delete one existing Project File. */
  readonly delete: (path: Path) => Effect.Effect<void, NotFoundError | OperationError>
  /**
   * Move one existing Project File to a path no other Project File occupies,
   * keeping its bytes and content type. Moving a file onto its own path
   * succeeds without change. The move copies before removing the source, so a
   * failure part-way can leave the file at both paths but never at neither.
   */
  readonly move: (from: Path, to: Path) => Effect.Effect<void, NotFoundError | ConflictError | OperationError>
}

/** Project-relative streamed file authority for one Project. */
export class Service extends Context.Service<Service, Interface>()("@bymorning/core/ProjectDirectory") {}

/** Parse and validate a Project-relative file path. */
export const parse = Effect.fn("ProjectDirectory.parse")((path: string) =>
  Schema.decodeUnknownEffect(Path)(path).pipe(Effect.mapError(() => new InvalidPathError({ path }))),
)

/** Build the exact-match Permission resource for one Project File. */
export const resource = (projectID: Project.ID, path: Path) =>
  `project:${projectID}:${encodeURIComponent(path).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`

/** Build a Project Directory over the storage namespace for one Project. */
export const layer = (
  workspaceID: Workspace.ID,
  projectID: Project.ID,
): Layer.Layer<Service, never, Storage.Service | Bus.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const storage = yield* ProjectStorage.Service
      const bus = yield* Bus.Service

      const list = storage.list.pipe(
        Effect.mapError((cause) => new OperationError({ operation: "list", cause })),
        Effect.flatMap((items) =>
          Effect.forEach(
            items.filter((item) => !item.marker),
            (item) =>
              parse(item.key).pipe(Effect.mapError((cause) => new OperationError({ operation: "list", cause }))),
          ),
        ),
        Effect.map((paths) => paths.toSorted()),
      )

      const read = Effect.fn("ProjectDirectory.read")(function* (path: Path) {
        const entry = yield* storage
          .get(path.split("/"))
          .pipe(Effect.mapError((cause) => new OperationError({ operation: "read", cause })))
        if (Option.isNone(entry)) return yield* new NotFoundError({ path })
        return {
          contentType: entry.value.metadata.contentType,
          contentLength: entry.value.metadata.contentLength,
          content: entry.value.body.pipe(Stream.mapError((cause) => new OperationError({ operation: "read", cause }))),
        }
      })

      const write = Effect.fn("ProjectDirectory.write")(function* (path: Path, file: ProjectFileWrite) {
        const { content, ...metadata } = file
        yield* storage
          .set(path.split("/"), { body: content, ...metadata })
          .pipe(Effect.mapError((cause) => new OperationError({ operation: "write", cause })))
        yield* bus.publish(Project.FileChanged, { projectID, path }).pipe(Effect.orDie)
      })

      const remove = Effect.fn("ProjectDirectory.delete")(function* (path: Path) {
        const failure = (cause: unknown) => new OperationError({ operation: "delete", cause })
        const entry = yield* storage.get(path.split("/")).pipe(Effect.mapError(failure))
        if (Option.isNone(entry)) return yield* new NotFoundError({ path })
        yield* storage.remove(path.split("/")).pipe(Effect.mapError(failure))
        yield* bus.publish(Project.FileChanged, { projectID, path }).pipe(Effect.orDie)
      })

      const move = Effect.fn("ProjectDirectory.move")(function* (from: Path, to: Path) {
        const failure = (cause: unknown) => new OperationError({ operation: "move", cause })
        const source = yield* storage.get(from.split("/")).pipe(Effect.mapError(failure))
        if (Option.isNone(source)) return yield* new NotFoundError({ path: from })
        if (from === to) return
        const target = yield* storage.get(to.split("/")).pipe(Effect.mapError(failure))
        if (Option.isSome(target)) return yield* new ConflictError({ path: to })
        const { metadata, body } = source.value
        yield* storage
          .set(to.split("/"), {
            body,
            ...(metadata.contentType === undefined ? {} : { contentType: metadata.contentType }),
            ...(metadata.contentLength === undefined ? {} : { contentLength: metadata.contentLength }),
          })
          .pipe(Effect.mapError(failure))
        yield* bus.publish(Project.FileChanged, { projectID, path: to }).pipe(Effect.orDie)
        yield* storage.remove(from.split("/")).pipe(Effect.mapError(failure))
        yield* bus.publish(Project.FileChanged, { projectID, path: from }).pipe(Effect.orDie)
      })

      return Service.of({ projectID, list, read, write, delete: remove, move })
    }),
  ).pipe(Layer.provide(ProjectStorage.layer(workspaceID, projectID)))
