import { LLMEvent } from "@opencode-ai/ai/schema/events"
import { Agent } from "@bymorning/schema/agent"
import type { Event } from "@bymorning/schema/event"
import { Assistant, ID } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { SessionError } from "@bymorning/schema/session-error"
import { SessionEvent } from "@bymorning/schema/session-event"
import { Usage } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Exit, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "../../src/bus.js"
import { SessionRecorder } from "../../src/session/recorder.js"
import { ToolOutput } from "../../src/tool-output.js"
import { recorderDatabase } from "./recorder-database.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000821")
const workspaceID = Workspace.ID.make("wrk_recorder")
const assistant = Assistant.make({
  id: ID.make("00000000-0000-4000-8000-000000000822"),
  sessionID,
  sequence: 1,
  createdAt: new Date(0),
  type: "assistant",
  agent: Agent.DefaultID,
  model: { provider: Provider.Bymorning, id: "test" },
  content: [],
  usage: Usage.make({
    cost: 0,
    costComplete: true,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }),
  time: { created: new Date(0) },
})
const output = ToolOutput.Service.of({
  truncate: (_sessionID, result) => Effect.succeed(result),
  read: () => Effect.die("unused"),
  readForTool: () => Effect.die("unused"),
})
const bus = (published: Array<{ readonly type: string; readonly data: unknown }>) =>
  Bus.Service.of({
    publish: ((definition: Event.Definition, data: unknown) =>
      Effect.sync(() => {
        published.push({ type: definition.type, data })
        return undefined as never
      })) as Bus.Interface["publish"],
    subscribe: () => Effect.succeed(Stream.empty),
  })
/** The flusher sleeps on the Clock, so the window must elapse on the TestClock. */
const window = Duration.sum(SessionRecorder.FlushWindow, Duration.millis(1))
const deltas = (recorder: SessionRecorder.Interface, id: string, count: number) =>
  Effect.forEach(
    Array.from({ length: count }, (_, index) => `${index} `),
    (text) => recorder.write(LLMEvent.textDelta({ id, text })),
    { discard: true },
  )
const text = (database: ReturnType<typeof recorderDatabase>, id: string) =>
  database
    .message()
    .content.find(
      (part): part is Extract<Assistant["content"][number], { type: "text" }> => part.type === "text" && part.id === id,
    )

describe("Session Recorder streaming writes", () => {
  it.effect("coalesces deltas within the window into one row write while publishing every delta", () =>
    Effect.gen(function* () {
      const published: Array<{ readonly type: string; readonly data: unknown }> = []
      const database = recorderDatabase(assistant)
      const recorder = yield* SessionRecorder.make({
        database: database.service,
        events: bus(published),
        workspaceID,
        assistant,
      })
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.textStart({ id: "answer" }))
      // A reconnecting client hydrates the part as soon as it starts.
      expect(database.writes()).toBe(1)
      expect(text(database, "answer")).toEqual({ type: "text", id: "answer", text: "" })

      yield* deltas(recorder, "answer", 100)
      expect(published.filter((event) => event.type === SessionEvent.TextDelta.type)).toHaveLength(100)
      expect(database.writes()).toBe(1)
      expect(text(database, "answer")).toEqual({ type: "text", id: "answer", text: "" })

      yield* TestClock.adjust(window)
      expect(database.writes()).toBe(2)
      expect(database.flushes()).toBe(2)
      expect(text(database, "answer")?.text).toBe(Array.from({ length: 100 }, (_, index) => `${index} `).join(""))

      // Idle recordings do not write.
      yield* TestClock.adjust(Duration.times(window, 4))
      expect(database.writes()).toBe(2)

      // The next window coalesces again.
      yield* deltas(recorder, "answer", 50)
      expect(database.writes()).toBe(2)
      yield* TestClock.adjust(window)
      expect(database.writes()).toBe(3)
      expect(text(database, "answer")?.text).toBe(Array.from({ length: 150 }, (_, index) => `${index % 100} `).join(""))
    }).pipe(Effect.provideService(ToolOutput.Service, output)),
  )

  it.effect("writes a part end, input end, tool settlement, and step finish immediately", () =>
    Effect.gen(function* () {
      const published: Array<{ readonly type: string; readonly data: unknown }> = []
      const database = recorderDatabase(assistant)
      const recorder = yield* SessionRecorder.make({
        database: database.service,
        events: bus(published),
        workspaceID,
        assistant,
      })
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.textStart({ id: "answer" }))
      yield* deltas(recorder, "answer", 10)
      const beforeEnd = database.writes()
      yield* recorder.write(LLMEvent.textEnd({ id: "answer" }))
      expect(database.writes()).toBe(beforeEnd + 1)
      expect(text(database, "answer")?.text).toBe(Array.from({ length: 10 }, (_, index) => `${index} `).join(""))
      expect(published.at(-1)).toMatchObject({ type: SessionEvent.TextEnded.type })

      yield* recorder.write(LLMEvent.reasoningStart({ id: "thought" }))
      yield* recorder.write(LLMEvent.reasoningDelta({ id: "thought", text: "hmm" }))
      const beforeReasoning = database.writes()
      yield* recorder.write(LLMEvent.reasoningEnd({ id: "thought" }))
      expect(database.writes()).toBe(beforeReasoning + 1)
      expect(database.message().content[1]).toMatchObject({ type: "reasoning", text: "hmm" })

      yield* recorder.write(LLMEvent.toolInputStart({ id: "call", name: "read" }))
      yield* recorder.write(LLMEvent.toolInputDelta({ id: "call", name: "read", text: '{"path":' }))
      yield* recorder.write(LLMEvent.toolInputDelta({ id: "call", name: "read", text: '"notes.txt"}' }))
      expect(database.message().content[2]).toMatchObject({ type: "tool", state: { status: "streaming", input: "" } })
      const beforeInputEnd = database.writes()
      yield* recorder.write(LLMEvent.toolInputEnd({ id: "call", name: "read" }))
      expect(database.writes()).toBe(beforeInputEnd + 1)
      expect(database.message().content[2]).toMatchObject({
        type: "tool",
        state: { status: "streaming", input: '{"path":"notes.txt"}' },
      })
      yield* recorder.write(LLMEvent.toolCall({ id: "call", name: "read", input: { path: "notes.txt" } }))
      expect(database.message().content[2]).toMatchObject({ type: "tool", state: { status: "running" } })

      const beforeFinish = database.writes()
      yield* recorder.write(
        LLMEvent.stepFinish({
          index: 0,
          reason: { normalized: "tool-calls" },
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      )
      // Step finish writes usage through its own transaction; no partial output was pending.
      expect(database.writes()).toBe(beforeFinish + 1)
      yield* recorder.write(LLMEvent.finish({ reason: { normalized: "tool-calls" } }))
      yield* recorder.finishStream

      const beforeResult = database.writes()
      yield* recorder.succeedTool("call", { content: "hello" })
      expect(database.writes()).toBe(beforeResult + 1)
      expect(database.message().content[2]).toMatchObject({ type: "tool", state: { status: "completed" } })
      yield* recorder.finishTools
      // No window flush is left behind by boundary writes.
      yield* TestClock.adjust(window)
      expect(database.writes()).toBe(beforeResult + 1)
    }).pipe(Effect.provideService(ToolOutput.Service, output)),
  )

  it.effect("fails with the in-memory content and stops writing afterwards", () =>
    Effect.gen(function* () {
      const published: Array<{ readonly type: string; readonly data: unknown }> = []
      const database = recorderDatabase(assistant)
      const recorder = yield* SessionRecorder.make({
        database: database.service,
        events: bus(published),
        workspaceID,
        assistant,
      })
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.textStart({ id: "answer" }))
      yield* deltas(recorder, "answer", 20)
      expect(text(database, "answer")?.text).toBe("")
      const error = SessionError.Provider.make({ message: "stream broke" })
      yield* recorder.fail(error, 0)
      const failed = database.message()
      expect(failed.error).toEqual(error)
      expect(failed.time.completed).toBeInstanceOf(Date)
      expect(text(database, "answer")?.text).toBe(Array.from({ length: 20 }, (_, index) => `${index} `).join(""))
      expect(published.at(-1)).toMatchObject({
        type: SessionEvent.Failed.type,
        data: { message: { content: [{ type: "text", text: text(database, "answer")?.text }] } },
      })
      // The pending window flush must not rewrite a settled row.
      const settled = database.writes()
      yield* TestClock.adjust(window)
      expect(database.writes()).toBe(settled)
    }).pipe(Effect.provideService(ToolOutput.Service, output)),
  )

  it.effect("flushes pending deltas when its scope closes, including on interruption", () =>
    Effect.gen(function* () {
      const published: Array<{ readonly type: string; readonly data: unknown }> = []
      const database = recorderDatabase(assistant)
      const scope = yield* Scope.make()
      const recorder = yield* SessionRecorder.make({
        database: database.service,
        events: bus(published),
        workspaceID,
        assistant,
      }).pipe(Scope.provide(scope))
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.textStart({ id: "answer" }))
      yield* deltas(recorder, "answer", 30)
      expect(text(database, "answer")?.text).toBe("")
      const before = database.writes()
      yield* Scope.close(scope, Exit.interrupt(0 as never))
      expect(database.writes()).toBe(before + 1)
      expect(text(database, "answer")?.text).toBe(Array.from({ length: 30 }, (_, index) => `${index} `).join(""))
      // The row keeps accepting the owner's terminal settlement after the recording closed.
      expect(database.message().time.completed).toBeUndefined()
    }).pipe(Effect.provideService(ToolOutput.Service, output)),
  )

  it.effect("leaves a row that another writer completed untouched", () =>
    Effect.gen(function* () {
      const published: Array<{ readonly type: string; readonly data: unknown }> = []
      // Interruption settled the row between this recorder's construction and its first write.
      const completed = Assistant.make({
        ...assistant,
        error: SessionError.Aborted.make({ message: "Execution interrupted" }),
        time: { created: new Date(0), completed: new Date(1) },
      })
      const database = recorderDatabase(completed)
      const recorder = yield* SessionRecorder.make({
        database: database.service,
        events: bus(published),
        workspaceID,
        assistant,
      })
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.textStart({ id: "answer" }))
      yield* recorder.write(LLMEvent.textDelta({ id: "answer", text: "late" }))
      yield* TestClock.adjust(window)
      expect(database.writes()).toBe(0)
      expect(database.message().content).toEqual([])
      expect(database.message().error).toEqual(completed.error)
    }).pipe(Effect.provideService(ToolOutput.Service, output)),
  )
})
