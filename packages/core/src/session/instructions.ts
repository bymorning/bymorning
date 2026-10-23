/** Exposes nested Project instruction discovery and injection. */
export * as SessionInstructions from "./instructions.js"

import { ID } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { SessionInbox } from "@bymorning/schema/session-inbox"
import type { Workspace } from "@bymorning/schema/workspace"
import { Context, Crypto, DateTime, Effect, Layer, Option, Ref, Schema, Stream } from "effect"
import { Bus } from "../bus.js"
import { Database, SessionInboxTable, SessionTable } from "../database.js"
import { and, eq } from "drizzle-orm"
import { ProjectDirectory } from "../project-directory.js"
import { SessionMessage } from "./message.js"
import { allocate } from "./position.js"

const InjectedMetadata = Schema.Struct({
  instruction: Schema.Struct({ paths: Schema.Array(Schema.String) }),
})

export interface Interface {
  readonly load: (input: {
    readonly sessionID: Session.ID
    readonly paths: ReadonlyArray<ProjectDirectory.Path>
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/core/SessionInstructions") {}

/** Capture persistence once and share claims across the builtin discovery callers. */
export const make = (workspaceID: Workspace.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const crypto = yield* Crypto.Crypto
    const inFlight = yield* Ref.make<Map<Session.ID, Set<ProjectDirectory.Path>>>(new Map())

    return (directory: ProjectDirectory.Interface): Interface => {
      const load = Effect.fn("SessionInstructions.load")(function* (input: Parameters<Interface["load"]>[0]) {
        const claimed = yield* Ref.modify(inFlight, (map) => {
          const existing = map.get(input.sessionID) ?? new Set<ProjectDirectory.Path>()
          const paths = input.paths.filter((path) => !existing.has(path))
          if (paths.length === 0) return [paths, map]
          const next = new Map(map)
          next.set(input.sessionID, new Set([...existing, ...paths]))
          return [paths, next]
        })
        if (claimed.length === 0) return

        yield* Effect.gen(function* () {
          const pending = yield* database
            .use("sessionInstructionPending", (db) =>
              db
                .select({ payload: SessionInboxTable.payload })
                .from(SessionInboxTable)
                .innerJoin(SessionTable, eq(SessionTable.id, SessionInboxTable.sessionID))
                .where(
                  and(
                    eq(SessionTable.workspaceID, workspaceID),
                    eq(SessionInboxTable.sessionID, input.sessionID),
                    eq(SessionInboxTable.type, "synthetic"),
                  ),
                ),
            )
            .pipe(Effect.orDie)
          const alreadyInjected = new Set([
            ...(yield* SessionMessage.context(database, workspaceID, input.sessionID))
              .filter((message) => message.type === "synthetic")
              .flatMap(
                (message) =>
                  Option.getOrUndefined(Schema.decodeUnknownOption(InjectedMetadata)(message.metadata))?.instruction
                    .paths ?? [],
              ),
            ...pending.flatMap(
              ({ payload }) =>
                Option.getOrUndefined(
                  Schema.decodeUnknownOption(Schema.Struct({ metadata: InjectedMetadata }))(payload),
                )?.metadata.instruction.paths ?? [],
            ),
          ])
          const files = yield* Effect.forEach(
            claimed.filter((path) => !alreadyInjected.has(path)),
            (path) =>
              directory.read(path).pipe(
                Effect.flatMap((file) => Stream.mkUint8Array(file.content)),
                Effect.flatMap((body) => Effect.try(() => new TextDecoder("utf-8", { fatal: true }).decode(body))),
                Effect.map((content) => ({ path, content })),
                Effect.option,
              ),
            { concurrency: "unbounded" },
          )
          const readable = files.flatMap(Option.toArray)
          if (readable.length === 0) return
          const paths = readable.map((file) => file.path)
          const id = yield* crypto.randomUUIDv4.pipe(Effect.flatMap(Schema.decodeUnknownEffect(ID)), Effect.orDie)
          const created = yield* DateTime.nowAsDate
          const item = SessionInbox.Info.make({
            id,
            sessionID: input.sessionID,
            admittedSequence: yield* database
              .transactRoot(
                database.use("sessionInstructionAdmit", (tx) =>
                  Effect.gen(function* () {
                    const admittedSequence = yield* allocate(database, input.sessionID, 1)
                    yield* tx.insert(SessionInboxTable).values({
                      id,
                      sessionID: input.sessionID,
                      admittedSequence,
                      type: "synthetic",
                      payload: {
                        text: readable.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n"),
                        description: `Loaded ${paths.join(", ")}`,
                        metadata: { instruction: { paths } },
                      },
                      delivery: "steer",
                      timeCreated: created,
                    })
                    return admittedSequence
                  }),
                ),
              )
              .pipe(Effect.orDie),
            type: "synthetic",
            payload: {
              text: readable.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n"),
              description: `Loaded ${paths.join(", ")}`,
              metadata: { instruction: { paths } },
            },
            delivery: "steer",
            createdAt: created,
          })
          yield* bus.publish(SessionEvent.SyntheticAdmitted, { sessionID: input.sessionID, item }).pipe(Effect.orDie)
        }).pipe(
          Effect.ensuring(
            Ref.update(inFlight, (map) => {
              const existing = map.get(input.sessionID)
              if (existing === undefined) return map
              const remaining = new Set([...existing].filter((path) => !claimed.includes(path)))
              const next = new Map(map)
              if (remaining.size === 0) next.delete(input.sessionID)
              else next.set(input.sessionID, remaining)
              return next
            }),
          ),
        )
      })

      return Service.of({ load })
    }
  })

export const layer = (workspaceID: Workspace.ID, directory: ProjectDirectory.Interface) =>
  Layer.effect(Service, make(workspaceID).pipe(Effect.map((create) => create(directory))))

/** Find nested AGENTS.md paths from nearest to farthest, excluding the Project root. */
export const candidates = (path: ProjectDirectory.Path): ProjectDirectory.Path[] => {
  const segments = path.split("/").slice(0, -1)
  return segments
    .map((_, index) => `${segments.slice(0, segments.length - index).join("/")}/AGENTS.md`)
    .map((path) => ProjectDirectory.Path.make(path))
}
