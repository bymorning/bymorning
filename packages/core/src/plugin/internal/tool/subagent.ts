export * as SubagentTool from "./subagent.js"

import { define } from "@bymorning/plugin/effect/plugin"
import { AgentSchema } from "@bymorning/schema/agent"
import { MessageSchema } from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import type { Permission as PermissionSchema } from "@bymorning/schema/permission"
import { Tool } from "../../../tool.js"
import { Effect, Schema, Scope } from "effect"
import { randomUUID } from "node:crypto"
import { Agent } from "../../../agent.js"
import { Permission } from "../../../permission.js"
import { PluginRuntime } from "../../runtime.js"

export const name = "subagent"

const NO_TEXT = "Subagent completed without a text response."
const SessionReference = Schema.String.check(
  Schema.isUUID(undefined, { toJsonSchema: () => ({ format: "uuid" }) }),
).pipe(Schema.brand("Session.ID"))
const NewSession = Schema.Literal("new")
const backgroundResult = (sessionID: Session.ID, startedAt: number) => {
  const output = [
    `The subagent is working in the background (sessionID: ${sessionID}). You will be notified automatically when it finishes.`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
  ].join("\n")
  return {
    output: { sessionID, status: "running" as const, output },
    content: [{ type: "text" as const, text: output }],
    metadata: { sessionID, status: "running", startedAt },
  }
}

const NewInput = Schema.Struct({
  agent: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.String.annotate({ description: "The task for the subagent to perform" }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress.",
  }),
})

export const Input = NewInput.pipe(
  Schema.fieldsAssign({
    sessionID: Schema.optionalKey(Schema.Union([NewSession, SessionReference])).annotate({
      description:
        'Continue a specific previous subagent conversation using the exact sessionID returned by an earlier subagent call. Use "new" to start another conversation. Never invent or generate a sessionID.',
    }),
  }),
)

export const Output = Schema.Struct({
  sessionID: Session.ID,
  status: Schema.Literals(["completed", "running"]),
  output: Schema.String,
})

export const description = [
  "Spawns an agent in a child session to work on the specified task.",
  "The output includes a sessionID you can pass back later to continue that specific conversation with the subagent.",
  'For a new child, omit sessionID. If sessionID is available after an earlier child, use "new" to start another one or pass an exact returned ID to continue. Never invent or generate an ID.',
  "Foreground (default) runs the subagent to completion and returns its final response.",
  "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
  "Use background only for independent work that can run while you continue elsewhere.",
].join("\n")

export const SubagentToolPlugin = define({
  id: "core.tool.subagent",
  effect: (plugin) =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const runtime = yield* PluginRuntime.Service
      const scope = yield* Scope.Scope
      const notifications = new Set<string>()

      const notifyWhenDone = Effect.fn("SubagentTool.notifyWhenDone")(function* (
        parentID: Session.ID,
        childID: Session.ID,
        agent: string,
        description: string,
        startedAt: number,
      ) {
        const key = `${childID}:${startedAt}`
        if (notifications.has(key)) return
        notifications.add(key)
        yield* runtime.job.wait({ id: childID }).pipe(
          Effect.flatMap((result) => {
            const info = result.info
            if (info?.status === "completed")
              return runtime.session.synthetic({
                sessionID: parentID,
                text: `<subagent sessionID="${childID}" state="completed" description="${description}">\n${info.output ?? NO_TEXT}\n</subagent>`,
                description,
                metadata: { source: "subagent", childID, agent, state: "completed", startedAt },
              })
            if (info?.status === "error")
              return runtime.session.synthetic({
                sessionID: parentID,
                text: `<subagent sessionID="${childID}" state="error" description="${description}">\n${info.error ?? "Subagent failed"}\n</subagent>`,
                description,
                metadata: { source: "subagent", childID, agent, state: "error", startedAt },
              })
            if (info?.status === "cancelled")
              return runtime.session.synthetic({
                sessionID: parentID,
                text: `<subagent sessionID="${childID}" state="cancelled" description="${description}">\nSubagent cancelled\n</subagent>`,
                description,
                metadata: { source: "subagent", childID, agent, state: "cancelled", startedAt },
              })
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      const tool = {
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input: typeof Input.Type, context: Tool.Context) =>
          Effect.gen(function* () {
            if (context.caller.type !== "session")
              return yield* new Tool.Error({ message: "This Tool requires a Session caller" })
            const sessionID = context.caller.sessionID
            const parent = yield* runtime.session
              .get(sessionID)
              .pipe(
                Effect.mapError(
                  (error) => new Tool.Error({ message: `Parent session not found: ${sessionID}`, error }),
                ),
              )
            if (parent.id !== sessionID || parent.projectID !== context.caller.projectID)
              return yield* new Tool.Error({ message: "Session Tool caller does not match its Project" })
            let current = parent
            let depth = 0
            while (current.parentID !== undefined) {
              depth++
              current = yield* runtime.session
                .get(current.parentID)
                .pipe(
                  Effect.mapError(
                    (error) => new Tool.Error({ message: `Parent session not found: ${current.parentID}`, error }),
                  ),
                )
            }
            if (depth >= 1)
              return yield* Effect.fail(
                new Tool.Error({
                  message: "Subagent depth limit reached (1). Nested subagents are not allowed.",
                }),
              )
            const agentID = AgentSchema.ID.make(input.agent)
            const agent = yield* agents.get(agentID)
            if (agent === undefined)
              return yield* Effect.fail(new Tool.Error({ message: `Unknown agent: ${input.agent}` }))
            if (agent.mode === "primary")
              return yield* Effect.fail(new Tool.Error({ message: `Agent ${input.agent} cannot run as a subagent` }))
            yield* context
              .permission({ action: name, resources: [agent.id], save: [agent.id] })
              .pipe(Effect.mapError((error) => new Tool.Error({ message: `Subagent denied: ${agent.id}`, error })))

            const requestedSessionID = input.sessionID === "new" ? undefined : input.sessionID
            const existing =
              requestedSessionID === undefined
                ? undefined
                : yield* runtime.session.get(requestedSessionID).pipe(
                    Effect.mapError(
                      (error) =>
                        new Tool.Error({
                          message: `Subagent session not found: ${requestedSessionID}`,
                          error,
                        }),
                    ),
                  )
            if (existing !== undefined && existing.parentID !== sessionID)
              return yield* Effect.fail(
                new Tool.Error({ message: `Session ${existing.id} is not a child of the current session` }),
              )
            if (existing !== undefined && existing.agent !== agent.id) {
              yield* runtime.session.switchAgent({ sessionID: existing.id, agent: agent.id }).pipe(
                Effect.andThen(
                  agent.model === undefined
                    ? Effect.void
                    : runtime.session.switchModel({ sessionID: existing.id, model: agent.model }),
                ),
                Effect.mapError(
                  (error) =>
                    new Tool.Error({ message: `Failed to switch subagent session agent: ${existing.id}`, error }),
                ),
              )
            }

            const child =
              existing ??
              (yield* runtime.session
                .create({
                  parentID: sessionID,
                  title: input.description,
                  agent: agent.id,
                  model: agent.model ?? parent.model,
                })
                .pipe(
                  Effect.mapError(
                    (error) => new Tool.Error({ message: `Parent session not found: ${sessionID}`, error }),
                  ),
                ))
            yield* context.progress({ sessionID: child.id, status: "running" })
            yield* runtime.session
              .prompt({
                sessionID: child.id,
                id: MessageSchema.ID.make(randomUUID()),
                text:
                  existing === undefined
                    ? ["You are a subagent spawned by another session.", input.prompt].join("\n")
                    : input.prompt,
              })
              .pipe(
                Effect.mapError(
                  (error) => new Tool.Error({ message: `Failed to prompt subagent: ${child.id}`, error }),
                ),
              )

            const run = Effect.gen(function* () {
              yield* runtime.session.resume(child.id)
              yield* runtime.session.wait(child.id)
              const messages = yield* runtime.session.messages({
                sessionID: child.id,
                order: "desc",
                limit: 20,
              })
              const assistant = messages.find(
                (message) =>
                  message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
              )
              if (assistant === undefined || assistant.type !== "assistant") return NO_TEXT
              const text = assistant.content
                .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
                .map((part) => part.text)
                .join("")
              return text.length > 0 ? text : NO_TEXT
            }).pipe(Effect.onInterrupt(() => runtime.session.interrupt(child.id, "superseded")))

            const info = yield* runtime.job.start({
              id: child.id,
              type: name,
              title: input.description,
              metadata: {},
              run,
            })
            if (input.background === true) {
              yield* runtime.job.background(info.id)
              yield* notifyWhenDone(sessionID, child.id, agent.name, input.description, info.started_at)
              return backgroundResult(child.id, info.started_at)
            }
            const result = yield* runtime.job.block({ id: child.id, sessionID: sessionID }).pipe(
              Effect.onInterrupt(() =>
                Effect.all([runtime.session.interrupt(child.id, "superseded"), runtime.job.cancel(child.id)], {
                  discard: true,
                }),
              ),
            )
            if (result?.type === "backgrounded") {
              yield* notifyWhenDone(sessionID, child.id, agent.name, input.description, result.info.started_at)
              return backgroundResult(child.id, result.info.started_at)
            }
            if (result?.info.status === "error")
              return yield* Effect.fail(
                new Tool.Error({
                  message: `Subagent failed (sessionID: ${child.id}): ${result.info.error ?? "unknown error"}`,
                }),
              )
            if (result?.info.status === "cancelled")
              return yield* Effect.fail(new Tool.Error({ message: `Subagent cancelled (sessionID: ${child.id})` }))
            const output = result?.info.output ?? NO_TEXT
            return {
              output: { sessionID: child.id, status: "completed" as const, output },
              content: [
                {
                  type: "text" as const,
                  text: `<subagent sessionID="${child.id}" state="completed">\n${output}\n</subagent>`,
                },
              ],
              metadata: { sessionID: child.id, status: "completed" },
            }
          }).pipe(
            Effect.mapError((error) =>
              error instanceof Tool.Error ? error : new Tool.Error({ message: "Subagent failed", error }),
            ),
          ),
      } satisfies Tool.Info<typeof Input, typeof Output>
      yield* plugin.tool.transform((editor) => editor.add(tool))

      yield* plugin.session.hook("context", (event) =>
        Effect.gen(function* () {
          const tool = event.tools[name]
          if (tool === undefined) return
          const permissions = (event as typeof event & { readonly permissions?: PermissionSchema.Ruleset }).permissions
          if (permissions === undefined) return
          if (
            !event.messages.some((message) =>
              message.content.some(
                (part) => part.type === "tool-result" && part.name === name && part.result.type !== "error",
              ),
            )
          )
            tool.input = Schema.toJsonSchemaDocument(NewInput).schema
          const available = (yield* plugin.agent.list())
            .filter(
              (agent) =>
                agent.mode !== "primary" &&
                !agent.hidden &&
                Permission.evaluate(name, agent.id, permissions).effect !== "deny",
            )
            .toSorted((left, right) => left.id.localeCompare(right.id))
          if (available.length === 0) return
          tool.description = [
            tool.description,
            "",
            "Available subagents:",
            ...available.map(
              (agent) =>
                `- ${agent.id}${agent.name === String(agent.id) ? "" : ` (name: ${agent.name})`}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`,
            ),
          ].join("\n")
        }).pipe(Effect.orDie),
      )
    }),
})
