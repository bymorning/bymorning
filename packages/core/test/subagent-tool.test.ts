import { describe, expect, it } from "@effect/vitest"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import type { SessionContext } from "@bymorning/plugin/effect/session"
import { Agent } from "@bymorning/schema/agent"
import { MessageSchema } from "@bymorning/schema/message"
import { Provider } from "@bymorning/schema/provider"
import type { Permission as PermissionSchema } from "@bymorning/schema/permission"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { SessionInbox } from "@bymorning/schema/session-inbox"
import { Tool as ToolSchema } from "@bymorning/schema/tool"
import { empty } from "@bymorning/schema/usage"
import { Message as ProviderMessage } from "@opencode-ai/ai/schema/messages"
import { Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { NotFoundError, Service } from "../src/agent.js"
import { Job } from "../src/job.js"
import { Runner } from "../src/session/runner.js"
import { SessionError } from "@bymorning/schema/session-error"
import { SubagentTool } from "../src/plugin/internal/tool/subagent.js"
import { PluginRuntime } from "../src/plugin/runtime.js"
import { agentService } from "./service-fixtures.js"

const parentID = Session.ID.make("00000000-0000-4000-8000-000000000801")
const childID = Session.ID.make("00000000-0000-4000-8000-000000000802")
const otherID = Session.ID.make("00000000-0000-4000-8000-000000000803")
const messageID = MessageSchema.ID.make("00000000-0000-4000-8000-000000000804")
const callerID = Agent.ID.make("caller")
const reviewerID = Agent.ID.make("reviewer")
const fallbackID = Agent.ID.make("fallback")
const parentModel = { provider: Provider.Bymorning, id: "parent" }
const childModel = { provider: Provider.Bymorning, id: "child" }
type CatalogContext = SessionContext & { readonly permissions: PermissionSchema.Ruleset }

const caller = makeAgent(callerID, "primary", {
  permissions: [{ action: "*", resource: "*", effect: "allow" }],
})
const reviewer = makeAgent(reviewerID, "subagent", { description: "Reviews code", model: childModel })
const fallback = makeAgent(fallbackID, "subagent")

describe("SubagentTool", () => {
  it.effect("registers the exact foreground contract and runs prompt before the child job", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const progress: ToolSchema.Metadata[] = []
      const runtime = makeRuntime({
        prompt: (input) => Effect.sync(() => calls.push(`prompt:${input.text}`)).pipe(Effect.as(prompted(input))),
        onStart: (input) => calls.push(`start:${input.id}:${input.type}:${JSON.stringify(input.metadata)}`),
      })
      const registered = yield* register(runtime)

      expect(registered.tool.options).toEqual({ codemode: false })
      expect(registered.tool.description).toBe(SubagentTool.description)
      expect(
        yield* Schema.decodeUnknownEffect(SubagentTool.Input)({
          agent: reviewerID,
          description: "review code",
          prompt: "review this",
        }),
      ).toEqual({ agent: reviewerID, description: "review code", prompt: "review this" })
      const advertisedInput = JSON.stringify(Schema.toJsonSchemaDocument(SubagentTool.Input).schema)
      expect(advertisedInput).not.toContain("00000000-0000-0000-0000-000000000000")
      expect(advertisedInput).not.toContain("ffffffff-ffff-ffff-ffff-ffffffffffff")
      expect(advertisedInput).toContain("Never invent or generate a sessionID")
      expect(advertisedInput).toContain('"enum":["new"]')

      const result = yield* execute(
        registered.tool,
        {
          agent: reviewerID,
          description: "review code",
          prompt: "review this",
        },
        progress,
      )

      expect(calls).toEqual([
        "prompt:You are a subagent spawned by another session.\nreview this",
        `start:${childID}:subagent:{}`,
      ])
      expect(progress).toEqual([{ sessionID: childID, status: "running" }])
      expect(result).toEqual({
        output: { sessionID: childID, status: "completed", output: "firstsecond" },
        content: [
          { type: "text", text: `<subagent sessionID="${childID}" state="completed">\nfirstsecond\n</subagent>` },
        ],
        metadata: { sessionID: childID, status: "completed" },
      })
      expect(runtime.observed.messages).toEqual([
        { sessionID: childID, order: "desc", limit: 20 },
      ])
      expect(runtime.observed.created).toEqual([
        { parentID, title: "review code", agent: reviewerID, model: childModel },
      ])
    }),
  )

  it.effect("uses only the newest twenty messages and returns NO_TEXT when the completed reply is position 21", () =>
    Effect.gen(function* () {
      const twenty = Array.from({ length: 20 }, (_, index) => assistant(`new-${index}`, { error: true }))
      const runtime = makeRuntime({ messages: [...twenty, assistant("too-old")] })
      const registered = yield* register(runtime)
      const result = yield* execute(registered.tool, {
        agent: reviewerID,
        description: "review code",
        prompt: "review",
      })
      expect(result.output).toEqual({
        sessionID: childID,
        status: "completed",
        output: "Subagent completed without a text response.",
      })

      runtime.observed.page = [assistant("position-20"), ...twenty.slice(0, 19)]
      const continued = yield* execute(registered.tool, {
        agent: reviewerID,
        description: "continue review",
        prompt: "continue",
        sessionID: childID,
      })
      expect(continued.output).toMatchObject({ output: "firstposition-20" })
    }),
  )

  it.effect("waits for the child to become idle before reading its final response", () =>
    Effect.gen(function* () {
      const waiting = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const runtime = makeRuntime({
        awaitIdle: Deferred.succeed(waiting, undefined).pipe(Effect.andThen(Deferred.await(release))),
      })
      const result = yield* execute((yield* register(runtime)).tool, {
        agent: reviewerID,
        description: "review code",
        prompt: "review",
      }).pipe(Effect.forkChild)

      yield* Deferred.await(waiting)
      expect(runtime.observed.messages).toEqual([])

      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(result)).output).toMatchObject({ output: "firstsecond" })
    }),
  )

  it.effect("inherits the arbitrary parent model for model-less general and explore Agents", () =>
    Effect.gen(function* () {
      const inherited = { provider: Provider.Name.make("arbitrary"), id: "parent-model" }
      const modelLess = [
        makeAgent(Agent.ID.make("general"), "subagent"),
        makeAgent(Agent.ID.make("explore"), "subagent"),
      ]
      const runtime = makeRuntime({ parentModel: inherited })
      const registered = yield* register(runtime, [caller, ...modelLess])

      for (const agent of modelLess) {
        yield* execute(
          registered.tool,
          {
            agent: agent.id,
            description: `${agent.id} task`,
            prompt: "work",
          },
          [],
          [caller, ...modelLess],
        )
      }

      expect(runtime.observed.created).toEqual(
        modelLess.map((agent) => ({
          parentID,
          title: `${agent.id} task`,
          agent: agent.id,
          model: inherited,
        })),
      )
    }),
  )

  it.effect('treats sessionID "new" as a fresh child request', () =>
    Effect.gen(function* () {
      const runtime = makeRuntime()
      yield* execute((yield* register(runtime)).tool, {
        agent: reviewerID,
        description: "new review",
        prompt: "review",
        sessionID: "new",
      })
      expect(runtime.observed.created).toEqual([
        { parentID, title: "new review", agent: reviewerID, model: childModel },
      ])
    }),
  )

  it.effect("continues directly and applies the configured-model switching matrix", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime({ existingAgent: fallbackID, existingModel: parentModel })
      const registered = yield* register(runtime)
      yield* execute(registered.tool, {
        agent: reviewerID,
        description: "continue review",
        prompt: "plain continuation",
        sessionID: childID,
      })
      expect(runtime.observed.prompts).toEqual(["plain continuation"])
      expect(runtime.observed.switches).toEqual([
        { type: "agent", sessionID: childID, agent: reviewerID },
        { type: "model", sessionID: childID, model: childModel },
      ])

      runtime.observed.existingAgent = reviewerID
      yield* execute(registered.tool, {
        agent: fallbackID,
        description: "continue review",
        prompt: "keep model",
        sessionID: childID,
      })
      expect(runtime.observed.switches.at(-1)).toEqual({ type: "agent", sessionID: childID, agent: fallbackID })
    }),
  )

  it.effect("steers a running direct child without starting a second child run", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime({
        joinRunning: true,
        block: Effect.succeed({
          type: "finished",
          info: {
            id: childID,
            type: "subagent",
            status: "completed",
            started_at: 1,
            completed_at: 2,
            output: "steered result",
          },
        }),
      })
      const result = yield* execute((yield* register(runtime)).tool, {
        agent: reviewerID,
        description: "steer review",
        prompt: "continue while running",
        sessionID: childID,
      })
      expect(runtime.observed.prompts).toEqual(["continue while running"])
      expect(runtime.observed.resumed).toBe(0)
      expect(result.output).toMatchObject({ sessionID: childID, output: "steered result" })
    }),
  )

  it.effect("preserves running progress on prompt failure", () =>
    Effect.gen(function* () {
      const progress: ToolSchema.Metadata[] = []
      const failedRuntime = makeRuntime({
        prompt: () => Effect.fail(new Session.NotFoundError({ sessionID: childID })),
      })
      const failed = yield* execute(
        (yield* register(failedRuntime)).tool,
        { agent: reviewerID, description: "fail prompt", prompt: "fail" },
        progress,
      ).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isFailure(failed)) expect(String(failed.cause)).toContain(`Failed to prompt subagent: ${childID}`)
      expect(progress).toEqual([{ sessionID: childID, status: "running" }])
    }),
  )

  it.effect("returns immediately for explicit background work and notifies once when the generation completes", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const runtime = { ...makeRuntime({ resume: Deferred.await(release) }), job: yield* Job.make }
      const registered = yield* register(runtime)
      const result = yield* execute(registered.tool, {
        agent: reviewerID,
        description: "background review",
        prompt: "review",
        background: true,
      })

      const output = [
        `The subagent is working in the background (sessionID: ${childID}). You will be notified automatically when it finishes.`,
        "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
        "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
      ].join("\n")
      expect(result).toEqual({
        output: { sessionID: childID, status: "running", output },
        content: [{ type: "text", text: output }],
        metadata: { sessionID: childID, status: "running", startedAt: 0 },
      })
      expect(runtime.observed.resumed).toBe(1)
      expect(runtime.observed.synthetics).toEqual([])
      expect(
        (yield* execute(registered.tool, {
          agent: reviewerID,
          description: "background review",
          prompt: "additional direction",
          sessionID: childID,
          background: true,
        })).output,
      ).toMatchObject({ sessionID: childID, status: "running" })

      yield* Deferred.succeed(release, undefined)
      yield* runtime.job.wait({ id: childID })
      yield* Effect.yieldNow
      expect(runtime.observed.synthetics).toEqual([
        {
          sessionID: parentID,
          text: `<subagent sessionID="${childID}" state="completed" description="background review">\nfirstsecond\n</subagent>`,
          description: "background review",
          metadata: {
            source: "subagent",
            childID,
            agent: reviewer.name,
            state: "completed",
            startedAt: 0,
          },
        },
      ])
    }),
  )

  it.effect("does not suppress a fresh continuation generation", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime()
      const registered = yield* register(runtime)
      for (const prompt of ["first", "second"]) {
        yield* execute(registered.tool, {
          agent: reviewerID,
          description: "background review",
          prompt,
          ...(prompt === "second" ? { sessionID: childID } : {}),
          background: true,
        })
        yield* Effect.yieldNow
      }
      expect(runtime.observed.synthetics).toHaveLength(2)
    }),
  )

  it.effect("uses the exact error notification envelope and fallback", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime({
        wait: Effect.succeed({
          timedOut: false,
          info: { id: childID, type: "subagent", status: "error", started_at: 1, completed_at: 2 },
        }),
      })
      yield* execute((yield* register(runtime)).tool, {
        agent: reviewerID,
        description: "background review",
        prompt: "review",
        background: true,
      })
      yield* Effect.yieldNow
      expect(runtime.observed.synthetics[0]).toEqual({
        sessionID: parentID,
        text: `<subagent sessionID="${childID}" state="error" description="background review">\nSubagent failed\n</subagent>`,
        description: "background review",
        metadata: { source: "subagent", childID, agent: reviewer.name, state: "error", startedAt: 1 },
      })
    }),
  )

  it.effect("observes an externally backgrounded foreground call", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime({
        joinRunning: true,
        block: Effect.succeed({
          type: "backgrounded",
          info: { id: childID, type: "subagent", status: "running", started_at: 7 },
        }),
        wait: Effect.succeed({
          timedOut: false,
          info: {
            id: childID,
            type: "subagent",
            status: "cancelled",
            started_at: 7,
            completed_at: 8,
          },
        }),
      })
      const result = yield* execute((yield* register(runtime)).tool, {
        agent: reviewerID,
        description: "background review",
        prompt: "review",
      })

      expect(result.output).toMatchObject({ sessionID: childID, status: "running" })
      yield* Effect.yieldNow
      expect(runtime.observed.synthetics).toEqual([
        {
          sessionID: parentID,
          text: `<subagent sessionID="${childID}" state="cancelled" description="background review">\nSubagent cancelled\n</subagent>`,
          description: "background review",
          metadata: {
            source: "subagent",
            childID,
            agent: reviewer.name,
            state: "cancelled",
            startedAt: 7,
          },
        },
      ])
    }),
  )

  it.effect("cancels both child authorities on interruption", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime({ block: Effect.interrupt })
      yield* execute((yield* register(runtime)).tool, {
        agent: reviewerID,
        description: "cancel review",
        prompt: "wait",
      }).pipe(Effect.exit)
      expect(runtime.observed.interrupted).toContain(childID)
      expect(runtime.observed.interruptionReasons).toContain("superseded")
      expect(runtime.observed.cancelled).toContain(childID)
    }),
  )

  it.effect("surfaces exact child error and cancellation failures", () =>
    Effect.gen(function* () {
      const failure = yield* execute(
        (yield* register(
          makeRuntime({
            block: Effect.succeed({
              type: "finished",
              info: {
                id: childID,
                type: "subagent",
                status: "error",
                started_at: 1,
                completed_at: 2,
                error: "runner failed",
              },
            }),
          }),
        )).tool,
        { agent: reviewerID, description: "fail review", prompt: "fail" },
      ).pipe(Effect.exit)
      expect(Exit.isFailure(failure)).toBe(true)
      if (Exit.isFailure(failure))
        expect(String(failure.cause)).toContain(`Subagent failed (sessionID: ${childID}): runner failed`)

      const cancelled = yield* execute(
        (yield* register(
          makeRuntime({
            block: Effect.succeed({
              type: "finished",
              info: {
                id: childID,
                type: "subagent",
                status: "cancelled",
                started_at: 1,
                completed_at: 2,
              },
            }),
          }),
        )).tool,
        { agent: reviewerID, description: "cancel review", prompt: "cancel" },
      ).pipe(Effect.exit)
      expect(Exit.isFailure(cancelled)).toBe(true)
      if (Exit.isFailure(cancelled))
        expect(String(cancelled.cause)).toContain(`Subagent cancelled (sessionID: ${childID})`)
    }),
  )

  it.effect("fails the child Job when Session resume returns RunError", () =>
    Effect.gen(function* () {
      const error = SessionError.Provider.make({ message: "child provider failed" })
      const runtime = { ...makeRuntime({ resume: Effect.fail(new Runner.RunError({ error })) }), job: yield* Job.make }
      yield* execute((yield* register(runtime)).tool, {
        agent: reviewerID,
        description: "failed child run",
        prompt: "fail",
        background: true,
      })
      const result = yield* runtime.job.wait({ id: childID })
      expect(result.info).toMatchObject({ status: "error" })
    }),
  )

  it.effect("builds a sorted catalog from the captured effective rules when the tool is present", () =>
    Effect.gen(function* () {
      const hidden = makeAgent(Agent.ID.make("hidden"), "subagent", { hidden: true })
      const primary = makeAgent(Agent.ID.make("primary"), "primary")
      const denied = makeAgent(Agent.ID.make("denied"), "subagent")
      const undescribed = makeAgent(Agent.ID.make("alpha"), "all")
      const renamed = makeAgent(Agent.ID.make("loud"), "subagent", {
        name: Agent.Name.make("Quiet"),
        description: "Renamed helper",
      })
      const selected = makeAgent(callerID, "primary", {
        permissions: [{ action: "subagent", resource: "*", effect: "allow" }],
      })
      const permissions = [
        ...selected.permissions,
        { action: "subagent", resource: denied.id, effect: "deny" as const },
      ]
      const registered = yield* register(makeRuntime(), [reviewer, hidden, primary, denied, undescribed, renamed, selected])
      const tools = { subagent: { description: SubagentTool.description, input: {} } }
      yield* registered.hook({
        sessionID: parentID,
        agent: callerID,
        requestedModel: parentModel,
        model: parentModel,
        system: [],
        messages: [],
        tools,
        permissions,
      })
      expect(tools.subagent.description).toBe(
        [
          SubagentTool.description,
          "",
          "Available subagents:",
          "- alpha: This subagent should only be called when explicitly requested.",
          "- loud (name: Quiet): Renamed helper",
          "- reviewer: Reviews code",
        ].join("\n"),
      )
      expect(JSON.stringify(tools.subagent.input)).not.toContain("sessionID")

      const continuing = {
        subagent: {
          description: SubagentTool.description,
          input: Schema.toJsonSchemaDocument(SubagentTool.Input).schema,
        },
      }
      yield* registered.hook({
        sessionID: parentID,
        agent: callerID,
        requestedModel: parentModel,
        model: parentModel,
        system: [],
        messages: [
          ProviderMessage.tool({
            id: "call_subagent",
            name: "subagent",
            result: { type: "content", value: [{ type: "text", text: "completed" }] },
          }),
        ],
        tools: continuing,
        permissions,
      })
      expect(JSON.stringify(continuing.subagent.input)).toContain("sessionID")

      const absent: SessionContext["tools"] = {}
      yield* registered.hook({
        sessionID: parentID,
        agent: Agent.ID.make("missing"),
        requestedModel: parentModel,
        model: parentModel,
        system: [],
        messages: [],
        tools: absent,
        permissions: [],
      })
      expect(absent).toEqual({})
    }),
  )

  it.effect("keeps nested delegation denied by depth and omits denied subagents from the catalog", () =>
    Effect.gen(function* () {
      const nested = makeAgent(Agent.ID.make("general"), "subagent", {
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "question", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
        ],
      })
      const registered = yield* register(makeRuntime({ parentDepth: 1 }), [nested, reviewer])
      const tools = { subagent: { description: SubagentTool.description, input: {} } }
      yield* registered.hook({
        sessionID: parentID,
        agent: nested.id,
        requestedModel: parentModel,
        model: parentModel,
        system: [],
        messages: [],
        tools,
        permissions: nested.permissions,
      })
      expect(tools.subagent.description).toBe(SubagentTool.description)

      const denied = yield* execute(registered.tool, {
        agent: reviewerID,
        description: "nested review",
        prompt: "review",
      }).pipe(Effect.exit)
      expect(Exit.isFailure(denied)).toBe(true)
      if (Exit.isFailure(denied)) expect(String(denied.cause)).toContain("Subagent depth limit reached (1)")
    }),
  )

  it.effect("rejects validation cases in authority order", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime()
      const registered = yield* register(runtime)
      const externalID = Session.ID.make("00000000-0000-4000-8000-000000000899")
      const external = yield* execute(registered.tool, {
        agent: reviewerID,
        description: "external child",
        prompt: "continue",
        sessionID: externalID,
      }).pipe(Effect.exit)
      expect(Exit.isFailure(external)).toBe(true)
      if (Exit.isFailure(external))
        expect(String(external.cause)).toContain(`Subagent session not found: ${externalID}`)

      const unrelated = yield* execute(registered.tool, {
        agent: reviewerID,
        description: "bad child",
        prompt: "continue",
        sessionID: otherID,
      }).pipe(Effect.exit)
      expect(Exit.isFailure(unrelated)).toBe(true)
      if (Exit.isFailure(unrelated)) expect(String(unrelated.cause)).toContain(`Session ${otherID} is not a child`)

      const primary = yield* execute(registered.tool, {
        agent: callerID,
        description: "bad agent",
        prompt: "run",
      }).pipe(Effect.exit)
      expect(Exit.isFailure(primary)).toBe(true)
      if (Exit.isFailure(primary)) expect(String(primary.cause)).toContain("Agent caller cannot run as a subagent")

      const unknown = yield* execute(registered.tool, {
        agent: "missing",
        description: "unknown agent",
        prompt: "run",
      }).pipe(Effect.exit)
      expect(Exit.isFailure(unknown)).toBe(true)
      if (Exit.isFailure(unknown)) expect(String(unknown.cause)).toContain("Unknown agent: missing")
    }),
  )

  it.effect("checks the caller's permission before creating or prompting a child", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime()
      const registered = yield* register(runtime)
      const denied = yield* registered.tool
        .execute(
          {
            agent: reviewerID,
            description: "denied review",
            prompt: "review",
          },
          {
            caller: {
              type: "session",
              sessionID: parentID,
              agent: callerID,
              messageID,
              projectID: detail(parentID).projectID,
            },
            id: ToolSchema.CallID.make("call_denied"),
            progress: () => Effect.void,
            elicit: () => Effect.die("unused"),
            permission: (request) =>
              Effect.gen(function* () {
                expect(request).toEqual({ action: "subagent", resources: [reviewerID], save: [reviewerID] })
                return yield* new ToolSchema.Error({ message: "caller denied" })
              }),
          },
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(denied)).toBe(true)
      if (Exit.isFailure(denied)) expect(String(denied.cause)).toContain(`Subagent denied: ${reviewerID}`)
      expect(runtime.observed.created).toEqual([])
      expect(runtime.observed.prompts).toEqual([])
    }),
  )
})

function makeAgent(id: Agent.ID, mode: Agent.Mode, overrides: Partial<Agent.Info> = {}) {
  return Agent.Info.make({
    id,
    name: Agent.Name.make(id),
    instructions: "",
    mode,
    hidden: false,
    steps: null,
    permissions: [],
    ...overrides,
  })
}

function detail(id: Session.ID, options: { parentID?: Session.ID; agent?: Agent.ID; model?: typeof parentModel } = {}) {
  return Session.Detail.make({
    id,
    projectID: Project.ID.make("prj_00000000000000000000000801"),
    ...(options.parentID === undefined ? {} : { parentID: options.parentID }),
    title: id === parentID ? "parent" : "child",
    agent: options.agent ?? callerID,
    model: options.model ?? parentModel,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    usage: empty,
  })
}

function assistant(text: string, options: { error?: boolean } = {}): MessageSchema.Message {
  return MessageSchema.Assistant.make({
    id: MessageSchema.ID.make(crypto.randomUUID()),
    sessionID: childID,
    sequence: 1,
    createdAt: new Date(0),
    type: "assistant",
    agent: reviewerID,
    model: childModel,
    content: [
      { type: "text", id: crypto.randomUUID(), text: "first" },
      { type: "text", id: crypto.randomUUID(), text },
    ],
    ...(options.error ? { error: { _tag: "SessionError.InternalError", message: "failed" } as const } : {}),
    time: { created: new Date(0), completed: new Date(1) },
    usage: empty,
  })
}

function prompted(input: Parameters<PluginRuntime.Interface["session"]["prompt"]>[0]) {
  return {
    id: input.id ?? messageID,
    sessionID: input.sessionID,
    text: input.text,
    ...(input.agents === undefined ? {} : { agents: [...input.agents] }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    delivery: input.delivery ?? "steer",
    admittedSequence: 1,
    createdAt: new Date(0),
  }
}

function completed(input: Job.StartInput, output: string): Job.Info {
  return {
    id: input.id ?? childID,
    type: input.type,
    title: input.title,
    status: "completed",
    started_at: 1,
    completed_at: 2,
    output,
    metadata: input.metadata,
  }
}

const settle = (input: Job.StartInput): Effect.Effect<Job.Info> =>
  input.run.pipe(
    Effect.match({
      onFailure: (error) => ({
        id: input.id ?? childID,
        type: input.type,
        title: input.title,
        status: "error" as const,
        started_at: 1,
        completed_at: 2,
        error: error instanceof Error ? error.message : String(error),
        metadata: input.metadata,
      }),
      onSuccess: (output) => completed(input, output),
    }),
    Effect.scoped,
  )

function makeRuntime(
  options: {
    prompt?: PluginRuntime.Interface["session"]["prompt"]
    onStart?: (input: Job.StartInput) => void
    block?: Effect.Effect<Job.BlockResult | undefined>
    wait?: Effect.Effect<Job.WaitResult>
    resume?: ReturnType<PluginRuntime.Interface["session"]["resume"]>
    awaitIdle?: ReturnType<PluginRuntime.Interface["session"]["wait"]>
    messages?: MessageSchema.Message[]
    existingAgent?: Agent.ID
    existingModel?: typeof parentModel
    parentModel?: typeof parentModel
    joinRunning?: boolean
    parentDepth?: number
  } = {},
) {
  const observed = {
    created: [] as unknown[],
    prompts: [] as string[],
    messages: [] as unknown[],
    switches: [] as unknown[],
    interrupted: [] as Session.ID[],
    interruptionReasons: [] as string[],
    cancelled: [] as string[],
    synthetics: [] as Session.SyntheticInput[],
    page: options.messages ?? [assistant("second")],
    existingAgent: options.existingAgent ?? reviewerID,
    resumed: 0,
  }
  let info: Job.Info | undefined
  let generation = 0
  const runtime = {
    observed,
    session: {
      get: (id) => {
        if (id === parentID)
          return Effect.succeed(
            detail(parentID, {
              ...(options.parentDepth === undefined ? {} : { parentID: otherID }),
              model: options.parentModel,
            }),
          )
        if (id === childID)
          return Effect.succeed(
            detail(childID, { parentID, agent: observed.existingAgent, model: options.existingModel }),
          )
        if (id === otherID)
          return Effect.succeed(
            options.parentDepth === undefined ? detail(otherID, { parentID: childID }) : detail(otherID),
          )
        return Effect.fail(new Session.NotFoundError({ sessionID: id }))
      },
      create: (input) =>
        Effect.sync(() => observed.created.push(input)).pipe(
          Effect.as(detail(childID, { parentID, agent: input.agent, model: input.model })),
        ),
      messages: (input) =>
        Effect.sync(() => observed.messages.push(input)).pipe(Effect.as(observed.page.slice(0, 20))),
      prompt:
        options.prompt ??
        ((input) => Effect.sync(() => observed.prompts.push(input.text)).pipe(Effect.as(prompted(input)))),
      generate: () => Effect.die(new Error("unused")),
      command: () => Effect.die(new Error("unused")),
      rename: () => Effect.die(new Error("unused")),
      resume: () =>
        Effect.sync(() => {
          observed.resumed++
        }).pipe(Effect.andThen(options.resume ?? Effect.void)),
      switchAgent: (input) =>
        Effect.sync(() => {
          observed.switches.push({ type: "agent", ...input })
          observed.existingAgent = input.agent
        }),
      switchModel: (input) => Effect.sync(() => observed.switches.push({ type: "model", ...input })),
      interrupt: (id, reason) =>
        Effect.sync(() => {
          observed.interrupted.push(id)
          observed.interruptionReasons.push(reason)
        }).pipe(Effect.as(detail(id, { parentID }))),
      synthetic: (input) =>
        Effect.sync(() => observed.synthetics.push(input)).pipe(
          Effect.as(
            SessionInbox.Synthetic.make({
              id: input.id ?? messageID,
              sessionID: input.sessionID,
              type: "synthetic",
              payload: {
                text: input.text,
                ...(input.description === undefined ? {} : { description: input.description }),
                ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
              },
              delivery: input.delivery ?? "steer",
              createdAt: new Date(0),
            }),
          ),
        ),
      wait: () => options.awaitIdle ?? Effect.void,
    },
    job: {
      start: (input) => {
        generation++
        const result: Effect.Effect<Job.Info> = options.joinRunning
          ? Effect.succeed({
              id: input.id ?? childID,
              type: input.type,
              title: input.title,
              status: "running",
              started_at: generation,
              metadata: input.metadata,
            } satisfies Job.Info)
          : settle(input).pipe(Effect.map((result) => ({ ...result, started_at: generation })))
        return Effect.sync(() => options.onStart?.(input)).pipe(
          Effect.andThen(result),
          Effect.tap((settled) =>
            Effect.sync(() => {
              info = settled
            }),
          ),
        )
      },
      wait: () => options.wait ?? Effect.succeed({ info, timedOut: false }),
      block: () => options.block ?? Effect.succeed(info === undefined ? undefined : { type: "finished", info }),
      background: () => Effect.succeed(info),
      cancel: (id) => Effect.sync(() => observed.cancelled.push(id)).pipe(Effect.as(info)),
    },
    scheduledTask: {
      create: () => Effect.die(new Error("unused")),
      get: () => Effect.die(new Error("unused")),
      list: Effect.die(new Error("unused")),
      update: () => Effect.die(new Error("unused")),
      delete: () => Effect.die(new Error("unused")),
      run: () => Effect.die(new Error("unused")),
    },
  } satisfies PluginRuntime.Interface & { observed: typeof observed }
  return runtime as unknown as PluginRuntime.Interface & { observed: typeof observed }
}

function register(runtime: ReturnType<typeof makeRuntime>, catalog = [caller, reviewer, fallback]) {
  return Effect.gen(function* () {
    let tool: ToolSchema.Info | undefined
    let hook: ((event: CatalogContext) => Effect.Effect<void>) | undefined
    const plugin = {
      tool: {
        transform: (callback: (editor: { add: (value: ToolSchema.Info) => void }) => void) =>
          Effect.sync(() =>
            callback({
              add: (value) => {
                tool = value
              },
            }),
          ).pipe(Effect.as({ dispose: Effect.void })),
      },
      session: {
        hook: (_name: string, callback: (event: CatalogContext) => Effect.Effect<void>) =>
          Effect.sync(() => {
            hook = callback
          }).pipe(Effect.as({ dispose: Effect.void })),
      },
      agent: {
        get: ({ id }: { id: Agent.ID }) => {
          const found = catalog.find((agent) => agent.id === id)
          return found === undefined ? Effect.fail(new NotFoundError({ id })) : Effect.succeed(found)
        },
        list: () => Effect.succeed(catalog),
      },
    } as unknown as PluginContext
    yield* SubagentTool.SubagentToolPlugin.effect(plugin).pipe(
      Effect.provideService(PluginRuntime.Service, runtime),
      Effect.provideService(
        Service,
        agentService({
          list: Effect.succeed(catalog),
          get: (id) => Effect.succeed(catalog.find((agent) => agent.id === id)),
          resolve: Effect.succeed(caller),
          create: (agent) => Effect.succeed(agent),
          update: (id, update) => Effect.succeed(Agent.Info.make({ id, ...update })),
        }),
      ),
    )
    if (tool === undefined || hook === undefined)
      return yield* Effect.die(new Error("Subagent plugin did not register"))
    return { tool, hook }
  })
}

function execute(
  tool: ToolSchema.Info,
  input: unknown,
  progress: ToolSchema.Metadata[] = [],
  catalog = [caller, reviewer, fallback],
) {
  return tool
    .execute(input, {
      caller: {
        type: "session",
        sessionID: parentID,
        agent: callerID,
        messageID,
        projectID: detail(parentID).projectID,
      },
      id: ToolSchema.CallID.make("call_subagent"),
      progress: (metadata: ToolSchema.Metadata) => Effect.sync(() => progress.push(metadata)),
      elicit: () => Effect.die("unused"),
      permission: () => Effect.void,
    })
    .pipe(
      Effect.provideService(
        Service,
        agentService({
          list: Effect.succeed(catalog),
          get: (id) => Effect.succeed(catalog.find((agent) => agent.id === id)),
          resolve: Effect.succeed(caller),
          create: (agent) => Effect.succeed(agent),
          update: (id, update) => Effect.succeed(Agent.Info.make({ id, ...update })),
        }),
      ),
    )
}
