import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import { Agent as AgentSchema } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { Project } from "@bymorning/schema/project"
import { Tool as ToolSchema } from "@bymorning/schema/tool"
import { ToolOutput as ToolOutputSchema } from "@bymorning/schema/tool-output"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Agent } from "../src/agent.js"
import { ToolOutputPlugin } from "../src/plugin/internal/tool/tool-output.js"
import { Tool } from "../src/tool.js"
import { ToolOutput } from "../src/tool-output.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000821")
const otherSessionID = Session.ID.make("00000000-0000-4000-8000-000000000822")
const messageID = MessageID.make("00000000-0000-4000-8000-000000000823")
const outputID = ToolOutputSchema.ID.make("out_tool_output_plugin")
const agentName = AgentSchema.ID.make("tool-output-test")
const projectID = Project.ID.make("prj_00000000000000000000000803")

describe("ToolOutput built-in Tool", () => {
  it.effect(
    "attributes permission, authorizes by Session, pages with a continuation hint, and maps unavailable reads",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make<ReadonlyArray<unknown>>([])
        const permissions = yield* Ref.make<ReadonlyArray<unknown>>([])
        const read = (requestedSessionID: Session.ID, requestedOutputID: ToolOutputSchema.ID, input = {}) =>
          Ref.update(reads, (current) => [
            ...current,
            { sessionID: requestedSessionID, outputID: requestedOutputID, input },
          ]).pipe(
            Effect.andThen(
              requestedSessionID !== sessionID || requestedOutputID !== outputID
                ? Effect.fail(new ToolOutput.UnavailableError({}))
                : Effect.succeed(
                    "cursor" in input && input.cursor === 5
                      ? { content: "omega", cursor: 10, size: 10 }
                      : { content: "alpha", cursor: 5, size: 10 },
                  ),
            ),
          )
        const service = ToolOutput.Service.of({
          truncate: (_sessionID, result) => Effect.succeed(result),
          read,
          readForTool: (requestedSessionID, requestedOutputID, input = {}) =>
            read(requestedSessionID, requestedOutputID, input).pipe(
              Effect.map((page) => ({
                ...page,
                content:
                  page.cursor === page.size
                    ? page.content
                    : `${page.content}\n\n[More output is available. Call tool_output with {"outputID":"${outputID}","cursor":${page.cursor}} to continue.]`,
              })),
            ),
        })
        const tool = yield* install(service)
        const context: Tool.Context = {
          caller: { type: "session", sessionID, agent: agentName, messageID, projectID },
          id: ToolSchema.CallID.make("call_tool_output"),
          progress: () => Effect.void,
          elicit: () => Effect.die("unused"),
          permission: (request: Tool.PermissionRequest) => Ref.update(permissions, (current) => [...current, request]),
        }
        const dependencies = [Effect.provideService(Agent.Service, {} as Agent.Interface)] as const

        const execute = (input: unknown, context: Tool.Context) =>
          tool.execute({
            call: { type: "tool-call", name: "tool_output", id: context.id, input },
            context,
          })
        const first = yield* execute({ outputID }, context).pipe(...dependencies)
        expect(first).toEqual({
          output: { next: 5 },
          content: [
            {
              type: "text",
              text: `alpha\n\n[More output is available. Call tool_output with {"outputID":"${outputID}","cursor":5} to continue.]`,
            },
          ],
          metadata: { truncated: true, outputID, cursor: 0, next: 5 },
        })

        const final = yield* execute({ outputID, cursor: 5 }, context).pipe(...dependencies)
        expect(final).toEqual({
          output: {},
          content: [{ type: "text", text: "omega" }],
          metadata: { truncated: false, outputID, cursor: 5 },
        })
        expect(yield* Ref.get(permissions)).toEqual([
          {
            action: "tool_output",
            resources: [outputID],
            save: [outputID],
            metadata: { outputID, cursor: 0 },
          },
          expect.objectContaining({ metadata: { outputID, cursor: 5 } }),
        ])

        const unavailable = yield* execute(
          { outputID },
          {
            ...context,
            caller: { type: "session", sessionID: otherSessionID, agent: agentName, messageID, projectID },
          },
        ).pipe(...dependencies, Effect.flip)
        expect(unavailable._tag).toBe("Tool.Error")
        expect(unavailable.message).toBe("Tool output is unavailable")
        expect(yield* Ref.get(reads)).toContainEqual({ sessionID: otherSessionID, outputID, input: {} })
      }),
  )
})

const install = (output: ToolOutput.Interface) =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    yield* ToolOutputPlugin.effect({ tool: tools } as unknown as PluginContext).pipe(
      Effect.provideService(ToolOutput.Service, output),
    )
    const snapshot = yield* tools.snapshot()
    expect(snapshot.definitions.map((definition) => definition.name)).toContain("tool_output")
    return snapshot
  }).pipe(Effect.provide(Tool.layer.pipe(Layer.provide(PluginHooks.layer))), Effect.scoped)
