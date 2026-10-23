import { Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Semaphore } from "effect"
import type { User } from "@bymorning/schema/user"
import type { Workspace } from "@bymorning/schema/workspace"
import { CallID, type Snapshot } from "@bymorning/core/tool"
import { Tool } from "@bymorning/core/tool"
import { WorkspaceConfig } from "@bymorning/core/config"
import { Plugin } from "@bymorning/core/plugin"
import { Permission } from "@bymorning/core/permission"
import { Form } from "@bymorning/core/form"

export * as Member from "./member.js"

export interface Interface {
  /** Prepared definitions and execution from the member-bound Tool registry. */
  readonly snapshot: Effect.Effect<Snapshot>
  /** Start one member-bound external Tool invocation. */
  readonly call: (input: CallInput) => Effect.Effect<Outcome, Tool.Error | RequestError>
  /** Supply the one pending elicitation response; it never replaces Tool arguments. */
  readonly resume: (input: ResumeInput) => Effect.Effect<Outcome, Tool.Error | RequestError | NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@bymorning/gateway/ToolGateway.Member") {}

export interface Capabilities {
  readonly form?: boolean
  readonly url?: boolean
}

export interface CallInput {
  readonly tool: string
  readonly input: unknown
  /** Explicit presentation override. Native capability selection remains automatic. */
  readonly mode?: "browser" | "model"
  readonly capabilities?: Capabilities
}

export interface ResumeInput {
  readonly id: string
  readonly round?: number
  /** The signed presentation selected for the pending round. */
  readonly mode?: Pending["mode"]
  readonly response?: Tool.ElicitResult
}

export type Pending = {
  readonly status: "pending"
  readonly id: string
  readonly round: number
  readonly request: Tool.ElicitInput
  readonly mode: "form" | "url" | "browser" | "model"
  readonly url?: string
}
export type Outcome = { readonly status: "completed"; readonly result: Tool.NormalizedResult } | Pending

export class RequestError extends Schema.TaggedError<RequestError>()("MCPGateway.RequestError", {
  message: Schema.String,
}) {}
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("MCPGateway.NotFoundError", {
  id: Schema.String,
}) {}

export const layer = (workspaceID: Workspace.ID, userID: User.ID) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* WorkspaceConfig.Service
      const tools = yield* Tool.Service
      const hooks = yield* Plugin.Hooks.Service
      const forms = yield* Form.Service

      const lock = Semaphore.makeUnsafe(1)
      const entries = new Map<string, Entry>()
      const ttl = 10 * 60 * 1_000
      const purge = () => {
        const now = Date.now()
        for (const [id, entry] of entries) if (entry.until !== undefined && entry.until <= now) entries.delete(id)
      }
      const find = (id: string) =>
        Effect.sync(() => {
          purge()
          return entries.get(id)
        }).pipe(Effect.flatMap((entry) => (entry ? Effect.succeed(entry) : Effect.fail(new NotFoundError({ id })))))
      const settle = (entry: Entry, outcome: Outcome | Tool.Error | RequestError) =>
        Effect.sync(() => {
          entry.outcome = outcome
          entry.until = Date.now() + ttl
          if (entry.timer !== undefined) clearTimeout(entry.timer)
        }).pipe(Effect.tap(() => Deferred.succeed(entry.advance, outcome)))
      const snapshot = Effect.gen(function* () {
        const current = yield* config.get
        const prepared = yield* tools.snapshot(current.permissions, "gateway")
        return {
          ...prepared,
          execute: (input: Parameters<Snapshot["execute"]>[0]) => {
            const { call } = input
            return instrument("gateway", call.name, call.input, userID, hooks, call.id as CallID, (value) =>
              prepared.execute({ ...input, call: { ...input.call, id: input.call.id as CallID, input: value } }),
            )
          },
        } as Snapshot
      })
      const authorize = (request: Tool.PermissionRequest) =>
        Effect.gen(function* () {
          const permissions = (yield* config.get).permissions
          const effects = request.resources.map(
            (resource) => Permission.evaluate(request.action, resource, permissions).effect,
          )
          if (effects.some((effect) => effect !== "allow"))
            return yield* new Tool.Error({ message: `Permission denied: ${request.action}` })
        })
      const reauthorize = (entry: Entry) => Effect.forEach(entry.admissions, authorize, { discard: true })

      const call = Effect.fn("ToolGateway.call")((input: CallInput) =>
        Effect.uninterruptibleMask((restore) =>
          lock
            .withPermit(
              Effect.gen(function* () {
                purge()
                const id = crypto.randomUUID()
                const advance = yield* Deferred.make<Outcome | Tool.Error | RequestError>()
                const entry = { id, advance, round: 0, admissions: [] } as Entry
                entries.set(id, entry)
                entry.timer = setTimeout(() => {
                  if (entries.get(id) !== entry || entry.outcome !== undefined) return
                  const error = new RequestError({ message: "Invocation expired" })
                  entry.outcome = error
                  entry.until = Date.now()
                  Effect.runFork(Deferred.succeed(entry.advance, error))
                  entries.delete(id)
                  if (entry.formID !== undefined) Effect.runFork(forms.cancel(entry.formID).pipe(Effect.ignore))
                  if (entry.fiber !== undefined) Effect.runFork(Fiber.interrupt(entry.fiber))
                }, ttl)
                const fiber = yield* Effect.gen(function* () {
                  const prepared = yield* snapshot
                  const definitions = new Map(prepared.definitions.map((definition) => [definition.name, definition]))
                  const context = {
                    caller: { type: "gateway", userID },
                    id: id as CallID,
                    progress: () => Effect.void,
                    permission: (request: Tool.PermissionRequest) =>
                      authorize(request).pipe(Effect.tap(() => Effect.sync(() => entry.admissions.push(request)))),
                    elicit: (request: Tool.ElicitInput) =>
                      Effect.gen(function* () {
                        const response = yield* Deferred.make<Tool.ElicitResult>()
                        const previous = entry.advance
                        entry.advance = yield* Deferred.make<Outcome | Tool.Error | RequestError>()
                        entry.response = response
                        entry.round++
                        entry.claimed = false
                        const mode = selectMode(request, input.capabilities, input.mode)
                        const formID = mode === "browser" ? Form.ID.create() : undefined
                        entry.formID = formID
                        const pending = {
                          status: "pending" as const,
                          id,
                          round: entry.round,
                          request,
                          mode,
                          ...(mode === "browser" && formID !== undefined
                            ? { url: `/w/${workspaceID}/form/${formID}` }
                            : mode === "url"
                              ? { url: (request as Extract<Tool.ElicitInput, { readonly mode: "url" }>).url }
                              : {}),
                        }
                        entry.pending = pending
                        yield* Deferred.succeed(previous, pending)
                        if (formID !== undefined) {
                          return yield* forms.ask(browserForm(formID, request)).pipe(
                            Effect.tap(() => reauthorize(entry)),
                            Effect.map((state): Tool.ElicitResult => {
                              if (state.status === "cancelled") return { action: "cancel" }
                              const action = state.answer[BrowserAction]
                              if (action === "decline") return { action: "decline" }
                              const answer = { ...state.answer }
                              delete answer[BrowserAction]
                              if (request.mode === "url") delete answer[BrowserURL]
                              return { action: "accept", answer }
                            }),
                            Effect.mapError((error) => new Tool.Error({ message: error.message, error })),
                          )
                        }
                        return yield* Deferred.await(response)
                      }),
                  } as Tool.Context
                  const result = yield* prepared.execute({
                    call: { type: "tool-call", id: id as CallID, name: input.tool, input: input.input },
                    context,
                    definitions,
                  })
                  return { status: "completed" as const, result } satisfies Outcome
                }).pipe(
                  Effect.catchTag("Tool.Error", (error) => Effect.succeed(error)),
                  Effect.catchDefect((defect) =>
                    Effect.logError("MCP gateway tool execution failed", { defect }).pipe(
                      Effect.as(new RequestError({ message: "Tool execution failed" })),
                    ),
                  ),
                  Effect.flatMap((outcome) => settle(entry, outcome).pipe(Effect.as(outcome))),
                  Effect.forkDetach,
                )
                entry.fiber = fiber
                return advance
              }),
            )
            .pipe(Effect.flatMap((ready) => restore(Deferred.await(ready)).pipe(Effect.flatMap(toOutcome)))),
        ),
      )
      const resume = Effect.fn("ToolGateway.resume")((input: ResumeInput) =>
        lock
          .withPermit(
            find(input.id).pipe(
              Effect.flatMap((entry) => {
                if (entry.outcome !== undefined) return Effect.succeed(toOutcome(entry.outcome))
                if (entry.pending === undefined)
                  return Effect.succeed(Effect.fail(new RequestError({ message: "Invocation is not awaiting input" })))
                if (input.round !== undefined && input.round !== entry.round)
                  return Effect.succeed(
                    Effect.fail(new RequestError({ message: "Invocation input round has advanced" })),
                  )
                if (input.mode !== undefined && input.mode !== entry.pending.mode)
                  return Effect.succeed(
                    Effect.fail(new RequestError({ message: "Invocation presentation mode does not match" })),
                  )
                // A browser Form is the only settlement authority. The retry merely
                // observes its retained execution; its payload is deliberately ignored.
                if (entry.pending.mode === "browser")
                  return Effect.succeed(Deferred.await(entry.advance).pipe(Effect.flatMap(toOutcome)))
                // Claim this round before releasing the member lock. Concurrent
                // retries observe the same retained advance rather than applying
                // a second answer to this (or a later) elicitation.
                if (entry.claimed) return Effect.succeed(Deferred.await(entry.advance).pipe(Effect.flatMap(toOutcome)))
                const response = input.response ?? { action: "cancel" as const }
                const invalid = validateResponse(entry.pending.request, response)
                if (invalid !== undefined) return Effect.succeed(Effect.fail(new RequestError({ message: invalid })))
                const advance = entry.advance
                entry.claimed = true
                return reauthorize(entry).pipe(
                  Effect.matchEffect({
                    onFailure: (error) =>
                      Effect.sync(() => {
                        entry.claimed = false
                      }).pipe(Effect.as(Effect.fail(error))),
                    onSuccess: () =>
                      Deferred.succeed(entry.response!, response).pipe(
                        Effect.as(Deferred.await(advance).pipe(Effect.flatMap(toOutcome))),
                      ),
                  }),
                )
              }),
            ),
          )
          .pipe(Effect.flatten),
      )
      yield* Effect.addFinalizer(() =>
        Effect.forEach(Array.from(entries.values()), (entry) =>
          (entry.timer === undefined ? Effect.void : Effect.sync(() => clearTimeout(entry.timer))).pipe(
            Effect.andThen(entry.fiber === undefined ? Effect.void : Fiber.interrupt(entry.fiber).pipe(Effect.asVoid)),
          ),
        ).pipe(Effect.asVoid),
      )
      return Service.of({
        snapshot,
        call,
        resume,
      })
    }),
  )

const instrument = <A extends Tool.Result>(
  tool: string,
  name: string,
  input: unknown,
  userID: User.ID,
  hooks: Plugin.Hooks.Interface,
  id: CallID,
  execute: (input: unknown) => Effect.Effect<A, Tool.Error>,
) => {
  const before = { id, userID, tool: name, input }
  return hooks.trigger("gateway", "tool.execute.before", before).pipe(
    Effect.flatMap((event) =>
      execute(event.input).pipe(
        Effect.map((result) => ({ status: "completed" as const, result })),
        Effect.catchTag("Tool.Error", (error) => Effect.succeed({ status: "error" as const, error })),
        Effect.flatMap((settlement) =>
          hooks
            .trigger("gateway", "tool.execute.after", { ...event, ...settlement })
            .pipe(
              Effect.flatMap((after) =>
                after.status === "error" ? Effect.fail(after.error) : Effect.succeed(after.result),
              ),
            ),
        ),
      ),
    ),
  )
}

interface Entry {
  readonly id: string
  advance: Deferred.Deferred<Outcome | Tool.Error | RequestError>
  response?: Deferred.Deferred<Tool.ElicitResult>
  round: number
  fiber?: Fiber.Fiber<unknown, unknown>
  pending?: Pending
  outcome?: Outcome | Tool.Error | RequestError
  until?: number
  formID?: Form.ID
  /** One model/native reply has claimed the current pending round. */
  claimed?: boolean
  timer?: ReturnType<typeof setTimeout>
  readonly admissions: Tool.PermissionRequest[]
}

const toOutcome = (outcome: Outcome | Tool.Error | RequestError) =>
  outcome instanceof Tool.Error || outcome instanceof RequestError ? Effect.fail(outcome) : Effect.succeed(outcome)

const selectMode = (
  request: Tool.ElicitInput,
  capabilities: Capabilities | undefined,
  override?: CallInput["mode"],
): Pending["mode"] => {
  if (override === "browser") return "browser"
  // Model relay is an explicit caller choice. Unlike native MCP elicitation it
  // carries the complete Tool request and therefore does not need to fit the
  // constrained MCP form/url wire shapes.
  if (override === "model") return "model"
  if (request.mode === "form" && capabilities?.form && nativeForm(request.fields)) return "form"
  if (request.mode === "url" && capabilities?.url) return "url"
  return "browser"
}

const nativeForm = (fields: Form.Fields) =>
  fields.every((field) => {
    if (field.type === "external" || field.when !== undefined) return false
    return !((field.type === "string" || field.type === "multiselect") && field.custom)
  })

const validateResponse = (request: Tool.ElicitInput, response: Tool.ElicitResult): string | undefined => {
  if (response.action !== "accept") return
  if (request.mode === "url")
    return Object.keys(response.answer).length === 0 ? undefined : "URL elicitation does not accept content"
  return Form.validateAnswer(request.fields, response.answer)
}

const BrowserAction = "__bymorning_gateway_action"
const BrowserURL = "__bymorning_gateway_url"
const browserForm = (id: Form.ID, input: Tool.ElicitInput): Form.CreateInput => ({
  id,
  title: input.title,
  metadata: { kind: "mcp-elicitation", mode: input.mode, message: input.message },
  fields: [
    {
      key: BrowserAction,
      type: "string",
      title: "Response",
      required: true,
      options: [
        { value: "accept", label: "Continue" },
        { value: "decline", label: "Decline" },
      ],
    },
    ...(input.mode === "form"
      ? input.fields.map((field) =>
          field.type === "external"
            ? field
            : { ...field, when: [{ key: BrowserAction, op: "eq" as const, value: "accept" }, ...(field.when ?? [])] },
        )
      : [{ key: BrowserURL, type: "external" as const, url: input.url, title: input.message }]),
  ] as Form.Fields,
})
