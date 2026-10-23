import { Bus } from "@bymorning/core/bus"
import { Audit } from "@bymorning/core/audit"
import { ProjectDirectory } from "@bymorning/core/project-directory"
import { Project } from "@bymorning/core/project"
import {
  InputError,
  InternalError,
  ProjectDefaultError,
  ProjectFileConflictError,
  ProjectFileNotFoundError,
  ProjectNotFoundError,
} from "@bymorning/protocol/errors"
import { CurrentActor } from "@bymorning/protocol/middleware/workspace-middleware"
import { NodeHttpServerRequest, NodeStream } from "@effect/platform-node"
import { Effect, Stream } from "effect"
import { HttpServerError, HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api.js"

const readBody = Effect.fn("ProjectHandler.readBody")(function* (request: HttpServerRequest.HttpServerRequest) {
  const limit = yield* HttpServerRequest.MaxBodySize
  const onError = (cause: unknown) =>
    new HttpServerError.HttpServerError({ reason: new HttpServerError.RequestParseError({ request, cause }) })
  let bytes = 0
  return yield* NodeStream.fromReadable<Uint8Array, HttpServerError.HttpServerError>({
    evaluate: () => NodeHttpServerRequest.toIncomingMessage(request),
    onError,
    // A body-limit failure must leave the socket open long enough to send its HTTP 400 response.
    closeOnDone: false,
  }).pipe(
    Stream.mapEffect((chunk) => {
      bytes += chunk.byteLength
      return limit !== undefined && bytes > Number(limit)
        ? Effect.fail(onError(new Error("maxBytes exceeded")))
        : Effect.succeed(chunk)
    }),
    Stream.mkUint8Array,
    Effect.orDie,
  )
})

/** Project endpoint implementations. */
export const ProjectHandler = HttpApiBuilder.group(Api, "api.project", (handlers) => {
  const notFound = (error: Project.NotFoundError) =>
    new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` })
  const invalidPath = () => new InputError({ error: "Invalid Project file path" })
  const fileNotFound = (error: ProjectDirectory.NotFoundError) =>
    new ProjectFileNotFoundError({ path: error.path, message: `Project file not found: ${error.path}` })
  const fileConflict = (error: ProjectDirectory.ConflictError) =>
    new ProjectFileConflictError({ path: error.path, message: `A Project file already exists at ${error.path}` })
  const internal = () => new InternalError({ error: "Project file operation failed" })
  // Object Storage shares no transaction with the record store, so an Entry
  // commits after its file operation; a record failure still fails the call.
  // Records hold object keys, never content.
  const audit = (input: {
    readonly action: "file.delete" | "file.move"
    readonly target: string
    readonly detail: Record<string, unknown>
  }) =>
    Effect.gen(function* () {
      const actor = yield* CurrentActor
      yield* Audit.record({
        actor: Audit.principal(actor),
        action: input.action,
        workspaceID: actor.properties.workspaceID,
        target: input.target,
        detail: input.detail,
        outcome: "success",
      }).pipe(Effect.catchTag("Audit.StoreError", () => Effect.fail(internal())))
    })
  const withDirectory = <A, E>(
    projectID: Parameters<Project.Interface["get"]>[0],
    operation: Effect.Effect<A, E, ProjectDirectory.Service>,
  ) =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      yield* project.get(projectID).pipe(Effect.catchTag("Project.NotFoundError", notFound))
      const actor = yield* CurrentActor
      const bus = yield* Bus.Service
      return yield* operation.pipe(
        Effect.provide(ProjectDirectory.layer(actor.properties.workspaceID, projectID)),
        Effect.provideService(Bus.Service, bus),
      )
    })
  return handlers
    .handle("project.create", ({ payload }) => Project.Service.use((project) => project.create(payload)))
    .handle("project.list", ({ query }) =>
      Project.Service.use((project) => project.list(query.archived === undefined ? {} : { archived: query.archived })),
    )
    .handle("project.get", ({ params }) =>
      Project.Service.use((project) =>
        project.get(params.projectID).pipe(Effect.catchTag("Project.NotFoundError", notFound)),
      ),
    )
    .handle("project.update", ({ params, payload }) =>
      Project.Service.use((project) =>
        project
          .update({ projectID: params.projectID, ...payload })
          .pipe(
            Effect.catchTags({
              "Project.NotFoundError": notFound,
              "Project.DefaultError": (error) =>
                new ProjectDefaultError({
                  projectID: error.projectID,
                  message: "The Default project can't be archived.",
                }),
            }),
          ),
      ),
    )
    .handle("project.delete", ({ params }) =>
      Project.Service.use((project) =>
        project
          .delete(params.projectID)
          .pipe(Effect.catchTag("Project.NotFoundError", notFound), Effect.as(HttpApiSchema.NoContent.make())),
      ),
    )
    .handle("project.directory.list", ({ params }) =>
      withDirectory(
        params.projectID,
        ProjectDirectory.Service.use((directory) => directory.list),
      ).pipe(
        Effect.catchTag("ProjectDirectory.OperationError", internal),
        Effect.map((paths) => ({ paths })),
      ),
    )
    .handle("project.directory.read", ({ params, query }) =>
      withDirectory(
        params.projectID,
        ProjectDirectory.Service.use((directory) =>
          ProjectDirectory.parse(query.path).pipe(
            Effect.flatMap((path) => directory.read(path)),
            Effect.flatMap((file) => Stream.mkUint8Array(file.content)),
          ),
        ),
      ).pipe(
        Effect.catchTags({
          "ProjectDirectory.InvalidPathError": invalidPath,
          "ProjectDirectory.NotFoundError": fileNotFound,
          "ProjectDirectory.OperationError": internal,
        }),
      ),
    )
    .handleRaw("project.directory.write", ({ params, query, headers, request }) =>
      Effect.gen(function* () {
        const body = yield* readBody(request)
        yield* withDirectory(
          params.projectID,
          Effect.gen(function* () {
            const directory = yield* ProjectDirectory.Service
            const path = yield* ProjectDirectory.parse(query.path)
            yield* directory.write(path, {
              content: Stream.succeed(body),
              contentType: headers.contentType ?? "application/octet-stream",
              contentLength: body.length,
            })
          }),
        ).pipe(
          Effect.catchTags({
            "ProjectDirectory.InvalidPathError": invalidPath,
            "ProjectDirectory.OperationError": internal,
          }),
        )
        // Object Storage shares no transaction with the record store, so the
        // Entry commits after the write; a record failure still fails the
        // call. The record holds the object key and size, never content.
        const actor = yield* CurrentActor
        yield* Audit.record({
          actor: Audit.principal(actor),
          action: "file.upload",
          workspaceID: actor.properties.workspaceID,
          target: `${params.projectID}:${query.path}`,
          detail: {
            path: query.path,
            size: body.length,
            contentType: headers.contentType ?? "application/octet-stream",
          },
          outcome: "success",
        }).pipe(Effect.catchTag("Audit.StoreError", () => Effect.fail(internal())))
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle("project.directory.delete", ({ params, query }) =>
      Effect.gen(function* () {
        yield* withDirectory(
          params.projectID,
          Effect.gen(function* () {
            const directory = yield* ProjectDirectory.Service
            yield* directory.delete(yield* ProjectDirectory.parse(query.path))
          }),
        ).pipe(
          Effect.catchTags({
            "ProjectDirectory.InvalidPathError": invalidPath,
            "ProjectDirectory.NotFoundError": fileNotFound,
            "ProjectDirectory.OperationError": internal,
          }),
        )
        yield* audit({
          action: "file.delete",
          target: `${params.projectID}:${query.path}`,
          detail: { path: query.path },
        })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle("project.directory.move", ({ params, payload }) =>
      Effect.gen(function* () {
        yield* withDirectory(
          params.projectID,
          Effect.gen(function* () {
            const directory = yield* ProjectDirectory.Service
            const from = yield* ProjectDirectory.parse(payload.from)
            const to = yield* ProjectDirectory.parse(payload.to)
            yield* directory.move(from, to)
          }),
        ).pipe(
          Effect.catchTags({
            "ProjectDirectory.InvalidPathError": invalidPath,
            "ProjectDirectory.NotFoundError": fileNotFound,
            "ProjectDirectory.ConflictError": fileConflict,
            "ProjectDirectory.OperationError": internal,
          }),
        )
        // Moving a file onto its own path changes nothing, so nothing is recorded.
        if (payload.from === payload.to) return HttpApiSchema.NoContent.make()
        yield* audit({
          action: "file.move",
          target: `${params.projectID}:${payload.from}`,
          detail: { from: payload.from, to: payload.to },
        })
        return HttpApiSchema.NoContent.make()
      }),
    )
})
