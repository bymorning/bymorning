import { layer as storageLayer } from "../fixture/storage.js"
import { LLMEvent } from "@opencode-ai/ai/schema/events"
import { Agent } from "@bymorning/schema/agent"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import type { Event } from "@bymorning/schema/event"
import { Assistant, ID } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import { Session } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { ToolOutput as ToolOutputSchema } from "@bymorning/schema/tool-output"
import { Usage } from "@bymorning/schema/usage"
import { Workspace } from "@bymorning/schema/workspace"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema, Stream } from "effect"
import { Bus } from "../../src/bus.js"
import { Config } from "../../src/config.js"
import { SessionRecorder } from "../../src/session/recorder.js"
import { fromHistory } from "../../src/session/provider-message.js"
import { Storage } from "../../src/storage.js"
import { ToolOutput } from "../../src/tool-output.js"
import { recorderDatabase } from "./recorder-database.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000811")
const workspaceID = Workspace.ID.make("wrk_recorder_output")

describe("Session Recorder ToolOutput integration", () => {
  it.effect("bounds every successful settlement, retains metadata and result, and bypasses failures", () =>
    Effect.gen(function* () {
      const published: Array<{ readonly type: string; readonly data: unknown }> = []
      const retained: Array<unknown> = []
      const bus = Layer.mock(Bus.Service, {
        publish: ((definition: Event.Definition, data: unknown) =>
          Effect.sync(() => {
            published.push({ type: definition.type, data })
            // Recorder ignores publication payloads; this stub observes only the durable input boundary.
            return undefined as never
          })) as Bus.Interface["publish"],
                subscribe: () => Effect.succeed(Stream.empty),
      })
      const output = ToolOutput.Service.of({
        truncate: (_sessionID, result) =>
          Effect.sync(() => {
            retained.push(result)
            return {
              ...result,
              content: [{ type: "text", text: "bounded" }],
              metadata: { ...result.metadata, truncated: true, outputID: "out_test" },
            }
          }),
        read: () => Effect.die("unused"),
        readForTool: () => Effect.die("unused"),
      })
      const assistant = Assistant.make({
        id: ID.make("00000000-0000-4000-8000-000000000812"),
        sessionID,
        sequence: 1,
        createdAt: new Date(0),
        type: "assistant",
        agent: Agent.DefaultID,
        model: { provider: Provider.Bymorning, id: "test" },
        content: [],
        usage: Usage.make({ cost: 0, costComplete: true, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
        time: { created: new Date(0) },
      })
      const retainedMessage = recorderDatabase(assistant)
      const events = yield* Bus.Service.pipe(Effect.provide(bus))
      const recorder = yield* SessionRecorder.make({
        database: retainedMessage.service,
        events,
        workspaceID,
        assistant,
      }).pipe(Effect.provideService(ToolOutput.Service, output))

      yield* recorder.write(LLMEvent.textStart({ id: "terminal-text" }))
      yield* recorder.write(LLMEvent.textEnd({ id: "terminal-text", text: "authoritative answer" }))
      yield* recorder.write(LLMEvent.reasoningStart({ id: "terminal-reasoning" }))
      yield* recorder.write(LLMEvent.reasoningEnd({ id: "terminal-reasoning", text: "authoritative reasoning" }))
      expect(published.find((event) => event.type === SessionEvent.TextEnded.type)?.data).toMatchObject({
        partID: "terminal-text",
        text: "authoritative answer",
      })
      expect(published.find((event) => event.type === SessionEvent.ReasonEnded.type)?.data).toMatchObject({
        partID: "terminal-reasoning",
        text: "authoritative reasoning",
      })

      yield* recorder.write(LLMEvent.toolCall({ id: "local", name: "large", input: {} }))
      yield* recorder.succeedTool("local", {
        output: { unchanged: true },
        content: [{ type: "text", text: "full output" }],
        metadata: { source: "local" },
      })
      yield* recorder.succeedTool("local", { output: 1n })
      yield* recorder.write(LLMEvent.toolCall({ id: "hosted", name: "large", input: {}, providerExecuted: true }))
      expect(yield* Effect.flip(recorder.succeedTool("hosted", { content: "wrong execution path" }))).toMatchObject({
        _tag: "Session.Recorder.OrderError",
      })
      yield* recorder.write(
        LLMEvent.toolResult({
          id: "hosted",
          name: "large",
          result: { type: "content", value: [{ type: "text", text: "full output" }] },
          output: { structured: { unchanged: true }, content: [{ type: "text", text: "full output" }] },
          providerExecuted: true,
          providerMetadata: { test: { source: "hosted" } },
        }),
      )
      yield* recorder.write(LLMEvent.toolCall({ id: "failed", name: "large", input: {} }))
      yield* recorder.write(LLMEvent.toolError({ id: "failed", name: "large", message: "nope" }))
      yield* recorder.write(LLMEvent.toolCall({ id: "failed-result", name: "large", input: {} }))
      yield* recorder.write(
        LLMEvent.toolResult({
          id: "failed-result",
          name: "large",
          result: { type: "error", value: "also nope" },
          output: { structured: null, content: [{ type: "text", text: "must never be archived" }] },
        }),
      )

      expect(retained).toEqual([
        {
          output: { unchanged: true },
          content: [{ type: "text", text: "full output" }],
          metadata: { source: "local" },
        },
        {
          output: { unchanged: true },
          content: [{ type: "text", text: "full output" }],
        },
      ])
      const successes = published.filter((event) => event.type === SessionEvent.ToolSuccess.type)
      expect(successes).toHaveLength(2)
      expect(published.filter((event) => event.type === SessionEvent.ToolFailed.type)).toHaveLength(2)
      expect(successes[0]?.data).toEqual(
        expect.objectContaining({
          content: [{ type: "text", text: "bounded" }],
          result: { unchanged: true },
          metadata: { source: "local", truncated: true, outputID: "out_test" },
        }),
      )
      expect(successes[1]?.data).toEqual(
        expect.objectContaining({
          content: [{ type: "text", text: "bounded" }],
          result: { unchanged: true },
          metadata: { truncated: true, outputID: "out_test" },
          providerExecuted: true,
          providerMetadata: { test: { source: "hosted" } },
        }),
      )
      expect(retainedMessage.message().content).toHaveLength(6)
      const replay = fromHistory([
        Assistant.make({
          id: ID.make("00000000-0000-4000-8000-000000000813"),
          sessionID,
          sequence: 2,
          createdAt: new Date(0),
          type: "assistant",
          agent: Agent.DefaultID,
          model: { provider: Provider.Bymorning, id: "test" },
          content: [
            {
              type: "tool",
              id: "local",
              name: "large",
              state: {
                status: "completed",
                input: {},
                content: [{ type: "text", text: "bounded" }],
                result: { unchanged: true },
                metadata: { source: "local", truncated: true, outputID: "out_test" },
              },
              time: { created: new Date(0), ran: new Date(0), completed: new Date(0) },
            },
          ],
          usage: Usage.make({
            cost: 0,
            costComplete: true,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
          time: { created: new Date(0) },
        }),
      ])
      expect(replay[1]).toMatchObject({
        content: [
          {
            result: { type: "content", value: [{ type: "text", text: "bounded" }] },
            metadata: { source: "local", truncated: true, outputID: "out_test" },
          },
        ],
      })
      expect(JSON.stringify(replay[1])).not.toContain("unchanged")
      expect(JSON.stringify(replay[1])).not.toContain("full output")

      expect(yield* Effect.flip(recorder.succeedTool("missing", { output: null }))).toMatchObject({
        _tag: "Session.Recorder.OrderError",
      })
      yield* recorder.write(LLMEvent.toolCall({ id: "pending-local", name: "large", input: {} }))
      yield* recorder.write(LLMEvent.finish({ reason: { normalized: "stop" } }))
      yield* recorder.finishStream
      expect(yield* Effect.flip(recorder.finishTools)).toMatchObject({ _tag: "Session.Recorder.ProviderError" })
      yield* recorder.write(
        LLMEvent.toolCall({ id: "pending-hosted", name: "large", input: {}, providerExecuted: true }),
      )
      expect(yield* Effect.flip(recorder.finishStream)).toMatchObject({ _tag: "Session.Recorder.ProviderError" })
      yield* recorder.write(
        LLMEvent.toolResult({
          id: "pending-hosted",
          name: "large",
          result: { type: "json", value: "done" },
          providerExecuted: true,
        }),
      )
      yield* recorder.finishStream
      yield* recorder.succeedTool("pending-local", { content: "done" })
      yield* recorder.finishTools
    }),
  )

  it.effect(
    "archives and exactly retrieves oversized local and provider-hosted successful results with real Storage",
    () =>
      Effect.gen(function* () {
        const published: Array<{ readonly type: string; readonly data: unknown }> = []
        const events = Bus.Service.of({
          publish: ((definition: Event.Definition, data: unknown) =>
            Effect.sync(() => {
              published.push({ type: definition.type, data })
              return undefined as never
            })) as Bus.Interface["publish"],
                    subscribe: () => Effect.succeed(Stream.empty),
        })
        const assistant = Assistant.make({
          id: ID.make("00000000-0000-4000-8000-000000000814"), sessionID, sequence: 1, createdAt: new Date(0), type: "assistant",
          agent: Agent.DefaultID, model: { provider: Provider.Bymorning, id: "test" }, content: [],
          usage: Usage.make({ cost: 0, costComplete: true, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }), time: { created: new Date(0) },
        })
        const retainedMessage = recorderDatabase(assistant)
        const output = yield* ToolOutput.Service
        const recorder = yield* SessionRecorder.make({
          database: retainedMessage.service,
          events,
          workspaceID,
          assistant,
        })
        const original = "one\ntwo\nthree"

        yield* recorder.write(LLMEvent.toolCall({ id: "real-local", name: "large", input: {} }))
        yield* recorder.succeedTool("real-local", {
          output: null,
          content: [{ type: "text", text: original }],
        })
        yield* recorder.write(
          LLMEvent.toolCall({ id: "real-hosted", name: "large", input: {}, providerExecuted: true }),
        )
        yield* recorder.write(
          LLMEvent.toolResult({
            id: "real-hosted",
            name: "large",
            result: { type: "content", value: [{ type: "text", text: original }] },
            output: { structured: null, content: [{ type: "text", text: original }] },
            providerExecuted: true,
          }),
        )

        const successes = published.filter((event) => event.type === SessionEvent.ToolSuccess.type)
        expect(successes).toHaveLength(2)
        for (const success of successes) {
          const data = success.data as { readonly metadata: { readonly truncated: boolean; readonly outputID: string } }
          expect(data.metadata.truncated).toBe(true)
          const storedOutputID = ToolOutputSchema.ID.make(data.metadata.outputID)
          const first = yield* output.read(sessionID, storedOutputID)
          const final = yield* output.read(sessionID, storedOutputID, { cursor: first.cursor })
          expect(first.content + final.content).toBe(original)
          expect(final.cursor).toBe(final.size)
        }
        expect(retainedMessage.message().content).toHaveLength(2)
      }).pipe(Effect.provide(realOutputLayer)),
  )
})

const realOutputLayer = ToolOutput.layer(workspaceID).pipe(
  Layer.provide(
    Layer.merge(
      Layer.succeed(
        Config.Service,
        Config.Service.of({
          provider: { update: () => Effect.die("unused") },
          model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
          get: Effect.succeed(
            Schema.decodeUnknownSync(ConfigSchema.Info)({ tool_output: { max_lines: 2, max_bytes: 8 } }),
          ),
          update: () => Effect.die("unused"),
          refresh: Effect.die("unused"),
          mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
          modelPolicy: {
            reconcile: () => Effect.die("unused"),
            initialize: () => Effect.die("unused"),
            toggle: () => Effect.die("unused"),
            setDefault: () => Effect.die("unused"),
          },
          plugin: Config.pluginUnavailable,
          entries: () => Effect.die("unused"),
          changes: () => Stream.empty,
        }),
      ),
      storageLayer,
    ),
  ),
)
