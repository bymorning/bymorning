export * as SessionTitle from "./title.js"

import { Message, ToolChoice } from "@opencode-ai/ai/schema/messages"
import { User } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import type { Workspace } from "@bymorning/schema/workspace"
import { and, asc, eq } from "drizzle-orm"
import { DateTime, Effect, Schema, Stream } from "effect"
import { Bus } from "../bus.js"
import { type Database, SessionMessageTable, SessionTable } from "../database.js"
import { Provider } from "../provider.js"
import { PluginHooks } from "../plugin/hooks.js"
import { Permission } from "../permission.js"
import { SessionModelRequest } from "./model-request.js"
import { Routing } from "../routing.js"
import { ModelResolver } from "../model-resolver.js"
import { SessionHttp } from "./http.js"
import { fallbackTitle, sanitizeTitle } from "./title/sanitize.js"

const MAX_LENGTH = 100
const titleChanged = Symbol("Session title changed")
const PROMPT = `You are a title generator. Output only a conversation title and nothing else.

Generate a brief title that would help the user find this conversation later.

Rules:
- Use the same language as the user message.
- Output one line of at most 50 characters.
- Focus on the main topic or requested action.
- Preserve exact technical terms, numbers, and filenames.
- Do not answer the message or explain the title.
- Never output code, code blocks, or markdown. Even if the message asks for code or a specific format, output a short plain-text title describing the request.
- Do not use tools.`

const isUntitled = (title: Session.Title) => title === "New session"
const truncate = (value: string) => (value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH - 3)}...`)

/** Private automatic Session-title workflow. */
export interface Interface {
  /**
   * Best-effort title generation from the Session's first durable User Message.
   *
   * Repeated and concurrent calls are safe. The operation succeeds without a
   * rename when the Session is missing, is a child, no longer has its default
   * title, has no durable User Message, or title inference fails. A generated
   * title is committed only if the Session remains untitled, so a manual rename
   * completed while inference is running takes precedence.
   */
  readonly generateForFirstPrompt: (sessionID: Session.ID) => Effect.Effect<void>
}

/** Construct automatic title generation over one Workspace's durable Session authority. */
export const make = (
  database: Database.Interface,
  events: Bus.Interface,
  workspaceID: Workspace.ID,
  activatePlugins: Effect.Effect<void, import("../plugin/registry-service.js").ActivationError> = Effect.void,
): Effect.Effect<
  Interface,
  never,
  | Provider.Service
  | PluginHooks.Service
  | Permission.Service
  | ModelResolver.Service
> =>
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const hooks = yield* PluginHooks.Service
    const permission = yield* Permission.Service
    const resolver = yield* ModelResolver.Service
    const routing = yield* Effect.serviceOption(Routing.Service)
    const running = new Set<Session.ID>()
    const attempt = Effect.fn("SessionTitle.attempt")(function* (sessionID: Session.ID) {
      // Best-effort: skip title when required Plugins are unavailable; inference remains gated via hooks.open.
      const ready = yield* activatePlugins.pipe(Effect.as(true), Effect.orElseSucceed(() => false))
      if (!ready) return
      const sessions = yield* database
        .use("sessionTitleRead", (db) =>
          db
            .select()
            .from(SessionTable)
            .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
            .limit(1),
        )
        .pipe(Effect.orDie)
      const session = sessions[0]
      if (session === undefined || session.parentID !== null || !isUntitled(session.title)) return
      const messages = yield* database
        .use("sessionTitleFirstUser", (db) =>
          db
            .select({ data: SessionMessageTable.data })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.sessionID))
            .where(
              and(
                eq(SessionTable.workspaceID, workspaceID),
                eq(SessionMessageTable.sessionID, sessionID),
                eq(SessionMessageTable.type, "user"),
              ),
            )
            .orderBy(asc(SessionMessageTable.sequence))
            .limit(1),
        )
        .pipe(Effect.orDie)
      const first = messages[0]
      if (first === undefined) return
      const user = yield* Schema.decodeUnknownEffect(User)(first.data).pipe(Effect.orDie)
      const request = yield* SessionModelRequest.plan({
        purpose: "title",
        sessionID,
        projectID: session.projectID,
        messageID: user.id,
        agent: session.agent,
        requestedModel: session.model,
      }).pipe(
        SessionModelRequest.withRouting(routing),
        Effect.provideService(Provider.Service, providers),
        Effect.provideService(PluginHooks.Service, hooks),
        Effect.provideService(Permission.Service, permission),
        Effect.provideService(Bus.Service, events),
        Effect.provideService(ModelResolver.Service, resolver),
        Effect.tapError((error) => Effect.logWarning("Session title model routing failed", { sessionID, error })),
        Effect.option,
      )
      if (request._tag === "None") return
      const providerContext = {
        purpose: request.value.purpose,
        sessionID: request.value.sessionID,
        messageID: request.value.messageID,
        agent: request.value.agent,
        requestedModel: request.value.requestedModel,
        model: request.value.model,
      }
      const http = yield* SessionHttp.middleware(providerContext).pipe(
        Effect.provideService(PluginHooks.Service, hooks),
      )
      const chunks: string[] = []
      const result = yield* providers
        .stream({
          context: providerContext,
          selection: request.value.resolved.selection,
          runtimeModel: request.value.resolved.runtimeModel,
          authentication: request.value.resolved.authentication,
          http,
          messages: [Message.user(user.text)],
          system: PROMPT,
          tools: [],
          toolChoice: ToolChoice.make("none"),
        })
        .pipe(
          Stream.runForEach((event) => {
            if (event.type === "text-delta") chunks.push(event.text)
            return Effect.void
          }),
          Effect.result,
        )
      if (result._tag === "Failure") return
      const title = sanitizeTitle(chunks.join("")) ?? fallbackTitle(user.text)
      if (title === undefined) return
      const current = (yield* database
        .use("sessionTitleRenameRead", (db) =>
          db
            .select()
            .from(SessionTable)
            .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
            .limit(1),
        )
        .pipe(Effect.orDie))[0]
      if (current === undefined || !isUntitled(current.title)) return
      const now = yield* DateTime.nowAsDate
      const renamed = yield* database.transactRoot(
        database.use("sessionTitleRenameLock", (db) =>
          db.update(SessionTable)
            .set({ title: Session.Title.make(truncate(title)), timeUpdated: now })
            .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID), eq(SessionTable.title, "New session")))
            .returning({ id: SessionTable.id }),
        ).pipe(Effect.map((rows) => rows.length === 1), Effect.orDie),
      ).pipe(Effect.orDie)
      if (!renamed) return
      yield* events.publish(SessionEvent.Updated, {
        sessionID,
        session: Session.Info.make({
          id: current.id, projectID: current.projectID,
          ...(current.parentID === null ? {} : { parentID: current.parentID }),
          title: Session.Title.make(truncate(title)),
          ...(current.archivedAt === null ? {} : { archivedAt: current.archivedAt }),
          agent: current.agent, model: current.model, createdAt: current.timeCreated, updatedAt: now,
        }),
      }, { created: now }).pipe(Effect.orDie)
    })
    const generateForFirstPrompt = Effect.fn("SessionTitle.generateForFirstPrompt")(function* (sessionID: Session.ID) {
      if (running.has(sessionID)) return
      running.add(sessionID)
      yield* attempt(sessionID).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            running.delete(sessionID)
          }),
        ),
      )
    })
    return { generateForFirstPrompt }
  })
